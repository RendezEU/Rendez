import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/db/client";
import { requireAuth } from "@/lib/auth/session";

export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const formData = await req.formData();
  const file = formData.get("photo") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No photo provided." }, { status: 400 });
  }

  // Validate MIME type server-side — don't trust the client's Content-Type
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Only JPEG, PNG, WebP, and HEIC images are allowed." },
      { status: 415 }
    );
  }

  // Enforce a 10 MB size limit
  const MAX_BYTES = 10 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Photo must be under 10 MB." }, { status: 413 });
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
