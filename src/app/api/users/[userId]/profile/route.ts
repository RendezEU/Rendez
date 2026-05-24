import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const authCheck = await requireAuth(req);
  if (authCheck instanceof NextResponse) return authCheck;
  const { userId } = await params;

  const [user, datesCompleted] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        profile: {
          include: {
            photos: true,
            promptAnswers: true,
          },
        },
      },
    }),
    prisma.match.count({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
        status: { in: ["COMPLETED", "CONNECTED"] },
      },
    }),
  ]);

  if (!user) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json({ ...user, datesCompleted });
}
