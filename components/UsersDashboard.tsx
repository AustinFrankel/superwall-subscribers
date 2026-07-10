"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  authHeaders,
  clearCreds,
  loadCreds,
  saveCreds,
  type StoredCreds,
} from "@/lib/creds";
import { fmtDate, fmtDateTime, money, renewCountdown } from "@/lib/format";
import type { SubscriberRow, UsersResponse } from "@/lib/types";

type TimePeriod = "all" | "7d" | "30d" | "90d" | "year";
type StatusFilter = "all" | "active" | "cancelling" | "trial" | "inactive";
type SortKey = "renew" | "spend" | "recent" | "usage";

const REFRESH_MS = 45_000;

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

    const { primary, secondary } = renewCountdown(user.daysUntilBilling, user.nextBillingAt);
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

  return (
    <div className="connect-page">
      <div className="connect-card">
        <h1>Superwall Subscribers</h1>
        <p className="connect-lead">
          Paste your Superwall org ID and API key. Keys stay in your browser only.
        </p>

        <label className="field">
          <span>Organization ID</span>
          <input
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            placeholder="12345"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <label className="field">
          <span>API key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk_…"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <p className="connect-help">
          Superwall → Settings → API Keys. Make a key with <code>data:read</code>.
        </p>

        {error ? <div className="error tight">{error}</div> : null}

        <button
          type="button"
          className="btn primary"
          disabled={busy || !orgId.trim() || !apiKey.trim()}
          onClick={() => onConnect({ orgId: orgId.trim(), apiKey: apiKey.trim() })}
        >
          {busy ? "Connecting…" : "Connect"}
        </button>
      </div>
    </div>
  );
}

export default function UsersDashboard() {
  const [creds, setCreds] = useState<StoredCreds | null>(null);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<UsersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [appFilter, setAppFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("all");
  const [sortKey, setSortKey] = useState<SortKey>("renew");

  useEffect(() => {
    setCreds(loadCreds());
    setReady(true);
  }, []);

  const load = useCallback(
    async (silent = false, override?: StoredCreds) => {
      const active = override ?? creds;
      if (!active) return false;

      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/users", {
          cache: "no-store",
          headers: authHeaders(active),
        });
        const json = (await res.json()) as UsersResponse;
        if (!res.ok || json.error) {
          setError(json.error || `Request failed (${res.status})`);
          setData(json);
          return false;
        }
        setData(json);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
        return false;
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [creds],
  );

  useEffect(() => {
    if (!creds) return;
    void load(false);
    const id = window.setInterval(() => void load(true), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [creds, load]);

  async function handleConnect(next: StoredCreds) {
    setLoading(true);
    setError(null);
    const ok = await load(false, next);
    if (ok) {
      saveCreds(next);
      setCreds(next);
    } else {
      setLoading(false);
    }
  }

  function handleDisconnect() {
    clearCreds();
    setCreds(null);
    setData(null);
    setError(null);
    setAppFilter("all");
  }

  const appGroups = useMemo(() => {
    const users = data?.users ?? [];
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
    return [...map.values()].sort((a, b) => b.active - a.active || b.count - a.count);
  }, [data]);

  const filtered = useMemo(() => {
    const users = data?.users ?? [];
    const q = search.trim().toLowerCase();

    let rows = users.filter((u) => {
      if (appFilter !== "all") {
        const group = appGroups.find((g) => g.name === appFilter);
        if (group) {
          if (!group.ids.has(u.applicationId)) return false;
        } else if (String(u.applicationId) !== appFilter) {
          return false;
        }
      }

      if (statusFilter === "active" && (u.status !== "ACTIVE" || u.willCancel)) return false;
      if (statusFilter === "cancelling" && !u.willCancel) return false;
      if (statusFilter === "inactive" && u.status === "ACTIVE") return false;
      if (statusFilter === "trial" && (u.periodType || "").toUpperCase() !== "TRIAL") {
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
          const at = a.firstPurchaseAt ? new Date(a.firstPurchaseAt).getTime() : 0;
          const bt = b.firstPurchaseAt ? new Date(b.firstPurchaseAt).getTime() : 0;
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
  }, [data, search, appFilter, statusFilter, timePeriod, sortKey, appGroups]);

  const stats = useMemo(() => {
    const rows = filtered;
    const active = rows.filter((u) => u.status === "ACTIVE" && !u.willCancel).length;
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
      all: data?.users.length ?? 0,
      active,
      cancelling,
      renewingSoon,
      ltv,
    };
  }, [filtered, data]);

  if (!ready) {
    return <div className="connect-page"><div className="connect-card">Loading…</div></div>;
  }

  if (!creds) {
    return <ConnectScreen onConnect={handleConnect} error={error} busy={loading} />;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
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
            onClick={() => setAppFilter("all")}
          >
            <span>All apps</span>
            <span className="nav-count">{data?.users.length ?? 0}</span>
          </button>
          {appGroups.map((g) => (
            <button
              key={g.name}
              type="button"
              className={`nav-item ${appFilter === g.name ? "active" : ""}`}
              onClick={() => setAppFilter(g.name)}
            >
              <span className="nav-label">
                <span className="nav-name">{g.name}</span>
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
          <button type="button" className="btn ghost" onClick={handleDisconnect}>
            Disconnect
          </button>
          <p className="hint">Auto-refreshes every 45s · keys stay in your browser</p>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{appFilter === "all" ? "All subscribers" : appFilter}</h1>
            <p className="sub">
              Showing {stats.total.toLocaleString()} of {stats.all.toLocaleString()} people
            </p>
          </div>
        </header>

        <section className="stats">
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
            <span className="stat-value">{stats.renewingSoon.toLocaleString()}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Cancelling</span>
            <span className="stat-value warn">{stats.cancelling.toLocaleString()}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Spent so far</span>
            <span className="stat-value">{money(stats.ltv)}</span>
          </div>
        </section>

        <section className="toolbar">
          <div className="period-row">
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
                onClick={() => setTimePeriod(key)}
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
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="all">All statuses</option>
              <option value="active">Active (renewing)</option>
              <option value="cancelling">Cancelling</option>
              <option value="trial">On trial</option>
              <option value="inactive">Inactive</option>
            </select>
            <select
              className="select"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
            >
              <option value="renew">Sort: next renewal</option>
              <option value="spend">Sort: spend</option>
              <option value="recent">Sort: newest</option>
              <option value="usage">Sort: usage</option>
            </select>
          </div>
        </section>

        {error && (
          <div className="error">
            <strong>Couldn’t load live data.</strong>
            <pre>{error}</pre>
          </div>
        )}

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
                        {u.lastActiveAt ? ` · Active ${fmtDate(u.lastActiveAt)}` : ""}
                      </div>
                    </td>
                    <td>
                      <div className="cell-main">{u.appName}</div>
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
                    <td className="strong">{money(u.ltv, u.currencyCode)}</td>
                    <td>
                      <div>{fmtDate(u.firstPurchaseAt)}</div>
                      {u.purchaseCount > 1 ? (
                        <div className="cell-sub">{u.purchaseCount} payments</div>
                      ) : null}
                    </td>
                    <td>
                      <div className="cell-main">
                        {u.sessions7d > 0 || u.sessions30d > 0
                          ? `${u.sessions7d} this week`
                          : "—"}
                      </div>
                      {u.sessions30d > 0 ? (
                        <div className="cell-sub">{u.sessions30d} in 30 days</div>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
