import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { z } from "zod";

const slotSchema = z.object({
  dayOfWeek: z.enum(["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"]),
  timeBlock: z.enum(["MORNING","AFTERNOON","EVENING","NIGHT"]),
  isRecurring: z.boolean().default(true),
});

const schema = z.object({ slots: z.array(slotSchema).min(1) });

export async function POST(req: Request) {
  const session = await getRequiredSession();
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid." }, { status: 400 });

  // Delete existing slots and re-create
  await prisma.availabilitySlot.deleteMany({ where: { userId: session.user?.id as string } });

  await prisma.availabilitySlot.createMany({
    data: parsed.data.slots.map((s) => ({
      userId: session.user?.id as string,
      dayOfWeek: s.dayOfWeek,
      timeBlock: s.timeBlock,
      isRecurring: s.isRecurring,
      isActive: true,
    })),
  });

  await prisma.user.update({ where: { id: session.user?.id as string }, data: { onboardingStep: 5 } });

  return NextResponse.json({ ok: true });
}

export async function GET() {
  const session = await getRequiredSession();
  const slots = await prisma.availabilitySlot.findMany({
    where: { userId: session.user?.id as string, isActive: true },
  });
  return NextResponse.json(slots);
}
