import { sanitizeHeader } from "@/lib/security";

const API_BASE = "https://api.superwall.com/v2";

export type SuperwallCreds = {
  apiKey: string;
  orgId: string;
};

/**
 * Env credentials only when explicitly enabled (private self-host).
 * Public multi-tenant deploys must NOT set ALLOW_ENV_CREDS — otherwise
 * unauthenticated requests would serve that org's data.
 */
export function getEnvCreds(): SuperwallCreds | null {
  if (process.env.ALLOW_ENV_CREDS !== "1") return null;
  const apiKey = process.env.SUPERWALL_API_KEY?.trim();
  const orgId = process.env.SUPERWALL_ORG_ID?.trim();
  if (!apiKey || !orgId) return null;
  return { apiKey, orgId };
}

export function credsFromRequest(req: Request): SuperwallCreds | null {
  const headerKey = sanitizeHeader(req.headers.get("x-superwall-api-key"), 512);
  const headerOrg = sanitizeHeader(req.headers.get("x-superwall-org-id"), 32);
  if (headerKey && headerOrg) return { apiKey: headerKey, orgId: headerOrg };
  return getEnvCreds();
}

export function validateCreds(creds: SuperwallCreds): string | null {
  if (!/^\d{1,18}$/.test(creds.orgId)) {
    return "Organization ID should be a number (digits only).";
  }
  // Superwall org API keys are long opaque strings; reject obvious junk
  if (creds.apiKey.length < 16 || creds.apiKey.length > 512) {
    return "That API key looks wrong. Create a key with data:read in Superwall.";
  }
  if (/\s/.test(creds.apiKey)) {
    return "API key should not contain spaces. Paste it carefully.";
  }
  // Block obvious injection attempts in headers that get forwarded
  if (/[\r\n]/.test(creds.apiKey) || /[\r\n]/.test(creds.orgId)) {
    return "Invalid characters in credentials.";
  }
  return null;
}

/** Strict allowlist — only these exact static strings may be sent to Superwall. */
const ALLOWED_SQL = new Set<string>();

function registerAllowedSql(sql: string): string {
  ALLOWED_SQL.add(sql);
  return sql;
}

export async function runClickHouseQuery(
  sql: string,
  creds: SuperwallCreds,
): Promise<string> {
  // Defense in depth: exact allowlist only (no user input ever reaches here)
  if (!ALLOWED_SQL.has(sql)) {
    throw new Error("Invalid query.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(`${API_BASE}/organizations/${encodeURIComponent(creds.orgId)}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "text/plain",
        Accept: "*/*",
        "User-Agent": "SuperwallSubscribersDashboard/1.1",
      },
      body: sql,
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          "Superwall rejected these credentials. Check the org ID and that the key has data:read.",
        );
      }
      if (res.status === 429) {
        throw new Error("Superwall is rate-limiting requests. Wait a minute and try again.");
      }
      // Do not forward raw Superwall error bodies (may contain internal detail)
      throw new Error(`Superwall Query API returned ${res.status}. Try again in a moment.`);
    }
    return text;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Superwall query timed out. Try again in a moment.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export function parseJsonEachRow<T>(raw: string): T[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") && trimmed.includes('"type":"api_error"')) {
    throw new Error("Superwall returned an API error. Check credentials and try again.");
  }
  const lines = trimmed.split("\n").filter(Boolean);
  // Hard cap rows parsed client-side for memory safety
  const max = 50_000;
  const slice = lines.length > max ? lines.slice(0, max) : lines;
  const out: T[] = [];
  for (const line of slice) {
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // skip corrupt lines rather than failing the whole payload
    }
  }
  return out;
}

/** Prefer human app names over numeric App Store IDs when both exist. */
export const APPS_SQL = registerAllowedSql(`
SELECT
  applicationId,
  coalesce(
    nullIf(anyIf(name, NOT match(name, '^[0-9]+$')), ''),
    any(name)
  ) AS name,
  any(platform) AS platform
FROM sw.applications_rep
WHERE isDeleted = 0
GROUP BY applicationId
ORDER BY name, platform
FORMAT JSONEachRow
`.trim());

export const PING_SQL = registerAllowedSql(`
SELECT count() AS apps
FROM (
  SELECT applicationId
  FROM sw.applications_rep
  WHERE isDeleted = 0
  GROUP BY applicationId
)
FORMAT JSONEachRow
`.trim());

/**
 * All subscribers across apps in the connected Superwall org.
 * Uses revenue + status + usage. Infers next billing when expiration is missing.
 * Static SQL only — no user input is ever interpolated.
 */
export const USERS_SQL = registerAllowedSql(`
WITH
apps AS (
  SELECT
    applicationId,
    coalesce(
      nullIf(anyIf(name, NOT match(name, '^[0-9]+$')), ''),
      any(name)
    ) AS appName,
    any(platform) AS platform
  FROM sw.applications_rep
  WHERE isDeleted = 0
  GROUP BY applicationId
),
catalog AS (
  SELECT
    productId,
    maxIf(toFloat64OrZero(toString(price)), toFloat64OrZero(toString(price)) > 0) AS catalogPrice,
    anyIf(currencyCode, toFloat64OrZero(toString(price)) > 0) AS catalogCurrency
  FROM open_revenue.attributed_events_by_ts_rep
  WHERE isSandbox = 0
    AND productId IS NOT NULL
    AND productId != ''
  GROUP BY productId
),
latest_status AS (
  SELECT
    appUserId,
    applicationId,
    upper(
      argMax(
        coalesce(
          nullIf(JSONExtractString(props, '$status'), ''),
          nullIf(JSONExtractString(props, '$subscription_status'), ''),
          'UNKNOWN'
        ),
        ts
      )
    ) AS status,
    nullIf(argMax(JSONExtractString(props, '$active_entitlement_ids'), ts), '') AS entitlements,
    max(ts) AS lastStatusAt
  FROM sw.subscription_status_rep
  WHERE isSandbox = 0 AND isDeleted = 0
  GROUP BY appUserId, applicationId
),
revenue AS (
  SELECT
    appUserId,
    applicationId,
    sumIf(
      toFloat64OrZero(toString(price)),
      name IN ('initial_purchase', 'renewal', 'non_renewing_purchase') AND isRefund = 0
    ) AS ltv,
    argMaxIf(
      toFloat64OrZero(toString(price)),
      ts,
      name IN ('initial_purchase', 'renewal', 'non_renewing_purchase')
    ) AS lastPrice,
    nullIf(
      maxIf(
        toFloat64OrZero(toString(price)),
        name IN ('initial_purchase', 'renewal', 'non_renewing_purchase')
          AND toFloat64OrZero(toString(price)) > 0
      ),
      0
    ) AS paidPrice,
    coalesce(
      nullIf(
        argMaxIf(
          productId,
          ts,
          name IN ('initial_purchase', 'renewal', 'non_renewing_purchase')
            AND productId IS NOT NULL
            AND productId != ''
        ),
        ''
      ),
      nullIf(
        argMaxIf(
          productId,
          ts,
          name = 'transaction_complete'
            AND productId IS NOT NULL
            AND productId != ''
        ),
        ''
      )
    ) AS productId,
    argMaxIf(
      periodType,
      ts,
      name IN ('initial_purchase', 'renewal', 'non_renewing_purchase')
        AND periodType IS NOT NULL
        AND periodType != ''
    ) AS periodType,
    nullIf(
      argMaxIf(
        expirationAt,
        ts,
        name IN (
          'initial_purchase',
          'renewal',
          'cancellation',
          'uncancellation',
          'expiration',
          'billing_issue'
        )
          AND expirationAt IS NOT NULL
          AND expirationAt > toDateTime64('2000-01-01', 6, 'UTC')
      ),
      toDateTime64('1970-01-01', 6, 'UTC')
    ) AS rawNextBillingAt,
    nullIf(
      maxIf(
        purchasedAt,
        name IN ('initial_purchase', 'renewal', 'non_renewing_purchase', 'transaction_complete')
          AND purchasedAt IS NOT NULL
          AND purchasedAt > toDateTime64('2000-01-01', 6, 'UTC')
      ),
      toDateTime64('1970-01-01', 6, 'UTC')
    ) AS periodStartAt,
    nullIf(
      minIf(
        purchasedAt,
        name IN ('initial_purchase', 'transaction_complete')
          AND purchasedAt IS NOT NULL
          AND purchasedAt > toDateTime64('2000-01-01', 6, 'UTC')
      ),
      toDateTime64('1970-01-01', 6, 'UTC')
    ) AS firstPurchaseAt,
    nullIf(
      maxIf(
        purchasedAt,
        name IN ('initial_purchase', 'renewal', 'non_renewing_purchase', 'transaction_complete')
          AND purchasedAt IS NOT NULL
          AND purchasedAt > toDateTime64('2000-01-01', 6, 'UTC')
      ),
      toDateTime64('1970-01-01', 6, 'UTC')
    ) AS lastPurchaseAt,
    argMaxIf(
      currencyCode,
      ts,
      name IN ('initial_purchase', 'renewal', 'non_renewing_purchase')
        AND currencyCode IS NOT NULL
        AND currencyCode != ''
    ) AS currencyCode,
    argMaxIf(
      countryCode,
      ts,
      name IN ('initial_purchase', 'renewal', 'non_renewing_purchase', 'transaction_complete')
        AND countryCode IS NOT NULL
        AND countryCode != ''
    ) AS countryCode,
    argMaxIf(
      store,
      ts,
      name IN ('initial_purchase', 'renewal', 'non_renewing_purchase', 'cancellation', 'transaction_complete')
        AND store IS NOT NULL
        AND store != ''
    ) AS store,
    argMaxIf(
      environment,
      ts,
      name IN ('initial_purchase', 'renewal', 'non_renewing_purchase')
        AND environment IS NOT NULL
        AND environment != ''
    ) AS lastEnvironment,
    maxIf(ts, name = 'cancellation') AS lastCancelAt,
    argMaxIf(cancelReason, ts, name = 'cancellation') AS cancelReason,
    maxIf(ts, name = 'uncancellation') AS lastUncancelAt,
    countIf(name IN ('initial_purchase', 'renewal', 'non_renewing_purchase')) AS purchaseCount
  FROM open_revenue.attributed_events_by_ts_rep
  WHERE isSandbox = 0
    AND appUserId IS NOT NULL
    AND (
      environment = 'PRODUCTION'
      OR environment = ''
      OR environment IS NULL
    )
  GROUP BY appUserId, applicationId
),
usage AS (
  SELECT
    appUserId,
    applicationId,
    countIf(
      name IN ('app_open', 'session_start', 'app_launch')
      AND ts >= now() - INTERVAL 7 DAY
    ) AS sessions7d,
    countIf(name IN ('app_open', 'session_start', 'app_launch')) AS sessions30d,
    nullIf(
      maxIf(
        ts,
        name IN ('app_open', 'session_start', 'app_launch')
          AND ts > toDateTime64('2000-01-01', 6, 'UTC')
      ),
      toDateTime64('1970-01-01', 6, 'UTC')
    ) AS lastActiveAt
  FROM sw.events_rep
  WHERE isSandbox = 0
    AND isDeleted = 0
    AND ts >= now() - INTERVAL 30 DAY
  GROUP BY appUserId, applicationId
),
enriched AS (
  SELECT
    r.*,
    multiIf(
      positionCaseInsensitive(coalesce(r.productId, ''), 'weekly') > 0, 7,
      positionCaseInsensitive(coalesce(r.productId, ''), 'monthly') > 0, 30,
      positionCaseInsensitive(coalesce(r.productId, ''), 'quarterly') > 0, 90,
      positionCaseInsensitive(coalesce(r.productId, ''), 'yearly') > 0, 365,
      positionCaseInsensitive(coalesce(r.productId, ''), 'annual') > 0, 365,
      positionCaseInsensitive(coalesce(r.productId, ''), 'lifetime') > 0, NULL,
      upper(coalesce(r.periodType, '')) = 'TRIAL', 3,
      NULL
    ) AS inferredPeriodDays,
    c.catalogPrice AS catalogPrice,
    c.catalogCurrency AS catalogCurrency
  FROM revenue AS r
  LEFT JOIN catalog AS c ON c.productId = r.productId
),
with_billing AS (
  SELECT
    e.*,
    if(
      e.periodStartAt IS NOT NULL AND e.inferredPeriodDays IS NOT NULL,
      e.periodStartAt + toIntervalDay(
        e.inferredPeriodDays * (
          intDiv(
            greatest(dateDiff('day', e.periodStartAt, now()), 0),
            e.inferredPeriodDays
          ) + 1
        )
      ),
      NULL
    ) AS inferredNextBillingAt
  FROM enriched AS e
)
SELECT
  coalesce(s.appUserId, e.appUserId) AS appUserId,
  coalesce(s.applicationId, e.applicationId) AS applicationId,
  coalesce(
    a.appName,
    concat('App ', toString(coalesce(s.applicationId, e.applicationId)))
  ) AS appName,
  coalesce(a.platform, '') AS platform,
  coalesce(s.status, if(e.ltv > 0, 'UNKNOWN', 'INACTIVE')) AS status,
  s.entitlements AS entitlements,
  if(
    s.lastStatusAt IS NULL OR s.lastStatusAt <= toDateTime64('2000-01-01', 6, 'UTC'),
    NULL,
    s.lastStatusAt
  ) AS lastStatusAt,
  coalesce(e.ltv, 0) AS ltv,
  e.lastPrice AS lastPrice,
  e.paidPrice AS paidPrice,
  e.catalogPrice AS catalogPrice,
  e.productId AS productId,
  e.periodType AS periodType,
  multiIf(
    e.rawNextBillingAt IS NOT NULL AND e.rawNextBillingAt >= now(), e.rawNextBillingAt,
    e.inferredNextBillingAt IS NOT NULL, e.inferredNextBillingAt,
    e.rawNextBillingAt
  ) AS nextBillingAt,
  e.periodStartAt AS periodStartAt,
  if(
    multiIf(
      e.rawNextBillingAt IS NOT NULL AND e.rawNextBillingAt >= now(), e.rawNextBillingAt,
      e.inferredNextBillingAt IS NOT NULL, e.inferredNextBillingAt,
      e.rawNextBillingAt
    ) IS NULL,
    NULL,
    dateDiff(
      'day',
      now(),
      multiIf(
        e.rawNextBillingAt IS NOT NULL AND e.rawNextBillingAt >= now(), e.rawNextBillingAt,
        e.inferredNextBillingAt IS NOT NULL, e.inferredNextBillingAt,
        e.rawNextBillingAt
      )
    )
  ) AS daysUntilBilling,
  coalesce(
    if(
      e.rawNextBillingAt IS NOT NULL
        AND e.periodStartAt IS NOT NULL
        AND e.rawNextBillingAt > e.periodStartAt,
      dateDiff('day', e.periodStartAt, e.rawNextBillingAt),
      NULL
    ),
    e.inferredPeriodDays
  ) AS billingPeriodDays,
  e.firstPurchaseAt AS firstPurchaseAt,
  e.lastPurchaseAt AS lastPurchaseAt,
  coalesce(e.currencyCode, e.catalogCurrency) AS currencyCode,
  e.countryCode AS countryCode,
  e.cancelReason AS cancelReason,
  if(
    e.lastCancelAt IS NOT NULL
      AND e.lastCancelAt > coalesce(e.lastUncancelAt, toDateTime64('1970-01-01', 6, 'UTC'))
      AND upper(coalesce(s.status, '')) = 'ACTIVE',
    1,
    0
  ) AS willCancel,
  if(
    e.lastCancelAt IS NOT NULL
      AND e.lastCancelAt > coalesce(e.lastUncancelAt, toDateTime64('1970-01-01', 6, 'UTC')),
    1,
    0
  ) AS isCancelled,
  coalesce(e.purchaseCount, 0) AS purchaseCount,
  coalesce(u.sessions7d, 0) AS sessions7d,
  coalesce(u.sessions30d, 0) AS sessions30d,
  u.lastActiveAt AS lastActiveAt,
  e.store AS store,
  e.lastEnvironment AS environment
FROM latest_status AS s
FULL OUTER JOIN with_billing AS e
  ON s.appUserId = e.appUserId AND s.applicationId = e.applicationId
LEFT JOIN apps AS a
  ON a.applicationId = coalesce(s.applicationId, e.applicationId)
LEFT JOIN usage AS u
  ON u.appUserId = coalesce(s.appUserId, e.appUserId)
  AND u.applicationId = coalesce(s.applicationId, e.applicationId)
WHERE
  upper(coalesce(s.status, '')) = 'ACTIVE'
  OR coalesce(e.ltv, 0) > 0
  OR e.firstPurchaseAt IS NOT NULL
  OR e.productId IS NOT NULL
ORDER BY
  if(upper(coalesce(s.status, '')) = 'ACTIVE', 0, 1) ASC,
  coalesce(
    multiIf(
      e.rawNextBillingAt IS NOT NULL AND e.rawNextBillingAt >= now(), e.rawNextBillingAt,
      e.inferredNextBillingAt IS NOT NULL, e.inferredNextBillingAt,
      e.rawNextBillingAt
    ),
    toDateTime64('2099-01-01', 6, 'UTC')
  ) ASC,
  coalesce(e.ltv, 0) DESC
LIMIT 50000
FORMAT JSONEachRow
`.trim());
