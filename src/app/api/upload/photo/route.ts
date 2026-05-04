import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/db/client";
import { getRequestUserId } from "@/lib/auth/session";

export async function POST(req: Request) {
  const userId = await getRequestUserId(req);

  const formData = await req.formData();
  const file = formData.get("photo") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No photo provided." }, { status: 400 });
  }

  const ext = file.name.split(".").pop() ?? "jpg";
  const filename = `profiles/${userId}.${ext}`;

  const blob = await put(filename, file, {
    access: "public",
    contentType: file.type,
    addRandomSuffix: false,
  });

  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  await prisma.profilePhoto.upsert({
    where: { id: `${profile.id}-primary` },
    create: {
      id: `${profile.id}-primary`,
      profileId: profile.id,
      url: blob.url,
      isPrimary: true,
      order: 0,
    },
    update: { url: blob.url },
  });

  return NextResponse.json({ url: blob.url });
}
