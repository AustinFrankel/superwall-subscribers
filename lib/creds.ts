export type StoredCreds = {
  apiKey: string;
  orgId: string;
};

const KEY = "sw_dashboard_creds_v1";

/** Superwall dashboard deep link to API Keys (user picks their app). */
export const SUPERWALL_API_KEYS_URL =
  "https://superwall.com/select-application?pathname=/applications/:app/settings/api-keys";

export const SUPERWALL_DASHBOARD_URL = "https://superwall.com";

export const GITHUB_REPO_URL =
  "https://github.com/AustinFrankel/superwall-subscribers";

export function loadCreds(): StoredCreds | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCreds;
    if (!parsed?.apiKey?.trim() || !parsed?.orgId?.trim()) return null;
    return { apiKey: parsed.apiKey.trim(), orgId: parsed.orgId.trim() };
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
}

export function clearCreds() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}

export function authHeaders(creds: StoredCreds): HeadersInit {
  return {
    "x-superwall-api-key": creds.apiKey,
    "x-superwall-org-id": creds.orgId,
  };
}

/**
 * One-link pairing via URL hash (never sent to the server in the request URL).
 * Formats supported:
 *   #connect=<base64url(orgId|apiKey)>
 *   #org=123&key=sk_xxx
 */
export function parseConnectHash(hash: string): StoredCreds | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;

  try {
    const params = new URLSearchParams(raw);

    const connect = params.get("connect");
    if (connect) {
      const decoded = base64UrlDecode(connect);
      const sep = decoded.includes("|") ? "|" : decoded.includes(":") ? ":" : null;
      if (!sep) return null;
      const [orgId, ...rest] = decoded.split(sep);
      const apiKey = rest.join(sep).trim();
      if (orgId?.trim() && apiKey) {
        return { orgId: orgId.trim(), apiKey };
      }
    }

    const org = params.get("org")?.trim();
    const key = params.get("key")?.trim();
    if (org && key) return { orgId: org, apiKey: key };
  } catch {
    return null;
  }
  return null;
}

/** Build a shareable one-link (hash only — stays client-side). */
export function buildConnectLink(creds: StoredCreds, origin?: string): string {
  const base =
    origin ||
    (typeof window !== "undefined" ? window.location.origin : "");
  const payload = base64UrlEncode(`${creds.orgId}|${creds.apiKey}`);
  return `${base}/#connect=${payload}`;
}

/** Paste helpers: "123|sk_xxx", "123:sk_xxx", or JSON */
export function parsePastedPair(text: string): StoredCreds | null {
  const t = text.trim();
  if (!t) return null;

  if (t.startsWith("{")) {
    try {
      const j = JSON.parse(t) as { orgId?: string; apiKey?: string; org?: string; key?: string };
      const orgId = (j.orgId || j.org || "").trim();
      const apiKey = (j.apiKey || j.key || "").trim();
      if (orgId && apiKey) return { orgId, apiKey };
    } catch {
      /* fall through */
    }
  }

  for (const sep of ["|", "\n", "\t", ":"]) {
    if (!t.includes(sep)) continue;
    const idx = t.indexOf(sep);
    const orgId = t.slice(0, idx).trim();
    const apiKey = t.slice(idx + 1).trim();
    if (/^\d+$/.test(orgId) && apiKey.length >= 16) {
      return { orgId, apiKey };
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

/** Remove sensitive hash from the address bar after reading. */
export function clearConnectHash() {
  if (typeof window === "undefined") return;
  if (!window.location.hash) return;
  const url = window.location.pathname + window.location.search;
  window.history.replaceState(null, "", url);
}
