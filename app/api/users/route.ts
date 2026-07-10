import { NextResponse } from "next/server";
import {
  cleanAppName,
  displayUserId,
  humanProduct,
  periodLabel,
  priceLabel,
  renewProgressPct,
  sanitizeDate,
  statusLabel,
  inferPeriodDays,
} from "@/lib/format";
import {
  APPS_SQL,
  USERS_SQL,
  credsFromRequest,
  parseJsonEachRow,
  runClickHouseQuery,
  validateCreds,
} from "@/lib/superwall";
import type { AppInfo, SubscriberRow, UsersResponse } from "@/lib/types";
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
export const maxDuration = 120;

const LIMIT = 12;
const WINDOW_MS = 60_000;

type RawUser = {
  appUserId: string;
  applicationId: number | string;
  appName: string;
  platform: string;
  status: string;
  entitlements: string | null;
  lastStatusAt: string | null;
  ltv: number | string;
  lastPrice: number | string | null;
  paidPrice: number | string | null;
  catalogPrice: number | string | null;
  productId: string | null;
  periodType: string | null;
  nextBillingAt: string | null;
  periodStartAt: string | null;
  daysUntilBilling: number | string | null;
  billingPeriodDays: number | string | null;
  firstPurchaseAt: string | null;
  lastPurchaseAt: string | null;
  currencyCode: string | null;
  countryCode: string | null;
  cancelReason: string | null;
  willCancel: number | string | boolean;
  isCancelled: number | string | boolean;
  purchaseCount: number | string;
  sessions7d: number | string;
  sessions30d: number | string;
  lastActiveAt: string | null;
  store: string | null;
  environment: string | null;
};

function toNum(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBool(v: number | string | boolean | null | undefined): boolean {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1" || v === "true") return true;
  return false;
}

function emptyBody(error: string): UsersResponse {
  return {
    fetchedAt: new Date().toISOString(),
    count: 0,
    totalAvailable: 0,
    apps: [],
    users: [],
    error,
  };
}

function mapUser(row: RawUser): SubscriberRow {
  const applicationId = Number(row.applicationId);
  const isCancelled = toBool(row.isCancelled);
  const willCancel = toBool(row.willCancel);
  const status = (row.status || "UNKNOWN").toUpperCase();
  const periodType = row.periodType;
  const productId = row.productId;
  const nextBillingAt = sanitizeDate(row.nextBillingAt);
  const periodStartAt = sanitizeDate(row.periodStartAt);
  const lastPrice = toNum(row.lastPrice);
  const paidPrice = toNum(row.paidPrice);
  const catalogPrice = toNum(row.catalogPrice);
  const billingPeriodDays = inferPeriodDays(
    toNum(row.billingPeriodDays),
    productId,
    periodType,
  );
  const autoRenew = status === "ACTIVE" && !willCancel && !isCancelled;

  return {
    appUserId: String(row.appUserId || "").slice(0, 512),
    displayUserId: displayUserId(String(row.appUserId || "")),
    applicationId,
    appName: cleanAppName(row.appName, applicationId),
    platform: (row.platform || "").slice(0, 64),
    status,
    statusLabel: statusLabel({ status, willCancel, isCancelled, periodType }),
    entitlements: row.entitlements,
    lastStatusAt: sanitizeDate(row.lastStatusAt),
    ltv: toNum(row.ltv) ?? 0,
    lastPrice,
    paidPrice,
    catalogPrice,
    priceLabel: priceLabel({
      lastPrice,
      paidPrice,
      catalogPrice,
      periodType,
      currencyCode: row.currencyCode,
    }),
    productId,
    productLabel: humanProduct(productId),
    periodType,
    periodLabel: periodLabel(periodType, productId),
    nextBillingAt,
    periodStartAt,
    daysUntilBilling: nextBillingAt ? toNum(row.daysUntilBilling) : null,
    billingPeriodDays,
    renewProgress: renewProgressPct({
      autoRenew: status === "ACTIVE" && !isCancelled,
      willCancel,
      nextBillingAt,
      periodStartAt,
      billingPeriodDays: toNum(row.billingPeriodDays),
      productId,
      periodType,
    }),
    firstPurchaseAt: sanitizeDate(row.firstPurchaseAt),
    lastPurchaseAt: sanitizeDate(row.lastPurchaseAt),
    currencyCode: row.currencyCode,
    countryCode: row.countryCode,
    cancelReason: row.cancelReason,
    willCancel,
    isCancelled,
    autoRenew,
    purchaseCount: toNum(row.purchaseCount) ?? 0,
    sessions7d: toNum(row.sessions7d) ?? 0,
    sessions30d: toNum(row.sessions30d) ?? 0,
    lastActiveAt: sanitizeDate(row.lastActiveAt),
    store: row.store,
    environment: row.environment,
  };
}

export async function GET(req: Request) {
  const originErr = assertBrowserOrigin(req);
  if (originErr) {
    return NextResponse.json(emptyBody(originErr), {
      status: 403,
      headers: apiSecurityHeaders(),
    });
  }

  const creds = credsFromRequest(req);
  const rl = await rateLimitAsync(
    rateLimitKey("users", req, creds?.apiKey, creds?.orgId),
    LIMIT,
    WINDOW_MS,
  );
  if (!rl.ok) {
    return NextResponse.json(
      emptyBody("Too many requests. Wait a minute and try again."),
      {
        status: 429,
        headers: apiSecurityHeaders(rateLimitHeaders(rl, LIMIT)),
      },
    );
  }

  if (!creds) {
    return NextResponse.json(
      emptyBody("Connect your Superwall account first."),
      { status: 401, headers: apiSecurityHeaders() },
    );
  }

  const invalid = validateCreds(creds);
  if (invalid) {
    return NextResponse.json(emptyBody(invalid), {
      status: 400,
      headers: apiSecurityHeaders(),
    });
  }

  try {
    const [usersRaw, appsRaw] = await Promise.all([
      runClickHouseQuery(USERS_SQL, creds),
      runClickHouseQuery(APPS_SQL, creds),
    ]);

    const users = parseJsonEachRow<RawUser>(usersRaw).map(mapUser);
    const apps = parseJsonEachRow<AppInfo>(appsRaw).map((a) => {
      const applicationId = Number(a.applicationId);
      return {
        applicationId,
        name: cleanAppName(a.name, applicationId),
        platform: a.platform,
      };
    });

    const body: UsersResponse = {
      fetchedAt: new Date().toISOString(),
      count: users.length,
      totalAvailable: users.length,
      apps,
      users,
    };

    return NextResponse.json(body, {
      headers: apiSecurityHeaders({
        "X-RateLimit-Remaining": String(rl.remaining),
        "X-RateLimit-Backend": rl.backend,
      }),
    });
  } catch (err) {
    return NextResponse.json(
      emptyBody(publicError(err, "Could not load subscribers.")),
      { status: 500, headers: apiSecurityHeaders() },
    );
  }
}

export async function POST() {
  return NextResponse.json(emptyBody("Method not allowed"), {
    status: 405,
    headers: apiSecurityHeaders({ Allow: "GET" }),
  });
}
