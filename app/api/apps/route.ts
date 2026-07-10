import { NextResponse } from "next/server";
import { cleanAppName } from "@/lib/format";
import {
  APPS_SQL,
  credsFromRequest,
  parseJsonEachRow,
  runClickHouseQuery,
} from "@/lib/superwall";
import type { AppInfo } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const creds = credsFromRequest(req);
  if (!creds) {
    return NextResponse.json(
      { error: "Connect your Superwall account first.", apps: [] },
      { status: 401 },
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
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message, apps: [] }, { status: 500 });
  }
}
