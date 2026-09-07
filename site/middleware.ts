import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

export default function middleware(request: NextRequest) {
  // Keep server endpoints outside locale routing even when a host compiles the
  // matcher below to a broader pattern.
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
  return intlMiddleware(request);
}

export const config = {
  // Run on everything except API routes, Next internals, and files with an extension.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
