export type StoredCreds = {
  apiKey: string;
  orgId: string;
};

const KEY = "sw_dashboard_creds_v1";

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
  window.localStorage.setItem(
    KEY,
    JSON.stringify({
      apiKey: creds.apiKey.trim(),
      orgId: creds.orgId.trim(),
    }),
  );
}

export function clearCreds() {
  window.localStorage.removeItem(KEY);
}

export function authHeaders(creds: StoredCreds): HeadersInit {
  return {
    "x-superwall-api-key": creds.apiKey,
    "x-superwall-org-id": creds.orgId,
  };
}
