import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./config";
import { verifyMobileToken, extractBearerToken } from "./mobile";

export const { auth, handlers, signIn, signOut } = NextAuth(authConfig);

export async function getRequiredSession() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session;
}

export async function getRequestUserId(req: Request): Promise<string> {
  const bearerToken = extractBearerToken(req);
  if (bearerToken) {
    const userId = await verifyMobileToken(bearerToken);
    if (userId) return userId;
  }
  const session = await auth();
  if (session?.user?.id) return session.user.id;
  throw new Error("Unauthorized");
}

/**
 * Use this in route handlers to get the userId and automatically return a
 * clean 401 (instead of an unhandled 500) when the request is unauthenticated.
 *
 * Usage:
 *   const auth = await requireAuth(req);
 *   if (auth instanceof NextResponse) return auth;
 *   const userId = auth;
 */
export async function requireAuth(req: Request): Promise<string | NextResponse> {
  try {
    return await getRequestUserId(req);
  } catch (e) {
    if (e instanceof Error && e.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    throw e;
  }
}
