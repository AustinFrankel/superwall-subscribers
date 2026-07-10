import { NextResponse } from "next/server";

/**
 * Global security headers for every response.
 * API routes add their own no-store headers on top.
 */
export function middleware() {
  const res = NextResponse.next();

  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.headers.set("X-DNS-Prefetch-Control", "on");
  // HSTS only meaningful on HTTPS (Vercel provides HTTPS)
  res.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload",
  );
  // CSP: app + Buy Me a Coffee widget
  res.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.buymeacoffee.com",
      "style-src 'self' 'unsafe-inline' https://cdnjs.buymeacoffee.com https://fonts.googleapis.com",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://cdnjs.buymeacoffee.com https://fonts.gstatic.com",
      "connect-src 'self' https://www.buymeacoffee.com https://buymeacoffee.com https://cdnjs.buymeacoffee.com",
      "frame-src https://www.buymeacoffee.com https://buymeacoffee.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self' https://www.buymeacoffee.com https://buymeacoffee.com",
      "object-src 'none'",
    ].join("; "),
  );

  return res;
}

export const config = {
  matcher: [
    /*
     * Match all paths except static assets and Next internals.
     */
    "/((?!_next/static|_next/image|favicon.ico|guide/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
