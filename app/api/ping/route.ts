import { NextResponse } from "next/server";
import {
  PING_SQL,
  parseJsonEachRow,
  resolveCredsFromRequest,
  runClickHouseQuery,
} from "@/lib/superwall";
import {
  apiSecurityHeaders,
  assertBrowserOrigin,
  publicError,
  rateLimitAsync,
  rateLimitHeaders,
  rateLimitKey,
} from "@/lib/security";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Light limit — connect + refresh; protect abuse without blocking normal use
const LIMIT = 120;
const WINDOW_MS = 60_000;

export async function GET(req: Request) {
  const originErr = assertBrowserOrigin(req);
  if (originErr) {
    return NextResponse.json(
      { ok: false, error: originErr },
      { status: 403, headers: apiSecurityHeaders() },
    );
  }

  const { creds, error: credsError } = await resolveCredsFromRequest(req);

  const rl = await rateLimitAsync(
    rateLimitKey("ping", req, creds?.apiKey, creds?.orgId),
    LIMIT,
    WINDOW_MS,
  );
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Wait a minute." },
      {
        status: 429,
        headers: apiSecurityHeaders(rateLimitHeaders(rl, LIMIT)),
      },
    );
  }

  if (!creds) {
    return NextResponse.json(
      {
        ok: false,
        error: credsError || "Paste your Superwall Organization API key.",
      },
      { status: 401, headers: apiSecurityHeaders() },
    );
  }

  try {
    const raw = await runClickHouseQuery(PING_SQL, creds);
    const rows = parseJsonEachRow<{ apps: number | string }>(raw);
    const apps = Number(rows[0]?.apps ?? 0);
    return NextResponse.json(
      {
        ok: true,
        apps,
        orgId: creds.orgId,
      },
      {
        headers: apiSecurityHeaders({
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Backend": rl.backend,
        }),
      },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: publicError(err, "Could not reach Superwall.") },
      { status: 500, headers: apiSecurityHeaders() },
    );
  }
}

export async function POST() {
  return NextResponse.json(
    { ok: false, error: "Method not allowed" },
    { status: 405, headers: apiSecurityHeaders({ Allow: "GET" }) },
  );
}
