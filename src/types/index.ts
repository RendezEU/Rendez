export type { Gender, IntentType, ActivityCategory, TimeBlock, DayOfWeek, MatchStatus, MatchSource, SystemActionType, PostDateChoice, UserTier } from "@prisma/client";

export const ACTIVITY_LABELS: Record<string, string> = {
  RUNNING: "Running",
  COFFEE_WALK: "Coffee / Walk",
  DRINKS: "Drinks",
  TENNIS: "Tennis",
  HIKING: "Hiking",
  CYCLING: "Cycling",
  YOGA: "Yoga",
  COOKING: "Cooking",
  MUSEUM: "Museum",
  PICNIC: "Picnic",
  CLIMBING: "Climbing",
  DANCING: "Dancing",
};

export const ACTIVITY_EMOJIS: Record<string, string> = {
  RUNNING: "🏃",
  COFFEE_WALK: "☕",
  DRINKS: "🍸",
  TENNIS: "🎾",
  HIKING: "🥾",
  CYCLING: "🚴",
  YOGA: "🧘",
  COOKING: "👨‍🍳",
  MUSEUM: "🏛️",
  PICNIC: "🧺",
  CLIMBING: "🧗",
  DANCING: "💃",
};

export const PROFILE_PROMPTS: { key: string; question: string }[] = [
  { key: "perfect_sunday", question: "Perfect Sunday for me is…" },
  { key: "enjoy_meeting", question: "You'll enjoy meeting me if…" },
  { key: "surprisingly_good", question: "I'm surprisingly good at…" },
  { key: "conversation_starter", question: "A good conversation starter for me is…" },
  { key: "weekend_ritual", question: "My weekend ritual involves…" },
  { key: "deal_breaker", question: "My biggest green flag in someone is…" },
  { key: "hidden_talent", question: "A weird skill I have is…" },
  { key: "bucket_list", question: "One thing on my bucket list is…" },
  { key: "comfort_zone", question: "I recently stepped outside my comfort zone by…" },
  { key: "life_motto", question: "A motto I actually live by is…" },
];

export const GENDER_LABELS: Record<string, string> = {
  MALE: "Man",
  FEMALE: "Woman",
  NON_BINARY: "Non-binary",
  OTHER: "Other",
  PREFER_NOT_TO_SAY: "Prefer not to say",
};

export const INTENT_LABELS: Record<string, string> = {
  CASUAL: "Casual",
  SERIOUS: "Something serious",
  OPEN: "Open to anything",
};
