import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { z } from "zod";

const slotSchema = z.object({
  dayOfWeek: z.enum(["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"]),
  timeBlock: z.enum(["MORNING","AFTERNOON","EVENING","NIGHT"]),
  isRecurring: z.boolean().default(true),
});

const schema = z.object({ slots: z.array(slotSchema).min(1) });

export async function POST(req: Request) {
  const userId = await getRequestUserId(req);
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid." }, { status: 400 });

  // Delete existing slots and re-create
  await prisma.availabilitySlot.deleteMany({ where: { userId: userId } });

  await prisma.availabilitySlot.createMany({
    data: parsed.data.slots.map((s) => ({
      userId: userId,
      dayOfWeek: s.dayOfWeek,
      timeBlock: s.timeBlock,
      isRecurring: s.isRecurring,
      isActive: true,
    })),
  });

  await prisma.user.update({ where: { id: userId }, data: { onboardingStep: 5 } });

  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  const userId = await getRequestUserId(req);
  const slots = await prisma.availabilitySlot.findMany({
    where: { userId: userId, isActive: true },
  });
  return NextResponse.json(slots);
}
