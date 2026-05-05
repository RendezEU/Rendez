import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  await getRequestUserId(req); // must be authenticated
  const { userId } = await params;

  const user = await prisma.user.findUnique({
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
  });

  if (!user) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json(user);
}
