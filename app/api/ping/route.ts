import { NextResponse } from "next/server";
import {
  PING_SQL,
  credsFromRequest,
  parseJsonEachRow,
  runClickHouseQuery,
  validateCreds,
} from "@/lib/superwall";
import {
  apiSecurityHeaders,
  assertBrowserOrigin,
  clientIp,
  publicError,
  rateLimit,
} from "@/lib/security";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const originErr = assertBrowserOrigin(req);
  if (originErr) {
    return NextResponse.json(
      { ok: false, error: originErr },
      { status: 403, headers: apiSecurityHeaders() },
    );
  }

  const ip = clientIp(req);
  const rl = rateLimit(`ping:${ip}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Wait a minute and try again." },
      {
        status: 429,
        headers: apiSecurityHeaders({
          "Retry-After": String(rl.retryAfterSec),
        }),
      },
    );
  }

  const creds = credsFromRequest(req);
  if (!creds) {
    return NextResponse.json(
      { ok: false, error: "Connect your Superwall account first." },
      { status: 401, headers: apiSecurityHeaders() },
    );
  }

  const invalid = validateCreds(creds);
  if (invalid) {
    return NextResponse.json(
      { ok: false, error: invalid },
      { status: 400, headers: apiSecurityHeaders() },
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
      { headers: apiSecurityHeaders() },
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
