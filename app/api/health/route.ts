import { NextResponse } from "next/server";
import { apiSecurityHeaders, hasRedisRateLimit } from "@/lib/security";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Public health check — no secrets, no Superwall calls.
 * Useful for uptime monitors and deploy smoke tests.
 */
export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: "superwall-subscribers",
      time: new Date().toISOString(),
      rateLimit: hasRedisRateLimit() ? "redis" : "memory",
      // Never report env creds status in a way that leaks whether keys exist
      envCredsEnabled: process.env.ALLOW_ENV_CREDS === "1",
    },
    {
      headers: apiSecurityHeaders({
        "Cache-Control": "no-store",
      }),
    },
  );
}
