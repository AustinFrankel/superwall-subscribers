/**
 * End-to-end QA against a running local or production server.
 * Uses SUPERWALL_API_KEY + SUPERWALL_ORG_ID from the environment only.
 *
 *   SUPERWALL_API_KEY=... SUPERWALL_ORG_ID=... BASE_URL=http://localhost:3000 npx tsx scripts/qa-e2e.ts
 */
const BASE = process.env.BASE_URL || "http://localhost:3000";
const apiKey = process.env.SUPERWALL_API_KEY?.trim();
const orgId = process.env.SUPERWALL_ORG_ID?.trim();

function fail(msg: string): never {
  console.error("FAIL:", msg);
  process.exit(1);
}

async function main() {
  if (!apiKey || !orgId) fail("Set SUPERWALL_API_KEY and SUPERWALL_ORG_ID for e2e");

  const headers = {
    "x-superwall-api-key": apiKey,
    "x-superwall-org-id": orgId,
  };

  // Public connect flow: no request headers => 401 (server should not have baked-in secrets).
  const bare = await fetch(`${BASE}/api/users`, { cache: "no-store" });
  const bareJson = (await bare.json()) as { error?: string };
  if (bare.status !== 401) {
    fail(
      `/api/users without headers expected 401 for connect-flow QA, got ${bare.status}. ` +
        "Unset SUPERWALL_* on the server process.",
    );
  }
  if (!bareJson.error) fail("401 missing error message");

  const ping = await fetch(`${BASE}/api/ping`, { headers, cache: "no-store" });
  const pingJson = (await ping.json()) as { ok?: boolean; apps?: number; error?: string };
  if (!ping.ok || !pingJson.ok) fail(`ping failed: ${pingJson.error || ping.status}`);
  if (!pingJson.apps || pingJson.apps < 1) fail("ping returned no apps");

  const usersRes = await fetch(`${BASE}/api/users`, { headers, cache: "no-store" });
  const data = (await usersRes.json()) as {
    error?: string;
    count?: number;
    users?: Array<Record<string, unknown>>;
    apps?: Array<Record<string, unknown>>;
  };
  if (!usersRes.ok || data.error) fail(`users failed: ${data.error || usersRes.status}`);
  if (!data.users || data.users.length < 1) fail("no users returned");
  if (!data.apps || data.apps.length < 1) fail("no apps returned");

  const users = data.users;
  const active = users.filter((u) => u.status === "ACTIVE");
  if (active.length < 1) fail("expected at least one ACTIVE user");

  const badDates = users.filter((u) => {
    const fields = [u.lastActiveAt, u.firstPurchaseAt, u.nextBillingAt, u.lastPurchaseAt];
    return fields.some((v) => typeof v === "string" && (v.includes("1969") || v.startsWith("1970-01-01")));
  });
  if (badDates.length) fail(`found ${badDates.length} rows with epoch junk dates`);

  const numericApps = users.filter((u) => /^\d+$/.test(String(u.appName || "")));
  if (numericApps.length) fail(`found ${numericApps.length} numeric app names`);

  const withBilling = active.filter((u) => u.nextBillingAt);
  const withProgress = active.filter((u) => u.renewProgress !== null && u.autoRenew);
  const withProduct = active.filter((u) => u.productId);
  const freeTrialLabel = users.filter((u) => String(u.priceLabel || "").includes("Trial"));

  console.log(
    JSON.stringify(
      {
        ok: true,
        base: BASE,
        total: users.length,
        apps: data.apps.length,
        active: active.length,
        activeWithBilling: withBilling.length,
        activeWithProgress: withProgress.length,
        activeWithProduct: withProduct.length,
        trialLabels: freeTrialLabel.length,
        sample: {
          appName: active[0]?.appName,
          statusLabel: active[0]?.statusLabel,
          priceLabel: active[0]?.priceLabel,
          productLabel: active[0]?.productLabel,
          renewProgress: active[0]?.renewProgress,
          daysUntilBilling: active[0]?.daysUntilBilling,
          lastActiveAt: active[0]?.lastActiveAt,
        },
      },
      null,
      2,
    ),
  );

  if (withBilling.length < Math.min(20, active.length)) {
    console.warn("WARN: few active users have nextBillingAt — check Superwall revenue events");
  }
  if (withProduct.length < active.length * 0.5) {
    console.warn("WARN: under half of active users have a productId");
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
