import { NextResponse } from "next/server";
import { cleanAppName } from "@/lib/format";
import {
  APPS_SQL,
  parseJsonEachRow,
  resolveCredsFromRequest,
  runClickHouseQuery,
} from "@/lib/superwall";
import type { AppInfo } from "@/lib/types";
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

const LIMIT = 90;
const WINDOW_MS = 60_000;

export async function GET(req: Request) {
  const originErr = assertBrowserOrigin(req);
  if (originErr) {
    return NextResponse.json(
      { error: originErr, apps: [] },
      { status: 403, headers: apiSecurityHeaders() },
    );
  }

  const { creds, error: credsError } = await resolveCredsFromRequest(req);
  const rl = await rateLimitAsync(
    rateLimitKey("apps", req, creds?.apiKey, creds?.orgId),
    LIMIT,
    WINDOW_MS,
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests. Wait a minute.", apps: [] },
      {
        status: 429,
        headers: apiSecurityHeaders(rateLimitHeaders(rl, LIMIT)),
      },
    );
  }

  if (!creds) {
    return NextResponse.json(
      { error: credsError || "Connect first.", apps: [] },
      { status: 401, headers: apiSecurityHeaders() },
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
      {
        headers: apiSecurityHeaders({
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Backend": rl.backend,
        }),
      },
    );
  } catch (err) {
    return NextResponse.json(
      { error: publicError(err, "Could not load apps."), apps: [] },
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
