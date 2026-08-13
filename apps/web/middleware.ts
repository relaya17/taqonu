import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

/**
 * Entry UX: cinematic promo first.
 * Default next-intl would map `/` → `/he` (dashboard). Send `/` → `/he/welcome`.
 * Dashboard stays at `/he` (CTA “למערכת”).
 */
export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/" || pathname === "") {
    const url = request.nextUrl.clone();
    url.pathname = "/he/welcome";
    return NextResponse.redirect(url);
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: ["/", "/(he|en|ar)/:path*"],
};
