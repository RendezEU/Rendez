import NextAuth from "next-auth";
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
