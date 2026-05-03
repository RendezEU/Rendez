import { auth } from "@/lib/auth/session";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/", "/login", "/register"];
const ONBOARDING_PREFIX = "/onboarding";
const API_PREFIX = "/api";

export default auth(async function middleware(req: NextRequest & { auth: unknown }) {
  const { pathname } = req.nextUrl;
  const session = (req as unknown as { auth: { user?: { id?: string } } | null }).auth;
  const isAuthenticated = !!session?.user?.id;

  // Always allow public paths and API routes
  if (PUBLIC_PATHS.includes(pathname) || pathname.startsWith(API_PREFIX)) {
    return NextResponse.next();
  }

  // Not logged in → redirect to login
  if (!isAuthenticated) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Check onboarding status from cookie (set by API after each step)
  const onboardingComplete = req.cookies.get("onboarding_complete")?.value === "true";

  if (!onboardingComplete && !pathname.startsWith(ONBOARDING_PREFIX)) {
    return NextResponse.redirect(new URL("/onboarding/demographics", req.url));
  }

  if (onboardingComplete && pathname.startsWith(ONBOARDING_PREFIX)) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg).*)"],
};
