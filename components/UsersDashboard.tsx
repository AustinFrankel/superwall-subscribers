"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import ConnectGuide from "@/components/ConnectGuide";
import SiteFooter from "@/components/SiteFooter";
import {
  authHeaders,
  buildConnectLink,
  clearConnectHash,
  clearCreds,
  GITHUB_REPO_URL,
  loadCreds,
  parseConnectHash,
  parsePastedPair,
  saveCreds,
  type StoredCreds,
} from "@/lib/creds";
import { fmtDate, fmtDateTime, money, renewCountdown } from "@/lib/format";
import type { SubscriberRow, UsersResponse } from "@/lib/types";

type TimePeriod = "all" | "7d" | "30d" | "90d" | "year";
type StatusFilter =
  | "subscribed"
  | "all"
  | "active"
  | "cancelling"
  | "trial"
  | "inactive";
type SortKey = "renew" | "spend" | "recent" | "usage";

const REFRESH_MS = 45_000;

type DashState = {
  creds: StoredCreds | null;
  ready: boolean;
  data: UsersResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  search: string;
  appFilter: string;
  statusFilter: StatusFilter;
  timePeriod: TimePeriod;
  sortKey: SortKey;
  sidebarOpen: boolean;
  showKey: boolean;
  autoConnecting: boolean;
};

type DashAction =
  | { type: "READY"; creds: StoredCreds | null }
  | { type: "HASH_CONNECT_START" }
  | { type: "HASH_CONNECT_END" }
  | { type: "SET_CREDS"; creds: StoredCreds | null }
  | { type: "LOAD_START"; silent: boolean }
  | { type: "LOAD_OK"; data: UsersResponse }
  | { type: "LOAD_ERR"; error: string; data?: UsersResponse | null }
  | { type: "LOAD_END" }
  | { type: "SET_SEARCH"; search: string }
  | { type: "SET_APP"; appFilter: string }
  | { type: "SET_STATUS"; statusFilter: StatusFilter }
  | { type: "SET_PERIOD"; timePeriod: TimePeriod }
  | { type: "SET_SORT"; sortKey: SortKey }
  | { type: "TOGGLE_SIDEBAR" }
  | { type: "CLOSE_SIDEBAR" }
  | { type: "TOGGLE_SHOW_KEY" }
  | { type: "SET_ERROR"; error: string | null };

const initial: DashState = {
  creds: null,
  ready: false,
  data: null,
  loading: false,
  refreshing: false,
  error: null,
  search: "",
  appFilter: "all",
  statusFilter: "subscribed",
  timePeriod: "all",
  sortKey: "renew",
  sidebarOpen: false,
  showKey: false,
  autoConnecting: false,
};

function reducer(state: DashState, action: DashAction): DashState {
  switch (action.type) {
    case "READY":
      return { ...state, ready: true, creds: action.creds };
    case "HASH_CONNECT_START":
      return { ...state, ready: true, autoConnecting: true, loading: true, error: null };
    case "HASH_CONNECT_END":
      return { ...state, autoConnecting: false };
    case "SET_CREDS":
      return {
        ...state,
        creds: action.creds,
        data: action.creds ? state.data : null,
        error: null,
        appFilter: action.creds ? state.appFilter : "all",
        sidebarOpen: false,
        autoConnecting: false,
      };
    case "LOAD_START":
      return {
        ...state,
        loading: action.silent ? state.loading : true,
        refreshing: action.silent,
        error: null,
      };
    case "LOAD_OK":
      return {
        ...state,
        data: action.data,
        loading: false,
        refreshing: false,
        error: null,
        autoConnecting: false,
      };
    case "LOAD_ERR":
      return {
        ...state,
        error: action.error,
        data: action.data !== undefined ? action.data : state.data,
        loading: false,
        refreshing: false,
        autoConnecting: false,
      };
    case "LOAD_END":
      return { ...state, loading: false, refreshing: false, autoConnecting: false };
    case "SET_SEARCH":
      return { ...state, search: action.search };
    case "SET_APP":
      return { ...state, appFilter: action.appFilter, sidebarOpen: false };
    case "SET_STATUS":
      return { ...state, statusFilter: action.statusFilter };
    case "SET_PERIOD":
      return { ...state, timePeriod: action.timePeriod };
    case "SET_SORT":
      return { ...state, sortKey: action.sortKey };
    case "TOGGLE_SIDEBAR":
      return { ...state, sidebarOpen: !state.sidebarOpen };
    case "CLOSE_SIDEBAR":
      return { ...state, sidebarOpen: false };
    case "TOGGLE_SHOW_KEY":
      return { ...state, showKey: !state.showKey };
    case "SET_ERROR":
      return { ...state, error: action.error };
    default:
      return state;
  }
}

function withinPeriod(iso: string | null, period: TimePeriod): boolean {
  if (period === "all") return true;
  if (!iso) return false;
  const t = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z").getTime();
  if (Number.isNaN(t)) return false;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (period === "7d") return t >= now - 7 * day;
  if (period === "30d") return t >= now - 30 * day;
  if (period === "90d") return t >= now - 90 * day;
  if (period === "year") return t >= now - 365 * day;
  return true;
}

function statusClass(user: SubscriberRow) {
  if (user.willCancel) return "pill warn";
  if (user.status === "ACTIVE") return "pill ok";
  if ((user.periodType || "").toUpperCase() === "TRIAL") return "pill info";
  return "pill muted";
}

function appColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 48% 42%)`;
}

function AppAvatar({ name, size = 28 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("") || "?";
  return (
    <span
      className="app-avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: appColor(name),
      }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

function RenewBar({ user }: { user: SubscriberRow }) {
  const overdue = user.daysUntilBilling !== null && user.daysUntilBilling < 0;

  if (user.willCancel && user.nextBillingAt) {
    return (
      <div className="renew">
        <div className="renew-top">
          <span className="renew-title">
            {overdue ? "Access ended" : `Ends ${fmtDate(user.nextBillingAt)}`}
          </span>
          <span className="renew-meta">Won’t renew</span>
        </div>
        <div className="bar track cancel">
          <div
            className="bar fill cancel"
            style={{
              width: overdue
                ? "100%"
                : `${Math.max(8, Math.min(100, 100 - (user.renewProgress ?? 50)))}%`,
            }}
          />
        </div>
      </div>
    );
  }

  if (!user.nextBillingAt) {
    return <span className="muted">—</span>;
  }

  if (user.status === "ACTIVE" && !user.willCancel) {
    if (overdue) {
      return (
        <div className="renew">
          <div className="renew-top">
            <span className="renew-title urgent">Renewal overdue</span>
          </div>
          <div className="bar track">
            <div className="bar fill urgent" style={{ width: "100%" }} />
          </div>
          <div className="renew-sub">{fmtDate(user.nextBillingAt)}</div>
        </div>
      );
    }

    const { primary, secondary } = renewCountdown(
      user.daysUntilBilling,
      user.nextBillingAt,
    );
    const pct = user.renewProgress ?? 0;
    const urgent = (user.daysUntilBilling ?? 999) <= 3;

    return (
      <div className="renew">
        <div className="renew-top">
          <span className={`renew-title ${urgent ? "urgent" : ""}`}>{primary}</span>
          <span className="renew-meta">{pct}%</span>
        </div>
        <div className="bar track">
          <div
            className={`bar fill ${urgent ? "urgent" : ""}`}
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>
        <div className="renew-sub">{secondary}</div>
      </div>
    );
  }

  return <span className="muted">—</span>;
}

function ConnectScreen({
  onConnect,
  error,
  busy,
}: {
  onConnect: (creds: StoredCreds) => void;
  error: string | null;
  busy: boolean;
}) {
  const [orgId, setOrgId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [pasteAll, setPasteAll] = useState("");
  const [mode, setMode] = useState<"fields" | "paste">("fields");

  function tryPastePair(text: string) {
    const pair = parsePastedPair(text);
    if (pair) {
      setOrgId(pair.orgId);
      setApiKey(pair.apiKey);
      setPasteAll("");
      setMode("fields");
      return true;
    }
    return false;
  }

  return (
    <div className="connect-page">
      <div className="connect-layout">
        <div className="connect-card">
          <div className="connect-brand">
            <div className="connect-logo" aria-hidden>
              S
            </div>
            <div>
              <h1>Superwall Subscribers</h1>
              <p className="connect-tagline">
                See who pays, who cancels, and when they renew — across every app.
              </p>
            </div>
          </div>

          <div className="connect-mode-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "fields"}
              className={`chip ${mode === "fields" ? "active" : ""}`}
              onClick={() => setMode("fields")}
            >
              Two fields
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "paste"}
              className={`chip ${mode === "paste" ? "active" : ""}`}
              onClick={() => setMode("paste")}
            >
              One paste
            </button>
          </div>

          {mode === "fields" ? (
            <>
              <label className="field">
                <span>Organization ID</span>
                <input
                  value={orgId}
                  onChange={(e) => setOrgId(e.target.value)}
                  placeholder="Numbers only"
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="numeric"
                  enterKeyHint="next"
                />
              </label>

              <label className="field">
                <span>API key</span>
                <div className="field-row">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Key with data:read"
                    autoComplete="off"
                    spellCheck={false}
                    enterKeyHint="go"
                  />
                  <button
                    type="button"
                    className="btn field-toggle"
                    onClick={() => setShowKey((v) => !v)}
                  >
                    {showKey ? "Hide" : "Show"}
                  </button>
                </div>
              </label>
            </>
          ) : (
            <label className="field">
              <span>Paste both at once</span>
              <textarea
                className="paste-area"
                value={pasteAll}
                onChange={(e) => {
                  const v = e.target.value;
                  setPasteAll(v);
                  tryPastePair(v);
                }}
                placeholder={'orgId|api_key\nor JSON: {"orgId":"…","apiKey":"…"}'}
                rows={4}
                spellCheck={false}
                autoComplete="off"
              />
              <span className="field-hint">
                Easiest on mobile: copy both, paste here, we split them for you.
              </span>
            </label>
          )}

          <div className="security-note" role="note">
            <strong>Private by design.</strong> Your key is stored only in this
            browser. Requests go through this site to Superwall — we never save
            your key on a server. Use a <code>data:read</code> key only.
          </div>

          {error ? <div className="error tight">{error}</div> : null}

          <button
            type="button"
            className="btn primary"
            disabled={busy || !orgId.trim() || !apiKey.trim()}
            onClick={() =>
              onConnect({ orgId: orgId.trim(), apiKey: apiKey.trim() })
            }
          >
            {busy ? "Connecting…" : "Connect"}
          </button>

          <p className="one-link-note">
            <strong>One-link tip:</strong> after you connect, use{" "}
            <em>Copy one-link</em> in the sidebar to open this dashboard on
            another device. Treat that link like a password — anyone with it can
            read your Superwall data. Prefer a <code>data:read</code> key.
          </p>

          <SiteFooter />
        </div>

        <ConnectGuide />
      </div>
    </div>
  );
}

function SubscriberCard({ u }: { u: SubscriberRow }) {
  return (
    <article className="user-card">
      <header className="user-card-head">
        <div>
          <div className="person" title={u.appUserId}>
            {u.displayUserId}
          </div>
          <div className="cell-sub">
            {u.countryCode ? u.countryCode : "—"}
            {u.lastActiveAt ? ` · Active ${fmtDate(u.lastActiveAt)}` : ""}
          </div>
        </div>
        <span className={statusClass(u)}>{u.statusLabel}</span>
      </header>
      <div className="user-card-app">
        <AppAvatar name={u.appName} size={24} />
        <span>{u.appName}</span>
        <span className="cell-sub">{u.periodLabel}</span>
      </div>
      <div className="user-card-renew">
        <RenewBar user={u} />
      </div>
      <dl className="user-card-meta">
        <div>
          <dt>Price</dt>
          <dd>
            {u.priceLabel}
            <span className="cell-sub">{u.productLabel}</span>
          </dd>
        </div>
        <div>
          <dt>Spent</dt>
          <dd className="strong">{money(u.ltv, u.currencyCode)}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>
            {fmtDate(u.firstPurchaseAt)}
            {u.purchaseCount > 1 ? (
              <span className="cell-sub">{u.purchaseCount} payments</span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Usage</dt>
          <dd>
            {u.sessions7d > 0 || u.sessions30d > 0
              ? `${u.sessions7d} this week`
              : "—"}
            {u.sessions30d > 0 ? (
              <span className="cell-sub">{u.sessions30d} in 30 days</span>
            ) : null}
          </dd>
        </div>
      </dl>
    </article>
  );
}

export default function UsersDashboard() {
  const [state, dispatch] = useReducer(reducer, initial);
  const abortRef = useRef<AbortController | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const bootOnce = useRef(false);

  // Boot: localStorage + one-link hash pairing (async work only; no sync setState cascade)
  useEffect(() => {
    if (bootOnce.current) return;
    bootOnce.current = true;

    const fromHash = parseConnectHash(window.location.hash);
    if (fromHash) {
      clearConnectHash();
      dispatch({ type: "HASH_CONNECT_START" });
      void (async () => {
        try {
          const ping = await fetch("/api/ping", {
            cache: "no-store",
            headers: authHeaders(fromHash),
          });
          const pingJson = (await ping.json()) as {
            ok?: boolean;
            error?: string;
          };
          if (!ping.ok || !pingJson.ok) {
            dispatch({
              type: "LOAD_ERR",
              error:
                pingJson.error ||
                "One-link credentials failed. Create a new key and try again.",
            });
            return;
          }
          const res = await fetch("/api/users", {
            cache: "no-store",
            headers: authHeaders(fromHash),
          });
          const json = (await res.json()) as UsersResponse;
          if (!res.ok || json.error) {
            dispatch({
              type: "LOAD_ERR",
              error: json.error || `Request failed (${res.status})`,
              data: json,
            });
            return;
          }
          saveCreds(fromHash);
          dispatch({ type: "SET_CREDS", creds: fromHash });
          dispatch({ type: "LOAD_OK", data: json });
        } catch (e) {
          dispatch({
            type: "LOAD_ERR",
            error: e instanceof Error ? e.message : "Could not connect",
          });
        } finally {
          dispatch({ type: "HASH_CONNECT_END" });
        }
      })();
      return;
    }
    dispatch({ type: "READY", creds: loadCreds() });
  }, []);

  const load = useCallback(
    async (silent = false, override?: StoredCreds) => {
      const active = override ?? state.creds;
      if (!active) return false;

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      dispatch({ type: "LOAD_START", silent });

      try {
        const res = await fetch("/api/users", {
          cache: "no-store",
          headers: authHeaders(active),
          signal: ac.signal,
        });
        const json = (await res.json()) as UsersResponse;
        if (ac.signal.aborted) return false;
        if (!res.ok || json.error) {
          dispatch({
            type: "LOAD_ERR",
            error: json.error || `Request failed (${res.status})`,
            data: json,
          });
          return false;
        }
        dispatch({ type: "LOAD_OK", data: json });
        return true;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return false;
        dispatch({
          type: "LOAD_ERR",
          error: e instanceof Error ? e.message : "Failed to load",
        });
        return false;
      }
    },
    [state.creds],
  );

  useEffect(() => {
    if (!state.creds) return;
    void load(false);
    const id = window.setInterval(() => void load(true), REFRESH_MS);
    return () => {
      window.clearInterval(id);
      abortRef.current?.abort();
    };
  }, [state.creds, load]);

  async function handleConnect(next: StoredCreds) {
    dispatch({ type: "LOAD_START", silent: false });
    try {
      const ping = await fetch("/api/ping", {
        cache: "no-store",
        headers: authHeaders(next),
      });
      const pingJson = (await ping.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!ping.ok || !pingJson.ok) {
        dispatch({
          type: "LOAD_ERR",
          error: pingJson.error || "Could not connect with those credentials.",
        });
        return;
      }

      const ok = await load(false, next);
      if (ok) {
        saveCreds(next);
        dispatch({ type: "SET_CREDS", creds: next });
      }
    } catch (e) {
      dispatch({
        type: "LOAD_ERR",
        error: e instanceof Error ? e.message : "Could not connect",
      });
    }
  }

  function handleDisconnect() {
    clearCreds();
    dispatch({ type: "SET_CREDS", creds: null });
  }

  async function copyOneLink() {
    if (!state.creds) return;
    const link = buildConnectLink(state.creds);
    try {
      await navigator.clipboard.writeText(link);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      // fallback
      window.prompt("Copy this private connect link:", link);
    }
  }

  const appGroups = useMemo(() => {
    const users = state.data?.users ?? [];
    const map = new Map<
      string,
      { name: string; ids: Set<number>; count: number; active: number }
    >();
    for (const u of users) {
      const key = u.appName;
      const cur = map.get(key) ?? {
        name: u.appName,
        ids: new Set<number>(),
        count: 0,
        active: 0,
      };
      cur.ids.add(u.applicationId);
      cur.count += 1;
      if (u.status === "ACTIVE") cur.active += 1;
      map.set(key, cur);
    }
    return [...map.values()].sort(
      (a, b) => b.active - a.active || b.count - a.count,
    );
  }, [state.data]);

  const filtered = useMemo(() => {
    const users = state.data?.users ?? [];
    const q = state.search.trim().toLowerCase();
    const {
      appFilter,
      statusFilter,
      timePeriod,
      sortKey,
    } = state;

    let rows = users.filter((u) => {
      if (appFilter !== "all") {
        const group = appGroups.find((g) => g.name === appFilter);
        if (group) {
          if (!group.ids.has(u.applicationId)) return false;
        } else if (String(u.applicationId) !== appFilter) {
          return false;
        }
      }

      if (statusFilter === "subscribed" && u.status !== "ACTIVE") return false;
      if (statusFilter === "active" && (u.status !== "ACTIVE" || u.willCancel))
        return false;
      if (statusFilter === "cancelling" && !u.willCancel) return false;
      if (statusFilter === "inactive" && u.status === "ACTIVE") return false;
      if (
        statusFilter === "trial" &&
        (u.periodType || "").toUpperCase() !== "TRIAL"
      ) {
        return false;
      }

      const activityDate =
        u.lastPurchaseAt || u.firstPurchaseAt || u.lastStatusAt || u.lastActiveAt;
      if (!withinPeriod(activityDate, timePeriod)) return false;

      if (!q) return true;
      return (
        u.appUserId.toLowerCase().includes(q) ||
        u.displayUserId.toLowerCase().includes(q) ||
        u.appName.toLowerCase().includes(q) ||
        (u.productLabel || "").toLowerCase().includes(q) ||
        (u.productId || "").toLowerCase().includes(q) ||
        (u.countryCode || "").toLowerCase().includes(q)
      );
    });

    rows = [...rows].sort((a, b) => {
      switch (sortKey) {
        case "spend":
          return b.ltv - a.ltv;
        case "recent": {
          const at = a.firstPurchaseAt
            ? new Date(a.firstPurchaseAt).getTime()
            : 0;
          const bt = b.firstPurchaseAt
            ? new Date(b.firstPurchaseAt).getTime()
            : 0;
          return bt - at;
        }
        case "usage":
          return b.sessions30d - a.sessions30d;
        case "renew":
        default: {
          const activeA = a.status === "ACTIVE" ? 0 : 1;
          const activeB = b.status === "ACTIVE" ? 0 : 1;
          if (activeA !== activeB) return activeA - activeB;
          const av = a.daysUntilBilling;
          const bv = b.daysUntilBilling;
          if (av === null && bv === null) return b.ltv - a.ltv;
          if (av === null) return 1;
          if (bv === null) return -1;
          return av - bv;
        }
      }
    });

    return rows;
  }, [state, appGroups]);

  const stats = useMemo(() => {
    const rows = filtered;
    const active = rows.filter(
      (u) => u.status === "ACTIVE" && !u.willCancel,
    ).length;
    const cancelling = rows.filter((u) => u.willCancel).length;
    const renewingSoon = rows.filter(
      (u) =>
        u.autoRenew &&
        u.daysUntilBilling !== null &&
        u.daysUntilBilling >= 0 &&
        u.daysUntilBilling <= 7,
    ).length;
    const ltv = rows.reduce((sum, u) => sum + u.ltv, 0);
    return {
      total: rows.length,
      all: state.data?.users.length ?? 0,
      active,
      cancelling,
      renewingSoon,
      ltv,
    };
  }, [filtered, state.data]);

  if (!state.ready || state.autoConnecting) {
    return (
      <div className="connect-page">
        <div className="connect-card loading-card">
          <div className="spinner" aria-hidden />
          <p>
            {state.autoConnecting ? "Connecting with your link…" : "Loading…"}
          </p>
        </div>
      </div>
    );
  }

  if (!state.creds) {
    return (
      <ConnectScreen
        onConnect={handleConnect}
        error={state.error}
        busy={state.loading}
      />
    );
  }

  const {
    loading,
    refreshing,
    data,
    error,
    search,
    appFilter,
    statusFilter,
    timePeriod,
    sortKey,
    sidebarOpen,
  } = state;

  return (
    <div className={`shell ${sidebarOpen ? "sidebar-open" : ""}`}>
      {sidebarOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close menu"
          onClick={() => dispatch({ type: "CLOSE_SIDEBAR" })}
        />
      ) : null}

      <aside className="sidebar" aria-label="Apps">
        <div className="brand">
          <div className="brand-title">Subscribers</div>
          <div className="brand-sub">
            {refreshing
              ? "Updating…"
              : data?.fetchedAt
                ? `Updated ${fmtDateTime(data.fetchedAt)}`
                : "Live"}
          </div>
        </div>

        <nav className="nav">
          <button
            type="button"
            className={`nav-item ${appFilter === "all" ? "active" : ""}`}
            onClick={() => dispatch({ type: "SET_APP", appFilter: "all" })}
          >
            <span className="nav-label-row">
              <span className="app-avatar all" aria-hidden>
                ∗
              </span>
              <span>All apps</span>
            </span>
            <span className="nav-count">{data?.users.length ?? 0}</span>
          </button>
          {appGroups.map((g) => (
            <button
              key={g.name}
              type="button"
              className={`nav-item ${appFilter === g.name ? "active" : ""}`}
              onClick={() => dispatch({ type: "SET_APP", appFilter: g.name })}
            >
              <span className="nav-label">
                <span className="nav-label-row">
                  <AppAvatar name={g.name} size={26} />
                  <span className="nav-name">{g.name}</span>
                </span>
                <span className="nav-active">{g.active} active</span>
              </span>
              <span className="nav-count">{g.count}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <button
            type="button"
            className="btn ghost"
            onClick={() => void load(false)}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh now"}
          </button>
          <button type="button" className="btn ghost" onClick={copyOneLink}>
            {linkCopied ? "Link copied ✓" : "Copy one-link"}
          </button>
          <button type="button" className="btn ghost" onClick={handleDisconnect}>
            Disconnect
          </button>
          <a
            className="btn ghost github-btn"
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub ↗
          </a>
          <p className="hint">
            Auto-refreshes every 45s · keys stay in your browser
          </p>
          <SiteFooter dark />
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="menu-btn"
              aria-label="Open apps menu"
              onClick={() => dispatch({ type: "TOGGLE_SIDEBAR" })}
            >
              <span />
              <span />
              <span />
            </button>
            <div>
              <h1>{appFilter === "all" ? "All subscribers" : appFilter}</h1>
              <p className="sub">
                Showing {stats.total.toLocaleString()} of{" "}
                {stats.all.toLocaleString()} people
              </p>
            </div>
          </div>
        </header>

        <section className="stats" aria-label="Summary">
          <div className="stat">
            <span className="stat-label">People</span>
            <span className="stat-value">{stats.total.toLocaleString()}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Active</span>
            <span className="stat-value ok">{stats.active.toLocaleString()}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Renewing in 7 days</span>
            <span className="stat-value">
              {stats.renewingSoon.toLocaleString()}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Cancelling</span>
            <span className="stat-value warn">
              {stats.cancelling.toLocaleString()}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Spent so far</span>
            <span className="stat-value">{money(stats.ltv)}</span>
          </div>
        </section>

        <section className="toolbar">
          <div className="period-row" role="group" aria-label="Time period">
            {(
              [
                ["all", "All time"],
                ["7d", "7 days"],
                ["30d", "30 days"],
                ["90d", "90 days"],
                ["year", "This year"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`chip ${timePeriod === key ? "active" : ""}`}
                onClick={() =>
                  dispatch({ type: "SET_PERIOD", timePeriod: key })
                }
              >
                {label}
              </button>
            ))}
          </div>

          <div className="filters">
            <input
              className="search"
              placeholder="Search people, plans, countries…"
              value={search}
              onChange={(e) =>
                dispatch({ type: "SET_SEARCH", search: e.target.value })
              }
              enterKeyHint="search"
            />
            <select
              className="select"
              value={statusFilter}
              onChange={(e) =>
                dispatch({
                  type: "SET_STATUS",
                  statusFilter: e.target.value as StatusFilter,
                })
              }
            >
              <option value="subscribed">Subscribed</option>
              <option value="active">Renewing</option>
              <option value="cancelling">Cancelling</option>
              <option value="trial">On trial</option>
              <option value="inactive">Inactive</option>
              <option value="all">Everyone</option>
            </select>
            <select
              className="select"
              value={sortKey}
              onChange={(e) =>
                dispatch({
                  type: "SET_SORT",
                  sortKey: e.target.value as SortKey,
                })
              }
            >
              <option value="renew">Sort: next renewal</option>
              <option value="spend">Sort: spend</option>
              <option value="recent">Sort: newest</option>
              <option value="usage">Sort: usage</option>
            </select>
          </div>
        </section>

        {error && (
          <div className="error" role="alert">
            <strong>Couldn’t load live data.</strong>
            <pre>{error}</pre>
          </div>
        )}

        {/* Mobile cards */}
        <div className="cards-wrap" aria-label="Subscribers">
          {loading && !data ? (
            <div className="empty">Loading subscribers…</div>
          ) : filtered.length === 0 ? (
            <div className="empty">No one matches these filters.</div>
          ) : (
            filtered.map((u) => (
              <SubscriberCard key={`${u.applicationId}:${u.appUserId}`} u={u} />
            ))
          )}
        </div>

        {/* Desktop table */}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>App</th>
                <th>Status</th>
                <th className="renew-col">Renewal</th>
                <th>Price</th>
                <th>Spent</th>
                <th>Started</th>
                <th>Usage</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr>
                  <td colSpan={8} className="empty">
                    Loading subscribers…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty">
                    No one matches these filters.
                  </td>
                </tr>
              ) : (
                filtered.map((u) => (
                  <tr key={`${u.applicationId}:${u.appUserId}`}>
                    <td>
                      <div className="person" title={u.appUserId}>
                        {u.displayUserId}
                      </div>
                      <div className="cell-sub">
                        {u.countryCode ? u.countryCode : "—"}
                        {u.lastActiveAt
                          ? ` · Active ${fmtDate(u.lastActiveAt)}`
                          : ""}
                      </div>
                    </td>
                    <td>
                      <div className="cell-main app-cell">
                        <AppAvatar name={u.appName} size={22} />
                        {u.appName}
                      </div>
                    </td>
                    <td>
                      <span className={statusClass(u)}>{u.statusLabel}</span>
                      <div className="cell-sub">{u.periodLabel}</div>
                    </td>
                    <td className="renew-col">
                      <RenewBar user={u} />
                    </td>
                    <td>
                      <div className="cell-main">{u.priceLabel}</div>
                      <div className="cell-sub">{u.productLabel}</div>
                    </td>
                    <td className="strong">
                      {money(u.ltv, u.currencyCode)}
                    </td>
                    <td>
                      <div>{fmtDate(u.firstPurchaseAt)}</div>
                      {u.purchaseCount > 1 ? (
                        <div className="cell-sub">
                          {u.purchaseCount} payments
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <div className="cell-main">
                        {u.sessions7d > 0 || u.sessions30d > 0
                          ? `${u.sessions7d} this week`
                          : "—"}
                      </div>
                      {u.sessions30d > 0 ? (
                        <div className="cell-sub">
                          {u.sessions30d} in 30 days
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="main-footer-mobile">
          <SiteFooter />
        </div>
      </main>
    </div>
  );
}
