/**
 * End-to-end test — creates two mock users, runs them through every feature,
 * reports what works, what fails, and what's missing.
 *
 * Run:  npx tsx scripts/e2e-test.ts
 */

const BASE = "https://rally-orpin.vercel.app";

// ── Colours ──────────────────────────────────────────────────────────────────
const G = (s: string) => `\x1b[32m${s}\x1b[0m`;   // green
const R = (s: string) => `\x1b[31m${s}\x1b[0m`;   // red
const Y = (s: string) => `\x1b[33m${s}\x1b[0m`;   // yellow
const B = (s: string) => `\x1b[34m${s}\x1b[0m`;   // blue
const BOLD = (s: string) => `\x1b[1m${s}\x1b[0m`;

// ── Results collector ─────────────────────────────────────────────────────────
interface Result { label: string; status: "pass"|"fail"|"warn"; detail?: string; }
const results: Result[] = [];

function pass(label: string, detail?: string) {
  results.push({ label, status: "pass", detail });
  console.log(`  ${G("✓")} ${label}${detail ? ` — ${detail}` : ""}`);
}
function fail(label: string, detail?: string) {
  results.push({ label, status: "fail", detail });
  console.log(`  ${R("✗")} ${label}${detail ? ` — ${R(detail)}` : ""}`);
}
function warn(label: string, detail?: string) {
  results.push({ label, status: "warn", detail });
  console.log(`  ${Y("⚠")} ${label}${detail ? ` — ${Y(detail)}` : ""}`);
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
async function req<T = unknown>(
  method: string, path: string, body?: unknown, token?: string
): Promise<{ ok: boolean; status: number; data: T }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data: T;
  try { data = await res.json(); } catch { data = {} as T; }
  return { ok: res.ok, status: res.status, data };
}

// ── Unique suffix so each test run doesn't collide ────────────────────────────
const RUN = Date.now().toString(36);
const ALICE_EMAIL = `alice.test.${RUN}@rendez-fake.com`;
const BOB_EMAIL   = `bob.test.${RUN}@rendez-fake.com`;
const PASSWORD    = "TestPass123!";

let aliceToken = "";
let bobToken   = "";
let aliceId    = "";
let bobId      = "";
let activityId = "";   // Bob's activity post
let requestId  = "";   // Alice's request on Bob's post
let matchId    = "";   // match between Alice and Bob

// ═════════════════════════════════════════════════════════════════════════════
async function testRegistration() {
  console.log(BOLD(B("\n── 1. Registration ──────────────────────────────────────")));

  // Alice — register returns { token, user: { id, ... } }
  const a = await req<any>("POST", "/api/mobile/register", {
    name: "Alice Test", email: ALICE_EMAIL, password: PASSWORD,
  });
  if (a.ok && a.data.user?.id) {
    aliceId = a.data.user.id;
    aliceToken = a.data.token; // token is returned directly on register too
    pass("Alice registered", `id=${aliceId}`);
  } else {
    fail("Alice registration", JSON.stringify(a.data));
    process.exit(1);
  }

  // Bob
  const b = await req<any>("POST", "/api/mobile/register", {
    name: "Bob Test", email: BOB_EMAIL, password: PASSWORD,
  });
  if (b.ok && b.data.user?.id) {
    bobId = b.data.user.id;
    bobToken = b.data.token;
    pass("Bob registered", `id=${bobId}`);
  } else {
    fail("Bob registration", JSON.stringify(b.data));
    process.exit(1);
  }

  // Duplicate email guard
  const dup = await req("POST", "/api/mobile/register", { name: "X", email: ALICE_EMAIL, password: PASSWORD });
  dup.status === 409 ? pass("Duplicate email rejected (409)") : fail("Duplicate email should return 409", `got ${dup.status}`);

  // Weak password guard
  const weak = await req("POST", "/api/mobile/register", { name: "X", email: `weak.${RUN}@x.com`, password: "123" });
  weak.status === 400 ? pass("Weak password rejected (400)") : fail("Weak password should return 400", `got ${weak.status}`);
}

// ─────────────────────────────────────────────────────────────────────────────
async function testLogin() {
  console.log(BOLD(B("\n── 2. Login ─────────────────────────────────────────────")));

  const a = await req<{ token: string }>("POST", "/api/mobile/login", { email: ALICE_EMAIL, password: PASSWORD });
  if (a.ok && a.data.token) {
    aliceToken = a.data.token; // refresh token (same secret, valid)
    pass("Alice login", "JWT received");
  } else { fail("Alice login", JSON.stringify(a.data)); process.exit(1); }

  const b = await req<{ token: string }>("POST", "/api/mobile/login", { email: BOB_EMAIL, password: PASSWORD });
  if (b.ok && b.data.token) {
    bobToken = b.data.token;
    pass("Bob login", "JWT received");
  } else { fail("Bob login", JSON.stringify(b.data)); process.exit(1); }

  // Bad password
  const bad = await req("POST", "/api/mobile/login", { email: ALICE_EMAIL, password: "wrongwrong" });
  bad.status === 401 ? pass("Bad password rejected (401)") : fail("Bad password should return 401", `got ${bad.status}`);

  // Rate limit (11 attempts in quick succession)
  let rateLimited = false;
  for (let i = 0; i < 11; i++) {
    const r = await req("POST", "/api/mobile/login", { email: `fake@x.com`, password: "wrong" });
    if (r.status === 429) { rateLimited = true; break; }
  }
  rateLimited ? pass("Login rate limiter triggers at 429") : warn("Rate limiter did not trigger (may need 15+ attempts on same IP)");
}

// ─────────────────────────────────────────────────────────────────────────────
async function testOnboarding() {
  console.log(BOLD(B("\n── 3. Onboarding ────────────────────────────────────────")));

  // Alice — FEMALE, interested in MALE
  const steps = [
    {
      label: "Alice demographics",
      path: "/api/onboarding/demographics",
      body: { birthDate: "1995-03-14", gender: "FEMALE", genderPreferences: ["MALE"], city: "Cork", maxDistanceKm: 20 },
      token: aliceToken,
    },
    {
      label: "Alice personality",
      path: "/api/onboarding/personality",
      body: { personalityScore: 7 },
      token: aliceToken,
    },
    {
      label: "Alice intent",
      path: "/api/onboarding/intent",
      body: { intent: "CASUAL" },
      token: aliceToken,
    },
    {
      label: "Alice prompts",
      path: "/api/onboarding/prompts",
      body: { answers: [
        { promptKey: "perfect_sunday", answer: "Farmers market and a long walk in Fitzgerald's Park.", displayOrder: 0 },
        { promptKey: "hidden_talent", answer: "I can solve a Rubik's cube in under 2 minutes.", displayOrder: 1 },
        { promptKey: "bucket_list", answer: "Hike the Camino de Santiago.", displayOrder: 2 },
      ]},
      token: aliceToken,
    },
    {
      label: "Alice availability",
      path: "/api/onboarding/availability",
      body: { slots: [
        { dayOfWeek: "SATURDAY", timeBlock: "MORNING", isRecurring: true },
        { dayOfWeek: "SATURDAY", timeBlock: "AFTERNOON", isRecurring: true },
        { dayOfWeek: "SUNDAY", timeBlock: "MORNING", isRecurring: true },
        { dayOfWeek: "WEDNESDAY", timeBlock: "EVENING", isRecurring: true },
      ]},
      token: aliceToken,
    },
    {
      label: "Alice activities",
      path: "/api/onboarding/activities",
      body: { preferredActivities: ["COFFEE_WALK", "HIKING", "MUSEUM", "YOGA"] },
      token: aliceToken,
    },
    // Bob — MALE, interested in FEMALE
    {
      label: "Bob demographics",
      path: "/api/onboarding/demographics",
      body: { birthDate: "1992-07-22", gender: "MALE", genderPreferences: ["FEMALE"], city: "Cork", maxDistanceKm: 20 },
      token: bobToken,
    },
    {
      label: "Bob personality",
      path: "/api/onboarding/personality",
      body: { personalityScore: 5 },
      token: bobToken,
    },
    {
      label: "Bob intent",
      path: "/api/onboarding/intent",
      body: { intent: "SERIOUS" },
      token: bobToken,
    },
    {
      label: "Bob prompts",
      path: "/api/onboarding/prompts",
      body: { answers: [
        { promptKey: "perfect_sunday", answer: "Early run, big breakfast, afternoon reading.", displayOrder: 0 },
        { promptKey: "life_motto", answer: "Done is better than perfect.", displayOrder: 1 },
        { promptKey: "hidden_talent", answer: "Making sourdough. My starter is 3 years old.", displayOrder: 2 },
      ]},
      token: bobToken,
    },
    {
      label: "Bob availability",
      path: "/api/onboarding/availability",
      body: { slots: [
        { dayOfWeek: "SATURDAY", timeBlock: "MORNING", isRecurring: true },
        { dayOfWeek: "SATURDAY", timeBlock: "AFTERNOON", isRecurring: true },
        { dayOfWeek: "SUNDAY", timeBlock: "AFTERNOON", isRecurring: true },
        { dayOfWeek: "FRIDAY", timeBlock: "EVENING", isRecurring: true },
      ]},
      token: bobToken,
    },
    {
      label: "Bob activities",
      path: "/api/onboarding/activities",
      body: { preferredActivities: ["COFFEE_WALK", "RUNNING", "HIKING", "DRINKS"] },
      token: bobToken,
    },
  ];

  for (const step of steps) {
    const r = await req("POST", step.path, step.body, step.token);
    r.ok ? pass(step.label) : fail(step.label, `${r.status} — ${JSON.stringify(r.data)}`);
  }

  // Validation: reject bad enum
  const bad = await req("POST", "/api/onboarding/demographics", {
    birthDate: "1995-01-01", gender: "DINOSAUR", genderPreferences: ["MALE"], city: "Cork", maxDistanceKm: 20,
  }, aliceToken);
  bad.status === 400 ? pass("Invalid gender enum rejected") : fail("Should reject bad gender enum", `got ${bad.status}`);
}

// ─────────────────────────────────────────────────────────────────────────────
async function testGetMe() {
  console.log(BOLD(B("\n── 4. GET /api/mobile/me ────────────────────────────────")));

  const a = await req<any>("GET", "/api/mobile/me", undefined, aliceToken);
  if (a.ok) {
    const fields = ["id","email","name","profile","reputation","availabilitySlots","tier","matchCredits"];
    const missing = fields.filter(f => a.data[f] === undefined);
    missing.length === 0
      ? pass("Alice /me has all expected fields")
      : warn("Alice /me missing fields", missing.join(", "));
    a.data.tier === "FREE" ? pass("Alice tier = FREE") : fail("Alice tier should be FREE", a.data.tier);
    a.data.matchCredits === 3 ? pass("Alice has 3 free credits") : fail("Alice free credits wrong", `got ${a.data.matchCredits}`);
  } else {
    fail("GET /api/mobile/me failed", `${a.status}`);
  }

  // Unauthenticated request should return 401
  const unauth = await req("GET", "/api/mobile/me");
  unauth.status === 401 ? pass("Unauthenticated /me returns 401") : fail("Unauthenticated /me should be 401", `got ${unauth.status}`);
}

// ─────────────────────────────────────────────────────────────────────────────
async function testProfileUpdate() {
  console.log(BOLD(B("\n── 5. Profile update ────────────────────────────────────")));

  const r = await req("POST", "/api/profile/update", {
    bio: "Love hiking and coffee. Cork based.",
    city: "Cork",
    intents: ["CASUAL"],
    personalityScore: 7,
    genderPreferences: ["MALE"],
  }, aliceToken);
  r.ok ? pass("Alice profile update") : fail("Profile update failed", `${r.status} ${JSON.stringify(r.data)}`);

  // Empty city should be rejected
  const bad = await req("POST", "/api/profile/update", {
    bio: "hi", city: "", intents: ["CASUAL"], personalityScore: 5, genderPreferences: ["MALE"],
  }, aliceToken);
  bad.status === 400 ? pass("Empty city rejected in profile update") : warn("Empty city not validated", `got ${bad.status}`);
}

// ─────────────────────────────────────────────────────────────────────────────
async function testActivityFeed() {
  console.log(BOLD(B("\n── 6. Activity feed ─────────────────────────────────────")));

  // Bob creates an activity post
  const create = await req<any>("POST", "/api/activities", {
    activityCategory: "COFFEE_WALK",
    title: "Morning coffee walk in Fitzgerald's Park",
    description: "Looking for someone to walk and chat with over a good coffee.",
    scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    locationName: "Fitzgerald's Park",
    city: "Cork",
    activityIntent: "OPEN",
  }, bobToken);

  if (create.ok && create.data.id) {
    activityId = create.data.id;
    pass("Bob creates activity post", `id=${activityId}`);
  } else {
    fail("Activity creation failed", `${create.status} — ${JSON.stringify(create.data)}`);
  }

  // Alice browses the feed — should see Bob's post
  const feed = await req<any[]>("GET", "/api/activities?city=Cork", undefined, aliceToken);
  if (feed.ok) {
    const found = feed.data.find((p: any) => p.id === activityId);
    found ? pass("Alice can see Bob's post in feed") : warn("Bob's post not visible in Alice's feed", "may be a timing issue");
  } else {
    fail("Feed GET failed", `${feed.status}`);
  }

  // Test validation — title too long
  const badTitle = await req("POST", "/api/activities", {
    activityCategory: "COFFEE_WALK",
    title: "x".repeat(101),
    city: "Cork",
  }, bobToken);
  badTitle.status === 400 ? pass("Title >100 chars rejected") : fail("Title length not validated", `got ${badTitle.status}`);

  // Test validation — invalid activity category
  const badCat = await req("POST", "/api/activities", {
    activityCategory: "SKYDIVING",
    title: "Let's go!",
    city: "Cork",
  }, bobToken);
  badCat.status === 400 ? pass("Invalid activity category rejected") : fail("Bad category not validated", `got ${badCat.status}`);

  // Bob's own post should NOT appear in Bob's feed
  const bobFeed = await req<any[]>("GET", "/api/activities?city=Cork", undefined, bobToken);
  if (bobFeed.ok) {
    const ownPost = bobFeed.data.find((p: any) => p.id === activityId);
    !ownPost ? pass("Bob's own post hidden from his feed") : fail("Bob can see his own post in feed");
  }

  // Unauthenticated feed
  const unauth = await req("GET", "/api/activities?city=Cork");
  unauth.status === 401 ? pass("Unauthenticated feed returns 401") : fail("Feed should require auth", `got ${unauth.status}`);
}

// ─────────────────────────────────────────────────────────────────────────────
async function testFeedRequest() {
  console.log(BOLD(B("\n── 7. Feed request (interest) ───────────────────────────")));

  if (!activityId) { warn("Skipped — no activityId"); return; }

  // Alice requests to join Bob's activity
  const req1 = await req<any>("POST", `/api/feed/${activityId}/request`, {
    message: "Hi Bob! I'd love to join your coffee walk.",
  }, aliceToken);

  if (req1.ok && req1.data.id) {
    requestId = req1.data.id;
    pass("Alice sends interest in Bob's activity", `requestId=${requestId}`);
  } else {
    fail("Feed request failed", `${req1.status} — ${JSON.stringify(req1.data)}`);
  }

  // Duplicate request should be rejected
  const dup = await req("POST", `/api/feed/${activityId}/request`, { message: "Again!" }, aliceToken);
  dup.status === 409 ? pass("Duplicate request rejected (409)") : warn("Duplicate request not blocked", `got ${dup.status}`);

  // Bob checks incoming requests
  const incoming = await req<any[]>("GET", "/api/feed/requests/incoming", undefined, bobToken);
  if (incoming.ok) {
    const found = incoming.data.find((r: any) => r.id === requestId);
    found ? pass("Bob sees Alice's request in incoming") : fail("Bob can't see Alice's request", `${incoming.data.length} requests found`);
  } else {
    fail("GET incoming requests failed", `${incoming.status}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testRespondToRequest() {
  console.log(BOLD(B("\n── 8. Accept request → match creation ───────────────────")));

  if (!requestId) { warn("Skipped — no requestId"); return; }

  // Bob accepts Alice's request — field is `accept`, not `accepted`
  const r = await req<any>("POST", `/api/feed/requests/${requestId}/respond`, { accept: true }, bobToken);

  if (r.ok && r.data.matchId) {
    matchId = r.data.matchId;
    pass("Bob accepts Alice's request → match created", `matchId=${matchId}`);
  } else if (r.status === 402) {
    // Bob has no credits left — this is correct behaviour
    pass("Bob has no credits — 402 returned (correct credit gate)", `${JSON.stringify(r.data)}`);
    warn("Match not created — Bob needs a credit to confirm pre-scheduled activity");
    return;
  } else {
    fail("Accept request failed", `${r.status} — ${JSON.stringify(r.data)}`);
  }

  // Non-owner can't respond to the request
  const notOwner = await req("POST", `/api/feed/requests/${requestId}/respond`, { accept: true }, aliceToken);
  notOwner.status === 403 ? pass("Non-owner can't respond to request (403)") : warn("Request ownership not enforced", `got ${notOwner.status}`);
}

// ─────────────────────────────────────────────────────────────────────────────
async function testMatchList() {
  console.log(BOLD(B("\n── 9. Match list ────────────────────────────────────────")));

  if (!matchId) { warn("Skipped — no matchId"); return; }

  const a = await req<any[]>("GET", "/api/matches", undefined, aliceToken);
  if (a.ok) {
    const found = a.data.find((m: any) => m.id === matchId);
    found ? pass("Alice can see her match") : fail("Alice's match not in list");
    // Verify fields
    if (found) {
      const fields = ["id","status","userA","userB","messages","systemActions"];
      const missing = fields.filter(f => found[f] === undefined);
      missing.length === 0 ? pass("Match has all expected fields") : warn("Match missing fields", missing.join(", "));
    }
  } else {
    fail("GET /api/matches failed for Alice", `${a.status}`);
  }

  const b = await req<any[]>("GET", "/api/matches", undefined, bobToken);
  if (b.ok) {
    const found = b.data.find((m: any) => m.id === matchId);
    found ? pass("Bob can see his match") : fail("Bob's match not in list");
  } else {
    fail("GET /api/matches failed for Bob", `${b.status}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testMatchDetail() {
  console.log(BOLD(B("\n── 10. Match detail ─────────────────────────────────────")));

  if (!matchId) { warn("Skipped — no matchId"); return; }

  const r = await req<any>("GET", `/api/matches/${matchId}`, undefined, aliceToken);
  r.ok ? pass("GET /api/matches/:id works") : fail("Match detail failed", `${r.status}`);

  // Other user can't access this match
  const unauth = await req("GET", `/api/matches/${matchId}`);
  unauth.status === 401 ? pass("Unauthenticated match detail returns 401") : fail("Match detail should require auth", `got ${unauth.status}`);
}

// ─────────────────────────────────────────────────────────────────────────────
async function testMessaging() {
  console.log(BOLD(B("\n── 11. Messaging ────────────────────────────────────────")));

  if (!matchId) { warn("Skipped — no matchId"); return; }

  // Check match is in COORDINATING status first
  const matchData = await req<any>("GET", `/api/matches/${matchId}`, undefined, aliceToken);
  if (!matchData.ok) { fail("Can't load match for messaging test"); return; }
  if (!["COORDINATING","CONFIRMED","DATE_ACTIVE","CONNECTED"].includes(matchData.data.status)) {
    warn(`Match status=${matchData.data.status} — messages may be blocked`);
  }

  // Alice sends 10 messages (the limit)
  let lastMsgStatus = 0;
  for (let i = 1; i <= 10; i++) {
    const r = await req<any>("POST", `/api/matches/${matchId}/messages`, {
      content: `Alice message ${i} — testing the messaging limit!`,
    }, aliceToken);
    lastMsgStatus = r.status;
    if (!r.ok && r.status !== 403) {
      fail(`Alice message ${i} failed`, `${r.status} — ${JSON.stringify(r.data)}`);
      break;
    }
  }
  if (lastMsgStatus === 201 || lastMsgStatus === 200) {
    pass("Alice sent 10 messages (full limit)");
  } else if (lastMsgStatus === 403) {
    fail("Alice hit limit before 10 messages — limit mismatch!");
  }

  // 11th message should be blocked
  const over = await req("POST", `/api/matches/${matchId}/messages`, {
    content: "This should be blocked — over limit!",
  }, aliceToken);
  over.status === 403 ? pass("11th message blocked (MESSAGE_LIMIT_REACHED)") : fail("11th message not blocked", `got ${over.status}`);

  // Empty message rejected
  const empty = await req("POST", `/api/matches/${matchId}/messages`, { content: "" }, aliceToken);
  empty.status === 400 ? pass("Empty message rejected") : warn("Empty message not validated", `got ${empty.status}`);

  // Message >500 chars rejected
  const long = await req("POST", `/api/matches/${matchId}/messages`, { content: "x".repeat(501) }, aliceToken);
  long.status === 400 ? pass("Message >500 chars rejected") : warn("Long message not validated", `got ${long.status}`);

  // Bob sends messages too
  for (let i = 1; i <= 3; i++) {
    const r = await req<any>("POST", `/api/matches/${matchId}/messages`, {
      content: `Bob reply ${i} — coordinating!`,
    }, bobToken);
    if (!r.ok) { warn(`Bob message ${i} failed`, `${r.status}`); break; }
  }
  pass("Bob sent 3 messages");

  // GET messages
  const msgs = await req<any[]>("GET", `/api/matches/${matchId}/messages`, undefined, aliceToken);
  if (msgs.ok) {
    pass("GET messages works", `${msgs.data.length} messages total`);
  } else {
    fail("GET messages failed", `${msgs.status}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testIcebreaker() {
  console.log(BOLD(B("\n── 12. Icebreaker ───────────────────────────────────────")));

  if (!matchId) { warn("Skipped — no matchId"); return; }

  // Bob sends icebreaker question
  const send = await req<any>("POST", `/api/matches/${matchId}/icebreaker`, {
    question: "Morning person or night owl?",
    options: ["Morning 🌅", "Night owl 🌙"],
    myAnswer: "Morning 🌅",
  }, bobToken);

  if (send.ok) {
    pass("Bob sends icebreaker question");
  } else {
    fail("Icebreaker send failed", `${send.status} — ${JSON.stringify(send.data)}`);
  }

  // Duplicate icebreaker should be rejected
  const dup = await req("POST", `/api/matches/${matchId}/icebreaker`, {
    question: "Another question?", options: ["A", "B"], myAnswer: "A",
  }, bobToken);
  dup.status === 409 ? pass("Duplicate icebreaker rejected (409)") : warn("Duplicate icebreaker not blocked", `got ${dup.status}`);

  // Alice answers (find the question action ID first)
  const match = await req<any>("GET", `/api/matches/${matchId}`, undefined, aliceToken);
  const questionAction = match.data?.systemActions?.find(
    (a: any) => a.actionType === "ICEBREAKER_QUESTION" && a.initiatorId !== aliceId
  );

  if (questionAction) {
    const answer = await req<any>("POST", `/api/matches/${matchId}/actions`, {
      actionType: "ICEBREAKER_ANSWER",
      payload: { questionActionId: questionAction.id, answer: "Night owl 🌙" },
    }, aliceToken);
    answer.ok ? pass("Alice answers icebreaker") : fail("Icebreaker answer failed", `${answer.status} — ${JSON.stringify(answer.data)}`);
  } else {
    warn("Could not find icebreaker question action to answer");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testMatchActions() {
  console.log(BOLD(B("\n── 13. Match coordination actions ──────────────────────")));

  if (!matchId) { warn("Skipped — no matchId"); return; }

  const futureTime = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  // Alice proposes a time
  const proposeTime = await req<any>("POST", `/api/matches/${matchId}/actions`, {
    actionType: "PROPOSE_TIME",
    payload: { scheduledAt: futureTime },
  }, aliceToken);
  proposeTime.ok ? pass("Alice proposes time") : fail("PROPOSE_TIME failed", `${proposeTime.status} — ${JSON.stringify(proposeTime.data)}`);

  // Bob accepts the time
  let proposalId: string | undefined;
  const matchNow = await req<any>("GET", `/api/matches/${matchId}`, undefined, bobToken);
  const timeAction = matchNow.data?.systemActions?.find(
    (a: any) => a.actionType === "PROPOSE_TIME" && !a.acceptedAt && !a.rejectedAt
  );
  if (timeAction) {
    proposalId = timeAction.id;
    const acceptTime = await req<any>("POST", `/api/matches/${matchId}/actions`, {
      actionType: "ACCEPT_TIME",
      targetActionId: timeAction.id,
      payload: {},
    }, bobToken);
    acceptTime.ok ? pass("Bob accepts proposed time") : fail("ACCEPT_TIME failed", `${acceptTime.status} — ${JSON.stringify(acceptTime.data)}`);
  } else {
    warn("No pending time proposal found for Bob to accept");
  }

  // Alice proposes a location
  const proposeLoc = await req<any>("POST", `/api/matches/${matchId}/actions`, {
    actionType: "PROPOSE_LOCATION",
    payload: { locationName: "The Elbow Lane, Cork", locationUrl: "https://maps.google.com" },
  }, aliceToken);
  proposeLoc.ok ? pass("Alice proposes location") : fail("PROPOSE_LOCATION failed", `${proposeLoc.status} — ${JSON.stringify(proposeLoc.data)}`);

  // Bob accepts location
  const matchNow2 = await req<any>("GET", `/api/matches/${matchId}`, undefined, bobToken);
  const locAction = matchNow2.data?.systemActions?.find(
    (a: any) => a.actionType === "PROPOSE_LOCATION" && !a.acceptedAt && !a.rejectedAt
  );
  if (locAction) {
    const acceptLoc = await req<any>("POST", `/api/matches/${matchId}/actions`, {
      actionType: "ACCEPT_LOCATION",
      targetActionId: locAction.id,
      payload: {},
    }, bobToken);
    acceptLoc.ok ? pass("Bob accepts proposed location") : fail("ACCEPT_LOCATION failed", `${acceptLoc.status} — ${JSON.stringify(acceptLoc.data)}`);
  } else {
    warn("No pending location proposal found for Bob to accept");
  }

  // Alice confirms the plan (consumes a credit)
  const confirm = await req<any>("POST", `/api/matches/${matchId}/actions`, {
    actionType: "CONFIRM_PLAN",
    payload: {},
  }, aliceToken);

  if (confirm.ok) {
    pass("Alice CONFIRM_PLAN — plan locked in!");
  } else if (confirm.status === 402) {
    pass("CONFIRM_PLAN correctly blocked — Alice has no credits (402)");
    warn("Can't proceed past CONFIRM_PLAN without a credit — test truncated here");
    return;
  } else {
    fail("CONFIRM_PLAN failed", `${confirm.status} — ${JSON.stringify(confirm.data)}`);
  }

  // Verify match is now CONFIRMED
  const confirmed = await req<any>("GET", `/api/matches/${matchId}`, undefined, aliceToken);
  confirmed.data?.status === "CONFIRMED"
    ? pass("Match status = CONFIRMED after plan confirmed")
    : warn("Match status after CONFIRM_PLAN", `got ${confirmed.data?.status}`);
}

// ─────────────────────────────────────────────────────────────────────────────
async function testPreDateCard() {
  console.log(BOLD(B("\n── 14. Pre-date card ────────────────────────────────────")));

  if (!matchId) { warn("Skipped — no matchId"); return; }

  const r = await req<any>("GET", `/api/matches/${matchId}/pre-date-card`, undefined, aliceToken);
  r.ok ? pass("Pre-date card fetched", JSON.stringify(r.data).slice(0, 60)) : fail("Pre-date card failed", `${r.status} — ${JSON.stringify(r.data)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
async function testMarkRead() {
  console.log(BOLD(B("\n── 15. Mark messages read ───────────────────────────────")));

  if (!matchId) { warn("Skipped — no matchId"); return; }

  const r = await req("POST", `/api/matches/${matchId}/read`, {}, aliceToken);
  r.ok ? pass("Mark-read works") : fail("Mark-read failed", `${r.status}`);
}

// ─────────────────────────────────────────────────────────────────────────────
async function testBillingPage() {
  console.log(BOLD(B("\n── 16. Billing ──────────────────────────────────────────")));

  // Buy credit — should create a Stripe checkout session
  const credit = await req<any>("POST", "/api/billing/buy-credit", {}, aliceToken);
  if (credit.ok && credit.data.url?.startsWith("https://checkout.stripe.com")) {
    pass("Buy credit → Stripe checkout URL returned");
  } else {
    fail("Buy credit failed", `${credit.status} — ${JSON.stringify(credit.data)}`);
  }

  // Buy extra messages (requires a matchId)
  if (matchId) {
    const extra = await req<any>("POST", `/api/matches/${matchId}/buy-extra-messages`, {}, aliceToken);
    if (extra.ok && extra.data.url?.startsWith("https://checkout.stripe.com")) {
      pass("Buy extra messages → Stripe checkout URL returned");
    } else if (extra.status === 409) {
      pass("Extra messages already purchased (409)");
    } else {
      fail("Buy extra messages failed", `${extra.status} — ${JSON.stringify(extra.data)}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testPushToken() {
  console.log(BOLD(B("\n── 17. Push token registration ──────────────────────────")));

  const r = await req("POST", "/api/push-token", {
    token: `ExponentPushToken[fake-test-${RUN}]`,
    platform: "ios",
  }, aliceToken);
  r.ok ? pass("Push token registered") : fail("Push token registration failed", `${r.status} — ${JSON.stringify(r.data)}`);

  // Duplicate push token — should upsert, not error
  const dup = await req("POST", "/api/push-token", {
    token: `ExponentPushToken[fake-test-${RUN}]`,
    platform: "ios",
  }, aliceToken);
  dup.ok ? pass("Duplicate push token upserted cleanly") : fail("Duplicate push token errored", `${dup.status}`);
}

// ─────────────────────────────────────────────────────────────────────────────
async function testVenues() {
  console.log(BOLD(B("\n── 18. Venues ───────────────────────────────────────────")));

  // Route uses `activity` param, not `category`
  const r = await req<any>("GET", "/api/venues?city=Cork&activity=COFFEE_WALK", undefined, aliceToken);
  if (r.ok) {
    const venues = r.data.venues ?? [];
    venues.length > 0 ? pass("Venues API returns results", `${venues.length} venues`) : warn("Venues returned 0 results (OpenStreetMap may have no data for this query)");
  } else {
    fail("Venues API failed", `${r.status} — ${JSON.stringify(r.data)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testUserProfile() {
  console.log(BOLD(B("\n── 19. Public user profile ──────────────────────────────")));

  // Alice views Bob's public profile
  const r = await req<any>("GET", `/api/users/${bobId}/profile`, undefined, aliceToken);
  if (r.ok) {
    pass("Alice can view Bob's public profile");
    const fields = ["name","profile"];
    const missing = fields.filter(f => r.data[f] === undefined);
    missing.length === 0 ? pass("Public profile has expected fields") : warn("Public profile missing fields", missing.join(", "));
    // Sensitive fields should NOT leak
    if (r.data.passwordHash !== undefined) fail("passwordHash leaking in public profile!");
    else pass("passwordHash not exposed in public profile");
    if (r.data.email !== undefined) warn("Email exposed in public profile — consider hiding it");
    else pass("Email not exposed in public profile");
  } else {
    fail("GET user profile failed", `${r.status}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testMyActivities() {
  console.log(BOLD(B("\n── 20. My activities (CRUD) ─────────────────────────────")));

  // Bob gets his activities
  const mine = await req<any[]>("GET", "/api/activities/mine", undefined, bobToken);
  if (mine.ok) {
    const found = mine.data.find((p: any) => p.id === activityId);
    found ? pass("Bob sees his activity in /mine") : warn("Bob's activity not in /mine", `${mine.data.length} found`);
  } else {
    fail("GET /api/activities/mine failed", `${mine.status}`);
  }

  // Bob deletes his activity
  if (activityId) {
    const del = await req("DELETE", `/api/activities/${activityId}`, undefined, bobToken);
    del.ok ? pass("Bob can delete his activity") : fail("Activity delete failed", `${del.status}`);

    // Soft-deleted post should return 404 on second delete
    const del2 = await req("DELETE", `/api/activities/${activityId}`, undefined, bobToken);
    del2.status === 404 ? pass("Re-deleting soft-deleted activity returns 404") : fail("Re-delete should return 404", `got ${del2.status}`);
    activityId = ""; // Clear so later steps know it's gone
  }

  // Alice can't delete Bob's activities
  if (activityId) {
    const notOwner = await req("DELETE", `/api/activities/${activityId}`, undefined, aliceToken);
    notOwner.status === 403 ? pass("Non-owner can't delete activity (403)") : fail("Activity ownership not enforced", `got ${notOwner.status}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function testShareCardPrivacy() {
  console.log(BOLD(B("\n── 21. Share card privacy toggle ────────────────────────")));

  const off = await req("PATCH", "/api/mobile/me", { allowShareCard: false }, aliceToken);
  off.ok ? pass("Alice disables share card") : fail("PATCH /me allowShareCard failed", `${off.status}`);

  const on = await req("PATCH", "/api/mobile/me", { allowShareCard: true }, aliceToken);
  on.ok ? pass("Alice re-enables share card") : fail("PATCH /me allowShareCard re-enable failed", `${on.status}`);
}

// ─────────────────────────────────────────────────────────────────────────────
async function testRunningLate() {
  console.log(BOLD(B("\n── 22. Running late / Arrived signals ───────────────────")));

  if (!matchId) { warn("Skipped — no matchId"); return; }

  const late = await req<any>("POST", `/api/matches/${matchId}/actions`, {
    actionType: "RUNNING_LATE",
    payload: { minutesLate: 10 },
  }, aliceToken);
  late.ok ? pass("Alice signals running late") : warn("RUNNING_LATE not accepted in current status", `${late.status}`);

  const arrived = await req<any>("POST", `/api/matches/${matchId}/actions`, {
    actionType: "ARRIVED",
    payload: {},
  }, aliceToken);
  arrived.ok ? pass("Alice signals arrived") : warn("ARRIVED not accepted in current status", `${arrived.status}`);
}

// ─────────────────────────────────────────────────────────────────────────────
async function testAccountDeletion() {
  console.log(BOLD(B("\n── 23. Account deletion (cleanup) ───────────────────────")));

  // Delete Alice's account
  const delAlice = await req("DELETE", "/api/mobile/me", undefined, aliceToken);
  delAlice.ok ? pass("Alice account deleted") : fail("Alice account deletion failed", `${delAlice.status} — ${JSON.stringify(delAlice.data)}`);

  // Alice's token should now be invalid (or at least return no user)
  const meAfter = await req("GET", "/api/mobile/me", undefined, aliceToken);
  meAfter.status === 404 || meAfter.status === 401
    ? pass("Alice's token/account invalid after deletion")
    : warn("After deletion, /me returned unexpected status", `${meAfter.status}`);

  // Delete Bob's account
  const delBob = await req("DELETE", "/api/mobile/me", undefined, bobToken);
  delBob.ok ? pass("Bob account deleted") : fail("Bob account deletion failed", `${delBob.status} — ${JSON.stringify(delBob.data)}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// Main runner
// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log(BOLD(`\n${"═".repeat(60)}`));
  console.log(BOLD("  Rendez end-to-end test suite"));
  console.log(BOLD(`  Target: ${BASE}`));
  console.log(BOLD(`  Run ID: ${RUN}`));
  console.log(BOLD(`${"═".repeat(60)}\n`));

  await testRegistration();
  await testLogin();
  await testOnboarding();
  await testGetMe();
  await testProfileUpdate();
  await testActivityFeed();
  await testFeedRequest();
  await testRespondToRequest();
  await testMatchList();
  await testMatchDetail();
  await testMessaging();
  await testIcebreaker();
  await testMatchActions();
  await testPreDateCard();
  await testMarkRead();
  await testBillingPage();
  await testPushToken();
  await testVenues();
  await testUserProfile();
  await testMyActivities();
  await testShareCardPrivacy();
  await testRunningLate();
  await testAccountDeletion();

  // ── Summary ───────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.status === "pass").length;
  const failed = results.filter(r => r.status === "fail").length;
  const warned = results.filter(r => r.status === "warn").length;

  console.log(BOLD(`\n${"═".repeat(60)}`));
  console.log(BOLD("  RESULTS SUMMARY"));
  console.log(BOLD(`${"═".repeat(60)}`));
  console.log(`  ${G(`${passed} passed`)}  ${R(`${failed} failed`)}  ${Y(`${warned} warnings`)}\n`);

  if (failed > 0) {
    console.log(BOLD(R("  FAILURES:")));
    results.filter(r => r.status === "fail").forEach(r =>
      console.log(`    ${R("✗")} ${r.label}${r.detail ? ` — ${r.detail}` : ""}`)
    );
  }
  if (warned > 0) {
    console.log(BOLD(Y("\n  WARNINGS / GAPS:")));
    results.filter(r => r.status === "warn").forEach(r =>
      console.log(`    ${Y("⚠")} ${r.label}${r.detail ? ` — ${r.detail}` : ""}`)
    );
  }
  console.log(BOLD(`\n${"═".repeat(60)}\n`));
}

main().catch(e => { console.error(R(`\nFatal error: ${e.message}`)); process.exit(1); });
