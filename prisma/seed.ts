import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database…");

  // Create two test users
  const passwordHash = await bcrypt.hash("password123", 12);

  const alice = await prisma.user.upsert({
    where: { email: "alice@example.com" },
    update: {},
    create: {
      email: "alice@example.com",
      name: "Alice",
      passwordHash,
      onboardingComplete: true,
      onboardingStep: 6,
    },
  });

  const bob = await prisma.user.upsert({
    where: { email: "bob@example.com" },
    update: {},
    create: {
      email: "bob@example.com",
      name: "Bob",
      passwordHash,
      onboardingComplete: true,
      onboardingStep: 6,
    },
  });

  // Create profiles
  await prisma.profile.upsert({
    where: { userId: alice.id },
    update: {},
    create: {
      userId: alice.id,
      birthDate: new Date("1995-03-15"),
      gender: "FEMALE",
      genderPreferences: ["MALE"],
      city: "Amsterdam",
      intent: "OPEN",
      personalityScore: 6,
      preferredActivities: ["COFFEE_WALK", "RUNNING", "MUSEUM"],
      promptAnswers: {
        create: [
          { promptKey: "perfect_sunday", answer: "Morning run, good coffee, afternoon at a museum or park.", displayOrder: 0 },
          { promptKey: "enjoy_meeting", answer: "You like being spontaneous and don't mind a bit of adventure.", displayOrder: 1 },
          { promptKey: "surprisingly_good", answer: "Reading people — I usually know within 5 minutes if we'll click.", displayOrder: 2 },
        ],
      },
    },
  });

  await prisma.profile.upsert({
    where: { userId: bob.id },
    update: {},
    create: {
      userId: bob.id,
      birthDate: new Date("1993-07-22"),
      gender: "MALE",
      genderPreferences: ["FEMALE"],
      city: "Amsterdam",
      intent: "SERIOUS",
      personalityScore: 5,
      preferredActivities: ["COFFEE_WALK", "TENNIS", "HIKING"],
      promptAnswers: {
        create: [
          { promptKey: "perfect_sunday", answer: "Tennis in the morning, slow brunch, long walk somewhere new.", displayOrder: 0 },
          { promptKey: "enjoy_meeting", answer: "You appreciate honesty and don't take yourself too seriously.", displayOrder: 1 },
          { promptKey: "hidden_talent", answer: "I can name every country's capital. It comes up more than you'd think.", displayOrder: 2 },
        ],
      },
    },
  });

  // Availability
  for (const userId of [alice.id, bob.id]) {
    await prisma.availabilitySlot.createMany({
      data: [
        { userId, dayOfWeek: "SATURDAY", timeBlock: "MORNING", isRecurring: true, isActive: true },
        { userId, dayOfWeek: "SATURDAY", timeBlock: "AFTERNOON", isRecurring: true, isActive: true },
        { userId, dayOfWeek: "SUNDAY", timeBlock: "MORNING", isRecurring: true, isActive: true },
        { userId, dayOfWeek: "WEDNESDAY", timeBlock: "EVENING", isRecurring: true, isActive: true },
      ],
      skipDuplicates: true,
    });
  }

  // Reputation
  for (const userId of [alice.id, bob.id]) {
    await prisma.reputation.upsert({
      where: { userId },
      update: {},
      create: { userId, reliabilityScore: 1.0 },
    });
  }

  // Billing
  for (const userId of [alice.id, bob.id]) {
    await prisma.billing.upsert({
      where: { userId },
      update: {},
      create: { userId, freeCreditsRemaining: 3 },
    });
  }

  console.log("✓ Seed complete");
  console.log("  alice@example.com / password123");
  console.log("  bob@example.com   / password123");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
