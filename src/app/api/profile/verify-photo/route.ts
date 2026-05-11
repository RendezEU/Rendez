import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export async function POST(req: Request) {
  const userId = await getRequestUserId(req);

  const profile = await prisma.profile.findUnique({
    where: { userId },
    include: { photos: { where: { isPrimary: true }, take: 1 } },
  });

  if (!profile) return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  if (profile.photoVerified) return NextResponse.json({ verified: true, alreadyVerified: true });

  const primaryPhoto = profile.photos[0];
  if (!primaryPhoto?.url) {
    return NextResponse.json({ error: "Upload a profile photo first." }, { status: 400 });
  }

  // Use Claude to check if the photo appears to contain a real person
  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "url", url: primaryPhoto.url },
            },
            {
              type: "text",
              text: 'Does this image contain a clear photo of a real human face? Reply with only "YES" or "NO".',
            },
          ],
        },
      ],
    });

    const answer = response.content[0].type === "text" ? response.content[0].text.trim().toUpperCase() : "NO";
    if (!answer.startsWith("YES")) {
      return NextResponse.json({ verified: false, reason: "Photo must clearly show your face." });
    }
  } catch {
    // If AI check fails, fall through and mark verified (fail-open to not block users)
  }

  await prisma.profile.update({
    where: { userId },
    data: { photoVerified: true },
  });

  return NextResponse.json({ verified: true });
}
