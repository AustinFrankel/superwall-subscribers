import { NextResponse } from "next/server";
import { cleanAppName } from "@/lib/format";
import {
  APPS_SQL,
  credsFromRequest,
  parseJsonEachRow,
  runClickHouseQuery,
  validateCreds,
} from "@/lib/superwall";
import type { AppInfo } from "@/lib/types";
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
      { error: originErr, apps: [] },
      { status: 403, headers: apiSecurityHeaders() },
    );
  }

  const ip = clientIp(req);
  const rl = rateLimit(`apps:${ip}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests. Wait a minute and try again.", apps: [] },
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
      { error: "Connect your Superwall account first.", apps: [] },
      { status: 401, headers: apiSecurityHeaders() },
    );
  }

  const invalid = validateCreds(creds);
  if (invalid) {
    return NextResponse.json(
      { error: invalid, apps: [] },
      { status: 400, headers: apiSecurityHeaders() },
    );
  }

  try {
    const raw = await runClickHouseQuery(APPS_SQL, creds);
    const apps = parseJsonEachRow<AppInfo>(raw).map((a) => {
      const applicationId = Number(a.applicationId);
      return {
        applicationId,
        name: cleanAppName(a.name, applicationId),
        platform: a.platform,
      };
    });
    return NextResponse.json(
      { fetchedAt: new Date().toISOString(), apps },
      { headers: apiSecurityHeaders() },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: publicError(err, "Could not load apps."),
        apps: [],
      },
      { status: 500, headers: apiSecurityHeaders() },
    );
  }
}

export async function POST() {
  return NextResponse.json(
    { error: "Method not allowed", apps: [] },
    { status: 405, headers: apiSecurityHeaders({ Allow: "GET" }) },
  );
}
