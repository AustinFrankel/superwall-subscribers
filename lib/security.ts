/**
 * Production security helpers.
 * - Durable rate limiting via Upstash Redis (when configured)
 * - In-memory fallback for local dev / missing Redis
 * - Input sanitization (never log secrets)
 * - Safe error messages for clients
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createHash } from "crypto";

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
  backend: "redis" | "memory";
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5_000;

/** Cached Upstash limiters keyed by "limit:windowSec". */
const redisLimiters = new Map<string, Ratelimit>();
let redisClient: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;

  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (!url || !token) {
    redisClient = null;
    return null;
  }

  try {
    redisClient = new Redis({ url, token });
  } catch {
    redisClient = null;
  }
  return redisClient;
}

function getRedisLimiter(limit: number, windowMs: number): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;

  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
  const cacheKey = `${limit}:${windowSec}`;
  let limiter = redisLimiters.get(cacheKey);
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
      prefix: "sw-dash",
      analytics: false,
    });
    redisLimiters.set(cacheKey, limiter);
  }
  return limiter;
}

/** Whether durable Redis rate limiting is configured. */
export function hasRedisRateLimit(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

/**
 * Fixed-window in-memory rate limit (per serverless isolate).
 * Used when Redis is not configured or as emergency fallback.
 */
export function rateLimitMemory(
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
      const keys = [...buckets.keys()].slice(0, Math.floor(MAX_BUCKETS / 2));
      for (const k of keys) buckets.delete(k);
    }
  }

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return {
      ok: true,
      remaining: limit - 1,
      retryAfterSec: Math.ceil(windowMs / 1000),
      backend: "memory",
    };
  }

  if (existing.count >= limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      backend: "memory",
    };
  }

  existing.count += 1;
  return {
    ok: true,
    remaining: limit - existing.count,
    retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    backend: "memory",
  };
}

/**
 * Sync memory limiter — unit tests and fallback path.
 */
export function rateLimit(
  key: string,
  limit = 30,
  windowMs = 60_000,
): RateLimitResult {
  return rateLimitMemory(key, limit, windowMs);
}

/**
 * Production rate limit: Redis sliding window when available, else memory.
 * Keys should already include route + IP + optional credential fingerprint.
 */
export async function rateLimitAsync(
  key: string,
  limit = 30,
  windowMs = 60_000,
): Promise<RateLimitResult> {
  const limiter = getRedisLimiter(limit, windowMs);
  if (limiter) {
    try {
      const res = await limiter.limit(key);
      const retryAfterSec = Math.max(
        1,
        Math.ceil((res.reset - Date.now()) / 1000),
      );
      return {
        ok: res.success,
        remaining: Math.max(0, res.remaining),
        retryAfterSec,
        backend: "redis",
      };
    } catch {
      // Fail open to memory — never take the whole API down if Redis blips
      return rateLimitMemory(key, limit, windowMs);
    }
  }
  return rateLimitMemory(key, limit, windowMs);
}

/**
 * Fingerprint a credential for rate-limit keys without storing the secret.
 * SHA-256 hex truncated — not reversible to the API key.
 */
export function credentialFingerprint(apiKey: string, orgId: string): string {
  return createHash("sha256")
    .update(`sw|${orgId}|${apiKey}`)
    .digest("hex")
    .slice(0, 24);
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
export function publicError(
  err: unknown,
  fallback = "Something went wrong. Try again.",
): string {
  if (!(err instanceof Error)) return fallback;
  const msg = err.message || fallback;
  if (/authorization|bearer|api[_-]?key|token/i.test(msg)) {
    return "Superwall rejected the request. Check your Organization ID and API key.";
  }
  return msg.slice(0, 400);
}

/** Security response headers for API routes. */
export function apiSecurityHeaders(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  h.set("Pragma", "no-cache");
  h.set("X-Frame-Options", "DENY");
  return h;
}

export function rateLimitHeaders(
  rl: RateLimitResult,
  limit: number,
): HeadersInit {
  return {
    "Retry-After": String(rl.retryAfterSec),
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(Math.max(0, rl.remaining)),
    "X-RateLimit-Backend": rl.backend,
  };
}

/**
 * Browser-origin check for API abuse reduction.
 * Allows same-origin browser calls and server-to-server (no Origin) for tooling.
 * Blocks cross-site browser fetches from random websites.
 */
export function assertBrowserOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  const secFetchSite = req.headers.get("sec-fetch-site");

  if (!origin) {
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

/**
 * Build a rate-limit key: route + IP + optional credential fingerprint.
 * Does not include raw secrets.
 */
export function rateLimitKey(
  route: string,
  req: Request,
  apiKey?: string,
  orgId?: string,
): string {
  const ip = clientIp(req);
  if (apiKey && orgId) {
    return `${route}:${ip}:${credentialFingerprint(apiKey, orgId)}`;
  }
  return `${route}:${ip}`;
}
