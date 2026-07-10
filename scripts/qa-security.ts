/**
 * Static security + privacy QA — no network, no secrets required.
 *
 *   npx tsx scripts/qa-security.ts
 */
import { createHash } from "crypto";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import {
  assertBrowserOrigin,
  credentialFingerprint,
  publicError,
  rateLimitMemory,
  sanitizeHeader,
} from "../lib/security";
import { validateApiKey, validateCreds } from "../lib/superwall";
import { parseConnectHash, parsePastedPair } from "../lib/creds";

const ROOT = join(__dirname, "..");
let failed = 0;

function ok(msg: string) {
  console.log("  ✓", msg);
}

function fail(msg: string) {
  console.error("  ✗", msg);
  failed += 1;
}

function assert(cond: unknown, msg: string) {
  if (cond) ok(msg);
  else fail(msg);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (
      name === "node_modules" ||
      name === ".next" ||
      name === ".git" ||
      name === ".vercel"
    ) {
      continue;
    }
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

console.log("\n== rate limit memory ==");
{
  const key = `qa-test-${Date.now()}`;
  const a = rateLimitMemory(key, 3, 60_000);
  const b = rateLimitMemory(key, 3, 60_000);
  const c = rateLimitMemory(key, 3, 60_000);
  const d = rateLimitMemory(key, 3, 60_000);
  assert(a.ok && a.remaining === 2, "1st request allowed");
  assert(b.ok && b.remaining === 1, "2nd request allowed");
  assert(c.ok && c.remaining === 0, "3rd request allowed");
  assert(!d.ok && d.remaining === 0, "4th request blocked");
  assert(a.backend === "memory", "backend is memory");
}

console.log("\n== credential fingerprint ==");
{
  const f1 = credentialFingerprint("secret-key-abcdefgh", "42");
  const f2 = credentialFingerprint("secret-key-abcdefgh", "42");
  const f3 = credentialFingerprint("other-key-abcdefghij", "42");
  assert(f1 === f2, "fingerprint stable");
  assert(f1 !== f3, "fingerprint differs per key");
  assert(!f1.includes("secret"), "fingerprint does not contain secret");
  assert(f1.length === 24, "fingerprint truncated length");
  // ensure it's hex
  assert(/^[a-f0-9]{24}$/.test(f1), "fingerprint is hex");
}

console.log("\n== validateCreds ==");
{
  assert(validateCreds({ orgId: "12", apiKey: "sk_" + "a".repeat(20) }) === null, "valid creds");
  assert(validateCreds({ orgId: "abc", apiKey: "sk_" + "a".repeat(20) }) !== null, "reject non-numeric org");
  assert(validateApiKey("short") !== null, "reject short key");
  assert(validateApiKey("pk_public_key_xxxxxx") !== null, "reject public pk_ key");
  assert(validateApiKey("has space in key!!!!!") !== null, "reject spaced key");
  assert(parsePastedPair("sk_" + "b".repeat(30))?.apiKey?.startsWith("sk_"), "bare sk_ paste");
}

console.log("\n== sanitize / publicError ==");
{
  assert(sanitizeHeader("  ab\u0000c  ") === "abc", "strips control chars");
  assert(
    publicError(new Error("Authorization Bearer xyz")).includes("rejected"),
    "publicError redacts auth",
  );
}

console.log("\n== origin guard ==");
{
  const same = new Request("https://example.com/api/ping", {
    headers: { origin: "https://example.com" },
  });
  const cross = new Request("https://example.com/api/ping", {
    headers: { origin: "https://evil.com" },
  });
  const none = new Request("https://example.com/api/ping");
  const crossSite = new Request("https://example.com/api/ping", {
    headers: { "sec-fetch-site": "cross-site" },
  });
  assert(assertBrowserOrigin(same) === null, "same origin ok");
  assert(assertBrowserOrigin(cross) !== null, "cross origin blocked");
  assert(assertBrowserOrigin(none) === null, "no origin (curl) ok");
  assert(assertBrowserOrigin(crossSite) !== null, "sec-fetch-site cross-site blocked");
}

console.log("\n== connect hash / paste (no real secrets) ==");
{
  const fakeKey = "sk_demo_readonly_key_xx_long";
  const b64 = Buffer.from(fakeKey, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const parsed = parseConnectHash(`#connect=${b64}`);
  assert(parsed?.apiKey === fakeKey, "parse connect hash key-only");
  assert(parseConnectHash("#") === null, "empty hash null");
  assert(parsePastedPair("not-a-pair") === null, "reject junk paste");
}

console.log("\n== no personal / secret data in tracked sources ==");
{
  const files = walk(ROOT).filter((f) => {
    const rel = relative(ROOT, f);
    if (rel.startsWith("package-lock")) return false;
    return /\.(ts|tsx|js|jsx|md|json|svg|css|mjs|example)$/.test(f);
  });

  // Patterns that look like real secrets / PII payloads (not docs placeholders)
  const secretPatterns: { re: RegExp; label: string; allow?: (s: string, file: string) => boolean }[] = [
    {
      re: /sk_live_[A-Za-z0-9]{10,}/,
      label: "stripe-like live secret",
    },
    {
      re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
      label: "jwt-like token",
    },
    {
      re: /SUPERWALL_API_KEY\s*=\s*['"]?[A-Za-z0-9_\-]{20,}/,
      label: "hardcoded SUPERWALL_API_KEY value",
      allow: (s) => s.includes("process.env") || s.includes("#") || s.includes("…"),
    },
    {
      re: /x-superwall-api-key["']?\s*:\s*["'][A-Za-z0-9_\-]{16,}/,
      label: "hardcoded api key header value",
    },
    {
      re: /password\s*[:=]\s*["'][^"']{6,}/i,
      label: "hardcoded password",
    },
    {
      re: /austinhfrankel@gmail\.com/,
      label: "personal email in source",
    },
  ];

  // Dummy data that must never ship as live fixture users
  const dummyDataPatterns = [
    /John Doe/i,
    /Jane Doe/i,
    /lorem ipsum/i,
    /fakeUser/i,
    /dummyUser/i,
    /test@example\.com/i,
    /"users"\s*:\s*\[\s*\{[^}]*appUserId/i,
  ];

  for (const file of files) {
    const rel = relative(ROOT, file);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    // QA scripts intentionally use fake invalid keys / synthetic fixtures
    const isQaScript = /scripts\/qa[-_]/.test(rel);

    for (const { re, label, allow } of secretPatterns) {
      if (isQaScript) continue;
      const m = text.match(re);
      if (m && !(allow && allow(m[0], rel))) {
        fail(`${label} in ${rel}: ${m[0].slice(0, 40)}…`);
      }
    }

    if (isQaScript) continue;

    for (const re of dummyDataPatterns) {
      if (re.test(text)) {
        fail(`dummy/fixture user data pattern in ${rel}`);
      }
    }
  }

  if (failed === 0) ok(`scanned ${files.length} source files — no secrets/dummy users`);
}

console.log("\n== guide images are illustrations only ==");
{
  const guide = join(ROOT, "public/guide");
  const svgs = readdirSync(guide).filter((f) => f.endsWith(".svg"));
  assert(svgs.length === 4, "four guide steps present");
  for (const f of svgs) {
    const t = readFileSync(join(guide, f), "utf8");
    assert(!/sk_[A-Za-z0-9]{8,}/.test(t), `${f}: no real-looking key`);
    assert(!/@[a-z]+\.(com|net|io)/.test(t), `${f}: no email`);
  }
}

async function checkSqlAllowlist() {
  console.log("\n== SQL allowlist integrity ==");
  const { APPS_SQL, PING_SQL, USERS_SQL, runClickHouseQuery } = await import(
    "../lib/superwall"
  );
  assert(APPS_SQL.includes("FORMAT JSONEachRow"), "APPS_SQL format");
  assert(PING_SQL.includes("FORMAT JSONEachRow"), "PING_SQL format");
  assert(USERS_SQL.includes("LIMIT 50000"), "USERS_SQL limit");
  let rejected = false;
  try {
    await runClickHouseQuery("SELECT 1 FORMAT JSONEachRow", {
      apiKey: "x".repeat(20),
      orgId: "1",
    });
  } catch (e) {
    rejected = e instanceof Error && e.message.includes("Invalid query");
  }
  assert(rejected, "non-allowlisted SQL rejected");
  void createHash;
}

checkSqlAllowlist()
  .then(() => {
    if (failed > 0) {
      console.error(`\nqa-security: ${failed} failure(s)\n`);
      process.exit(1);
    }
    console.log("\nqa-security: ok\n");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
