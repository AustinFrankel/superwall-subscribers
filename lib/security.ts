/**
 * Production security helpers.
 * - In-memory rate limiting (per serverless isolate)
 * - Input sanitization (never log secrets)
 * - Safe error messages for clients
 */

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

/** Max entries so a flood of unique IPs cannot grow memory forever. */
const MAX_BUCKETS = 5_000;

/**
 * Fixed-window rate limit.
 * Default: 30 requests / 60s per key (IP + route).
 */
export function rateLimit(
  key: string,
  limit = 30,
  windowMs = 60_000,
): RateLimitResult {
  const now = Date.now();

  if (buckets.size > MAX_BUCKETS) {
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
    if (buckets.size > MAX_BUCKETS) {
      // Drop oldest half if still oversized
      const keys = [...buckets.keys()].slice(0, Math.floor(MAX_BUCKETS / 2));
      for (const k of keys) buckets.delete(k);
    }
  }

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSec: Math.ceil(windowMs / 1000) };
  }

  if (existing.count >= limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    ok: true,
    remaining: limit - existing.count,
    retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

/** Client IP from common proxy headers (Vercel / Cloudflare). */
export function clientIp(req: Request): string {
  const h = req.headers;
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = h.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const cf = h.get("cf-connecting-ip")?.trim();
  if (cf) return cf.slice(0, 64);
  return "unknown";
}

/** Strip control chars; cap length. Never log the result if it may be a secret. */
export function sanitizeHeader(value: string | null, maxLen = 512): string {
  if (!value) return "";
  return value
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLen);
}

/** Public-safe error (no stack, no secrets). */
export function publicError(err: unknown, fallback = "Something went wrong. Try again."): string {
  if (!(err instanceof Error)) return fallback;
  const msg = err.message || fallback;
  // Never leak raw Superwall/body dumps that might include tokens
  if (/authorization|bearer|api[_-]?key|token/i.test(msg)) {
    return "Superwall rejected the request. Check your Organization ID and API key.";
  }
  // Cap length
  return msg.slice(0, 400);
}

/** Security response headers for API routes. */
export function apiSecurityHeaders(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  h.set("Pragma", "no-cache");
  // Credentials are only accepted via custom headers, never cookies for Superwall
  h.set("X-Frame-Options", "DENY");
  return h;
}

/**
 * Browser-origin check for API abuse reduction.
 * Allows same-origin browser calls and server-to-server (no Origin) for tooling.
 * Blocks cross-site browser fetches from random websites.
 */
export function assertBrowserOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  const secFetchSite = req.headers.get("sec-fetch-site");

  // Non-browser clients (curl, e2e scripts) usually omit Origin
  if (!origin) {
    // If browser marked this as cross-site, reject even without Origin edge cases
    if (secFetchSite === "cross-site") {
      return "Cross-site requests are not allowed.";
    }
    return null;
  }

  try {
    const reqUrl = new URL(req.url);
    const originUrl = new URL(origin);
    if (originUrl.host !== reqUrl.host) {
      return "Cross-origin requests are not allowed.";
    }
  } catch {
    return "Invalid origin.";
  }
  return null;
}
