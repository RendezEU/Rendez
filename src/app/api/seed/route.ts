import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getRequestUserId } from "@/lib/auth/session";
import bcrypt from "bcryptjs";

const FAKE_USERS = [
  {
    name: "Sophie Martin",
    email: "sophie@rendez-fake.com",
    gender: "FEMALE",
    genderPrefs: ["MALE", "NON_BINARY"],
    city: "Amsterdam",
    birthYear: 1996,
    intent: "SERIOUS",
    personality: 7,
    activities: ["COFFEE_WALK", "YOGA", "MUSEUM", "PICNIC"],
    prompts: [
      { key: "perfect_sunday", answer: "Long brunch with friends, then a walk by the canals with a good podcast." },
      { key: "hidden_talent", answer: "I can name any ABBA song within 3 seconds of it starting." },
      { key: "bucket_list", answer: "Hiking the Camino de Santiago solo." },
    ],
    availability: ["SATURDAY:MORNING", "SATURDAY:AFTERNOON", "SUNDAY:MORNING", "WEDNESDAY:EVENING"],
    activityCategory: "COFFEE_WALK",
    aiScore: 87,
  },
  {
    name: "Lucas Becker",
    email: "lucas@rendez-fake.com",
    gender: "MALE",
    genderPrefs: ["FEMALE", "NON_BINARY"],
    city: "Amsterdam",
    birthYear: 1993,
    intent: "OPEN",
    personality: 6,
    activities: ["RUNNING", "CYCLING", "HIKING", "TENNIS"],
    prompts: [
      { key: "perfect_sunday", answer: "Early morning run, big breakfast, afternoon reading in Vondelpark." },
      { key: "surprisingly_good", answer: "Making sourdough bread. My starter is 3 years old." },
      { key: "life_motto", answer: "Done is better than perfect." },
    ],
    availability: ["SUNDAY:MORNING", "TUESDAY:EVENING", "THURSDAY:EVENING", "SATURDAY:AFTERNOON"],
    activityCategory: "RUNNING",
    aiScore: 74,
  },
  {
    name: "Aisha Ndoye",
    email: "aisha@rendez-fake.com",
    gender: "FEMALE",
    genderPrefs: ["FEMALE", "MALE", "NON_BINARY"],
    city: "Amsterdam",
    birthYear: 1998,
    intent: "CASUAL",
    personality: 9,
    activities: ["DANCING", "DRINKS", "COOKING", "MUSEUM"],
    prompts: [
      { key: "enjoy_meeting", answer: "People who laugh easily and aren't afraid to be weird in public." },
      { key: "conversation_starter", answer: "Tell me about a place that changed how you see the world." },
      { key: "weekend_ritual", answer: "Saturday market, cooking something new, spontaneous evening plans." },
    ],
    availability: ["FRIDAY:EVENING", "SATURDAY:EVENING", "SUNDAY:AFTERNOON", "WEDNESDAY:NIGHT"],
    activityCategory: "DANCING",
    aiScore: 91,
  },
  {
    name: "Tom Vanleer",
    email: "tom@rendez-fake.com",
    gender: "MALE",
    genderPrefs: ["MALE", "FEMALE"],
    city: "Amsterdam",
    birthYear: 1991,
    intent: "SERIOUS",
    personality: 4,
    activities: ["CLIMBING", "HIKING", "YOGA", "COFFEE_WALK"],
    prompts: [
      { key: "comfort_zone", answer: "Signed up for a stand-up comedy open mic last year. Did it once. Never again." },
      { key: "hidden_talent", answer: "I can read a book a week while also holding a full-time job." },
      { key: "deal_breaker", answer: "Negativity about small things. Life's too short to complain about the queue." },
    ],
    availability: ["SATURDAY:MORNING", "SUNDAY:AFTERNOON", "MONDAY:EVENING", "FRIDAY:AFTERNOON"],
    activityCategory: "CLIMBING",
    aiScore: 68,
  },
  {
    name: "Elena Rossi",
    email: "elena@rendez-fake.com",
    gender: "FEMALE",
    genderPrefs: ["MALE"],
    city: "Amsterdam",
    birthYear: 1995,
    intent: "OPEN",
    personality: 5,
    activities: ["PICNIC", "COOKING", "MUSEUM", "COFFEE_WALK"],
    prompts: [
      { key: "perfect_sunday", answer: "Farmers market, cooking an elaborate lunch, film in the evening." },
      { key: "bucket_list", answer: "Open a small Italian restaurant one day. Or at least learn to make proper pasta." },
      { key: "surprisingly_good", answer: "Parallel parking on the first try, every time." },
    ],
    availability: ["SATURDAY:AFTERNOON", "SUNDAY:MORNING", "THURSDAY:EVENING", "FRIDAY:EVENING"],
    activityCategory: "PICNIC",
    aiScore: 82,
  },
];

export async function POST(req: Request) {
  const userId = await getRequestUserId(req);
  const passwordHash = await bcrypt.hash("password123", 10);
  const now = new Date();

  let created = 0;
  const matchIds: string[] = [];

  for (const fake of FAKE_USERS) {
    // Skip if already exists
    const existing = await prisma.user.findUnique({ where: { email: fake.email } });
    if (existing) {
      // Still create match if not exists
      const match = await prisma.match.findFirst({
        where: {
          OR: [
            { userAId: userId, userBId: existing.id },
            { userAId: existing.id, userBId: userId },
          ],
        },
      });
      if (!match) {
        const m = await prisma.match.create({
          data: {
            userAId: userId,
            userBId: existing.id,
            activityCategory: fake.activityCategory as never,
            status: "PENDING" as never,
            compatibilityScore: fake.aiScore,
            source: "AI" as never,
            expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
          },
        });
        matchIds.push(m.id);
      }
      continue;
    }

    const fakeUser = await prisma.user.create({
      data: {
        name: fake.name,
        email: fake.email,
        passwordHash,
        onboardingComplete: true,
        billing: { create: { freeCreditsRemaining: 3 } },
      },
    });

    const profile = await prisma.profile.create({
      data: {
        userId: fakeUser.id,
        birthDate: new Date(`${fake.birthYear}-06-15`),
        gender: fake.gender as never,
        genderPreferences: fake.genderPrefs as never,
        city: fake.city,
        maxDistanceKm: 25,
        intent: fake.intent as never,
        personalityScore: fake.personality,
        preferredActivities: fake.activities as never,
      },
    });

    for (let i = 0; i < fake.prompts.length; i++) {
      await prisma.promptAnswer.create({
        data: {
          profileId: profile.id,
          promptKey: fake.prompts[i].key,
          answer: fake.prompts[i].answer,
          displayOrder: i,
        },
      });
    }

    for (const slot of fake.availability) {
      const [dayOfWeek, timeBlock] = slot.split(":");
      await prisma.availabilitySlot.create({
        data: {
          userId: fakeUser.id,
          dayOfWeek: dayOfWeek as never,
          timeBlock: timeBlock as never,
          isRecurring: true,
          isActive: true,
        },
      });
    }

    const match = await prisma.match.create({
      data: {
        userAId: userId,
        userBId: fakeUser.id,
        activityCategory: fake.activityCategory as never,
        status: "PENDING" as never,
        compatibilityScore: fake.aiScore,
        source: "AI" as never,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    matchIds.push(match.id);
    created++;
  }

  // Create activity posts
  const activityPosts = [
    { category: "COFFEE_WALK", title: "Morning coffee walk in Vondelpark", desc: "Looking for someone to explore the park with over a good coffee. Slow pace, good conversation.", city: "Amsterdam" },
    { category: "CYCLING", title: "Sunday canal cycling tour", desc: "Easy 15km route through the city canals. Bikes optional — I know a rental spot.", city: "Amsterdam" },
    { category: "MUSEUM", title: "Rijksmuseum visit", desc: "Going to see the Vermeer exhibition. Would love someone to discuss art with.", city: "Amsterdam" },
    { category: "TENNIS", title: "Casual tennis in Amstelpark", desc: "Beginner-friendly — I'm not a pro either. Just looking to rally and have fun.", city: "Amsterdam" },
    { category: "PICNIC", title: "Jordaan neighbourhood picnic", desc: "Bringing good cheese, bread and wine. You bring the company.", city: "Amsterdam" },
  ];

  for (const post of activityPosts) {
    const existingPost = await prisma.activityPost.findFirst({ where: { title: post.title } });
    if (!existingPost) {
      const randomFake = FAKE_USERS[Math.floor(Math.random() * FAKE_USERS.length)];
      const poster = await prisma.user.findUnique({ where: { email: randomFake.email } });
      if (poster) {
        await prisma.activityPost.create({
          data: {
            userId: poster.id,
            activityCategory: post.category as never,
            title: post.title,
            description: post.desc,
            city: post.city,
            scheduledAt: new Date(now.getTime() + (3 + Math.random() * 10) * 24 * 60 * 60 * 1000),
            expiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
            isActive: true,
          },
        });
      }
    }
  }

  return NextResponse.json({ ok: true, createdUsers: created, matches: matchIds.length });
}
