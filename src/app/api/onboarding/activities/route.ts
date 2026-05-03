import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { z } from "zod";

const VALID_ACTIVITIES = ["RUNNING","COFFEE_WALK","DRINKS","TENNIS","HIKING","CYCLING","YOGA","COOKING","MUSEUM","PICNIC","CLIMBING","DANCING"] as const;

const schema = z.object({
  preferredActivities: z.array(z.enum(VALID_ACTIVITIES)).min(2),
});

export async function POST(req: Request) {
  const session = await getRequiredSession();
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid." }, { status: 400 });

  await prisma.profile.update({
    where: { userId: session.user?.id as string },
    data: { preferredActivities: parsed.data.preferredActivities },
  });

  await prisma.user.update({ where: { id: session.user?.id as string }, data: { onboardingStep: 4 } });

  return NextResponse.json({ ok: true });
}
