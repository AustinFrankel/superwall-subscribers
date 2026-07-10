import { NextResponse } from "next/server";
import {
  PING_SQL,
  credsFromRequest,
  parseJsonEachRow,
  runClickHouseQuery,
  validateCreds,
} from "@/lib/superwall";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const creds = credsFromRequest(req);
  if (!creds) {
    return NextResponse.json(
      { ok: false, error: "Connect your Superwall account first." },
      { status: 401 },
    );
  }

  const invalid = validateCreds(creds);
  if (invalid) {
    return NextResponse.json({ ok: false, error: invalid }, { status: 400 });
  }

  try {
    const raw = await runClickHouseQuery(PING_SQL, creds);
    const rows = parseJsonEachRow<{ apps: number | string }>(raw);
    const apps = Number(rows[0]?.apps ?? 0);
    return NextResponse.json({
      ok: true,
      apps,
      orgId: creds.orgId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
