export type StoredCreds = {
  apiKey: string;
  orgId: string;
};

const KEY = "sw_dashboard_creds_v2";

/** Superwall Settings → Keys (org API keys). */
export const SUPERWALL_API_KEYS_URL =
  "https://superwall.com/select-application?pathname=/applications/:app/settings/keys";

export const SUPERWALL_DASHBOARD_URL = "https://superwall.com";

export const GITHUB_REPO_URL =
  "https://github.com/AustinFrankel/superwall-subscribers";

export function loadCreds(): StoredCreds | null {
  if (typeof window === "undefined") return null;
  try {
    // Prefer v2; fall back to v1 if present
    const raw =
      window.localStorage.getItem(KEY) ||
      window.localStorage.getItem("sw_dashboard_creds_v1");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCreds;
    if (!parsed?.apiKey?.trim()) return null;
    return {
      apiKey: parsed.apiKey.trim(),
      orgId: (parsed.orgId || "").trim(),
    };
  } catch {
    return null;
  }
}

export function saveCreds(creds: StoredCreds) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    KEY,
    JSON.stringify({
      apiKey: creds.apiKey.trim(),
      orgId: creds.orgId.trim(),
    }),
  );
  window.localStorage.removeItem("sw_dashboard_creds_v1");
}

export function clearCreds() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
  window.localStorage.removeItem("sw_dashboard_creds_v1");
}

export function authHeaders(creds: StoredCreds): HeadersInit {
  const h: Record<string, string> = {
    "x-superwall-api-key": creds.apiKey,
  };
  if (creds.orgId) h["x-superwall-org-id"] = creds.orgId;
  return h;
}

/**
 * One-link: #connect=base64url(apiKey) or #connect=base64url(orgId|apiKey)
 * or #key=sk_xxx
 */
export function parseConnectHash(hash: string): StoredCreds | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;

  try {
    const params = new URLSearchParams(raw);

    const connect = params.get("connect");
    if (connect) {
      const decoded = base64UrlDecode(connect);
      if (decoded.startsWith("sk_") || decoded.length > 20) {
        // key only
        if (!decoded.includes("|") && !/^\d+[:|]/.test(decoded)) {
          return { orgId: "", apiKey: decoded.trim() };
        }
      }
      const sep = decoded.includes("|") ? "|" : decoded.includes(":") ? ":" : null;
      if (sep) {
        const [orgId, ...rest] = decoded.split(sep);
        const apiKey = rest.join(sep).trim();
        if (apiKey) return { orgId: orgId.trim(), apiKey };
      }
    }

    const key = params.get("key")?.trim();
    if (key) return { orgId: params.get("org")?.trim() || "", apiKey: key };
  } catch {
    return null;
  }
  return null;
}

export function buildConnectLink(creds: StoredCreds, origin?: string): string {
  const base =
    origin ||
    (typeof window !== "undefined" ? window.location.origin : "");
  // Key only — org is resolved server-side
  const payload = base64UrlEncode(creds.apiKey);
  return `${base}/#connect=${payload}`;
}

/** Accept bare sk_ key, or org|key, or JSON */
export function parsePastedPair(text: string): StoredCreds | null {
  const t = text.trim();
  if (!t) return null;

  if (t.startsWith("{")) {
    try {
      const j = JSON.parse(t) as {
        orgId?: string;
        apiKey?: string;
        org?: string;
        key?: string;
      };
      const apiKey = (j.apiKey || j.key || "").trim();
      if (apiKey) return { orgId: (j.orgId || j.org || "").trim(), apiKey };
    } catch {
      /* fall through */
    }
  }

  // Bare organization API key
  if (t.startsWith("sk_") && t.length >= 20 && !/\s/.test(t)) {
    return { orgId: "", apiKey: t };
  }

  for (const sep of ["|", "\n", "\t"]) {
    if (!t.includes(sep)) continue;
    const idx = t.indexOf(sep);
    const a = t.slice(0, idx).trim();
    const b = t.slice(idx + 1).trim();
    if (a.startsWith("sk_") && a.length >= 16) return { orgId: b, apiKey: a };
    if (b.startsWith("sk_") || b.length >= 16) {
      return {
        orgId: /^\d+$/.test(a) ? a : "",
        apiKey: b,
      };
    }
  }
  return null;
}

function base64UrlEncode(str: string): string {
  const b64 =
    typeof btoa !== "undefined"
      ? btoa(unescape(encodeURIComponent(str)))
      : Buffer.from(str, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): string {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const full = b64 + pad;
  if (typeof atob !== "undefined") {
    return decodeURIComponent(escape(atob(full)));
  }
  return Buffer.from(full, "base64").toString("utf8");
}

export function clearConnectHash() {
  if (typeof window === "undefined") return;
  if (!window.location.hash) return;
  const url = window.location.pathname + window.location.search;
  window.history.replaceState(null, "", url);
}
