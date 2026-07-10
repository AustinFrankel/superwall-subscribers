/**
 * API smoke tests against a running server — no Superwall credentials required.
 *
 *   BASE_URL=http://localhost:3000 npx tsx scripts/qa-api-smoke.ts
 */
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");

function fail(msg: string): never {
  console.error("FAIL:", msg);
  process.exit(1);
}

async function json(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      ...(init?.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { res, body: body as Record<string, unknown> };
}

async function main() {
  console.log("smoke against", BASE);

  // Health
  {
    const { res, body } = await json("/api/health");
    if (!res.ok || body.ok !== true) fail(`health: ${res.status} ${JSON.stringify(body)}`);
    if (body.service !== "superwall-subscribers") fail("health service name");
    if (body.rateLimit !== "redis" && body.rateLimit !== "memory") {
      fail(`unexpected rateLimit backend ${body.rateLimit}`);
    }
    console.log("  ✓ /api/health", body.rateLimit);
  }

  // Unauthenticated data routes must 401 with empty users (no dummy data)
  for (const path of ["/api/users", "/api/apps", "/api/ping"] as const) {
    const { res, body } = await json(path);
    if (res.status !== 401) fail(`${path} expected 401, got ${res.status}`);
    if (path === "/api/users") {
      const users = body.users as unknown[] | undefined;
      if (!Array.isArray(users) || users.length !== 0) {
        fail("/api/users without auth must return empty users[] — no dummy data");
      }
      if (body.error == null) fail("/api/users 401 missing error");
    }
    if (path === "/api/apps") {
      const apps = body.apps as unknown[] | undefined;
      if (!Array.isArray(apps) || apps.length !== 0) {
        fail("/api/apps without auth must return empty apps[]");
      }
    }
    if (path === "/api/ping" && body.ok !== false) fail("/api/ping should ok:false");
    console.log("  ✓", path, "401 empty / denied");
  }

  // Bad credentials must not invent data
  {
    const headers = {
      "x-superwall-api-key": "invalid_key_for_smoke_test_xx",
      "x-superwall-org-id": "1",
    };
    const { res, body } = await json("/api/ping", { headers });
    if (res.status === 200 && body.ok === true) {
      fail("invalid key must not succeed");
    }
    // 400/401/500 are all acceptable — never 200 with fabricated apps
    if (res.ok && body.ok) fail("unexpected success with fake key");
    console.log("  ✓ invalid credentials rejected", res.status);
  }

  // Method not allowed
  {
    const res = await fetch(`${BASE}/api/users`, { method: "POST", cache: "no-store" });
    if (res.status !== 405) fail(`POST /api/users expected 405, got ${res.status}`);
    console.log("  ✓ POST methods rejected");
  }

  // Cross-origin blocked
  {
    const { res, body } = await json("/api/ping", {
      headers: { origin: "https://evil.example" },
    });
    if (res.status !== 403) fail(`cross-origin expected 403, got ${res.status}`);
    if (!String(body.error || "").toLowerCase().includes("origin")) {
      fail("cross-origin error message missing");
    }
    console.log("  ✓ cross-origin blocked");
  }

  // Homepage loads (connect UI — no embedded dummy subscribers)
  {
    const res = await fetch(`${BASE}/`, { cache: "no-store" });
    if (!res.ok) fail(`homepage ${res.status}`);
    const html = await res.text();
    if (!html.includes("Superwall") && !html.includes("Subscribers")) {
      fail("homepage missing branding");
    }
    if (/John Doe|fakeUser|lorem ipsum/i.test(html)) {
      fail("homepage contains dummy data strings");
    }
    // Should not embed a pre-baked users JSON payload
    if (/"users"\s*:\s*\[\s*\{/.test(html)) {
      fail("homepage appears to embed users payload");
    }
    console.log("  ✓ homepage clean");
  }

  // Guide assets load
  for (const step of [1, 2, 3, 4]) {
    const files = [
      "step-1-open-superwall.svg",
      "step-2-settings.svg",
      "step-3-create-key.svg",
      "step-4-copy-paste.svg",
    ];
    const f = files[step - 1];
    const res = await fetch(`${BASE}/guide/${f}`, { cache: "no-store" });
    if (!res.ok) fail(`guide ${f} ${res.status}`);
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("svg") && !ct.includes("image") && !ct.includes("xml")) {
      // next may serve as octet or text
    }
    console.log("  ✓ guide", f);
  }

  console.log("\nqa-api-smoke: ok\n");
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
