const API_BASE = "https://api.superwall.com/v2";

export type SuperwallCreds = {
  apiKey: string;
  orgId: string;
};

export function getEnvCreds(): SuperwallCreds | null {
  const apiKey = process.env.SUPERWALL_API_KEY?.trim();
  const orgId = process.env.SUPERWALL_ORG_ID?.trim();
  if (!apiKey || !orgId) return null;
  return { apiKey, orgId };
}

export function credsFromRequest(req: Request): SuperwallCreds | null {
  const apiKey = req.headers.get("x-superwall-api-key")?.trim();
  const orgId = req.headers.get("x-superwall-org-id")?.trim();
  if (apiKey && orgId) return { apiKey, orgId };
  return getEnvCreds();
}

export async function runClickHouseQuery(
  sql: string,
  creds: SuperwallCreds,
): Promise<string> {
  const res = await fetch(`${API_BASE}/organizations/${creds.orgId}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      "Content-Type": "text/plain",
    },
    body: sql,
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Superwall Query API ${res.status}: ${text.slice(0, 500)}`);
  }
  return text;
}

export function parseJsonEachRow<T>(raw: string): T[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") && trimmed.includes('"type":"api_error"')) {
    throw new Error(trimmed.slice(0, 500));
  }
  return trimmed
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export const APPS_SQL = `
SELECT
  applicationId,
  any(name) AS name,
  any(platform) AS platform
FROM sw.applications_rep
WHERE isDeleted = 0
GROUP BY applicationId
ORDER BY name, platform
FORMAT JSONEachRow
`.trim();

/** All subscribers across apps in the connected Superwall org. */
export const USERS_SQL = `
WITH
apps AS (
  SELECT
    applicationId,
    any(name) AS appName,
    any(platform) AS platform
  FROM sw.applications_rep
  WHERE isDeleted = 0
  GROUP BY applicationId
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
    maxIf(
      toFloat64OrZero(toString(price)),
      name IN ('initial_purchase', 'renewal', 'non_renewing_purchase')
        AND toFloat64OrZero(toString(price)) > 0
    ) AS paidPrice,
    argMaxIf(
      productId,
      ts,
      name IN ('initial_purchase', 'renewal', 'non_renewing_purchase')
    ) AS productId,
    argMaxIf(
      periodType,
      ts,
      name IN ('initial_purchase', 'renewal', 'non_renewing_purchase')
    ) AS periodType,
    nullIf(
      argMaxIf(
        expirationAt,
        ts,
        name IN ('initial_purchase', 'renewal', 'cancellation', 'uncancellation', 'expiration')
          AND expirationAt IS NOT NULL
          AND expirationAt > toDateTime64('2000-01-01', 6, 'UTC')
      ),
      toDateTime64('1970-01-01', 6, 'UTC')
    ) AS nextBillingAt,
    nullIf(
      maxIf(
        purchasedAt,
        name IN ('initial_purchase', 'renewal', 'non_renewing_purchase')
          AND purchasedAt IS NOT NULL
          AND purchasedAt > toDateTime64('2000-01-01', 6, 'UTC')
      ),
      toDateTime64('1970-01-01', 6, 'UTC')
    ) AS periodStartAt,
    nullIf(
      minIf(
        purchasedAt,
        name = 'initial_purchase'
          AND purchasedAt IS NOT NULL
          AND purchasedAt > toDateTime64('2000-01-01', 6, 'UTC')
      ),
      toDateTime64('1970-01-01', 6, 'UTC')
    ) AS firstPurchaseAt,
    nullIf(
      maxIf(
        purchasedAt,
        name IN ('initial_purchase', 'renewal', 'non_renewing_purchase')
          AND purchasedAt IS NOT NULL
          AND purchasedAt > toDateTime64('2000-01-01', 6, 'UTC')
      ),
      toDateTime64('1970-01-01', 6, 'UTC')
    ) AS lastPurchaseAt,
    argMaxIf(
      currencyCode,
      ts,
      name IN ('initial_purchase', 'renewal', 'non_renewing_purchase')
    ) AS currencyCode,
    argMaxIf(
      countryCode,
      ts,
      name IN ('initial_purchase', 'renewal', 'non_renewing_purchase')
    ) AS countryCode,
    argMaxIf(
      store,
      ts,
      name IN ('initial_purchase', 'renewal', 'non_renewing_purchase', 'cancellation')
    ) AS store,
    argMaxIf(
      environment,
      ts,
      name IN ('initial_purchase', 'renewal', 'non_renewing_purchase')
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
    countIf(name IN ('app_open', 'session_start') AND ts >= now() - INTERVAL 7 DAY) AS sessions7d,
    countIf(name IN ('app_open', 'session_start')) AS sessions30d,
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
)
SELECT
  coalesce(s.appUserId, r.appUserId) AS appUserId,
  coalesce(s.applicationId, r.applicationId) AS applicationId,
  coalesce(a.appName, concat('App ', toString(coalesce(s.applicationId, r.applicationId)))) AS appName,
  coalesce(a.platform, '') AS platform,
  coalesce(s.status, if(r.ltv > 0, 'UNKNOWN', 'INACTIVE')) AS status,
  s.entitlements AS entitlements,
  if(
    s.lastStatusAt IS NULL OR s.lastStatusAt <= toDateTime64('2000-01-01', 6, 'UTC'),
    NULL,
    s.lastStatusAt
  ) AS lastStatusAt,
  coalesce(r.ltv, 0) AS ltv,
  r.lastPrice AS lastPrice,
  nullIf(r.paidPrice, 0) AS paidPrice,
  r.productId AS productId,
  r.periodType AS periodType,
  r.nextBillingAt AS nextBillingAt,
  r.periodStartAt AS periodStartAt,
  if(
    r.nextBillingAt IS NULL,
    NULL,
    dateDiff('day', now(), r.nextBillingAt)
  ) AS daysUntilBilling,
  if(
    r.nextBillingAt IS NULL OR r.periodStartAt IS NULL OR r.nextBillingAt <= r.periodStartAt,
    NULL,
    dateDiff('day', r.periodStartAt, r.nextBillingAt)
  ) AS billingPeriodDays,
  r.firstPurchaseAt AS firstPurchaseAt,
  r.lastPurchaseAt AS lastPurchaseAt,
  r.currencyCode AS currencyCode,
  r.countryCode AS countryCode,
  r.cancelReason AS cancelReason,
  if(
    r.lastCancelAt IS NOT NULL
      AND r.lastCancelAt > coalesce(r.lastUncancelAt, toDateTime64('1970-01-01', 6, 'UTC'))
      AND upper(coalesce(s.status, '')) = 'ACTIVE',
    1,
    0
  ) AS willCancel,
  if(
    r.lastCancelAt IS NOT NULL
      AND r.lastCancelAt > coalesce(r.lastUncancelAt, toDateTime64('1970-01-01', 6, 'UTC')),
    1,
    0
  ) AS isCancelled,
  coalesce(r.purchaseCount, 0) AS purchaseCount,
  coalesce(u.sessions7d, 0) AS sessions7d,
  coalesce(u.sessions30d, 0) AS sessions30d,
  u.lastActiveAt AS lastActiveAt,
  r.store AS store,
  r.lastEnvironment AS environment
FROM latest_status AS s
FULL OUTER JOIN revenue AS r
  ON s.appUserId = r.appUserId AND s.applicationId = r.applicationId
LEFT JOIN apps AS a
  ON a.applicationId = coalesce(s.applicationId, r.applicationId)
LEFT JOIN usage AS u
  ON u.appUserId = coalesce(s.appUserId, r.appUserId)
  AND u.applicationId = coalesce(s.applicationId, r.applicationId)
WHERE
  upper(coalesce(s.status, '')) = 'ACTIVE'
  OR coalesce(r.ltv, 0) > 0
  OR r.firstPurchaseAt IS NOT NULL
  OR s.lastStatusAt IS NOT NULL
ORDER BY
  if(upper(coalesce(s.status, '')) = 'ACTIVE', 0, 1) ASC,
  coalesce(r.nextBillingAt, toDateTime64('2099-01-01', 6, 'UTC')) ASC,
  coalesce(r.ltv, 0) DESC
LIMIT 50000
FORMAT JSONEachRow
`.trim();
