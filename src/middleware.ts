import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/", "/login", "/register"];
const ONBOARDING_PREFIX = "/onboarding";
const API_PREFIX = "/api";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith(API_PREFIX) || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  // Check for NextAuth session cookie
  const sessionToken =
    req.cookies.get("next-auth.session-token") ||
    req.cookies.get("__Secure-next-auth.session-token");

  if (!sessionToken) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const onboardingComplete = req.cookies.get("onboarding_complete")?.value === "true";

  if (!onboardingComplete && !pathname.startsWith(ONBOARDING_PREFIX)) {
    return NextResponse.redirect(new URL("/onboarding/demographics", req.url));
  }

  if (onboardingComplete && pathname.startsWith(ONBOARDING_PREFIX)) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg).*)"],
};
