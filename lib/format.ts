const EPOCH_CUTOFF = Date.parse("2000-01-01T00:00:00Z");

export function isValidDate(value: string | null | undefined): value is string {
  if (!value) return false;
  const d = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() >= EPOCH_CUTOFF;
}

export function sanitizeDate(value: string | null | undefined): string | null {
  return isValidDate(value) ? value : null;
}

export function displayUserId(raw: string): string {
  let id = raw;
  if (id.startsWith("$SuperwallAlias:")) {
    id = id.slice("$SuperwallAlias:".length);
  }
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export function cleanAppName(name: string | null | undefined, applicationId: number): string {
  const fallback = `App ${applicationId}`;
  if (!name) return fallback;
  const trimmed = name.trim();
  if (!trimmed || /^\d+$/.test(trimmed)) return fallback;
  return trimmed;
}

export function humanProduct(productId: string | null | undefined): string {
  if (!productId) return "—";
  const lower = productId.toLowerCase();
  if (lower.includes("weekly")) return "Weekly";
  if (lower.includes("monthly")) return "Monthly";
  if (lower.includes("quarterly")) return "Quarterly";
  if (lower.includes("yearly") || lower.includes("annual")) return "Yearly";
  if (lower.includes("lifetime")) return "Lifetime";
  return productId
    .replace(/^com\.[^.]+\./, "")
    .replace(/[_-]+/g, " ")
    .replace(/\bv\d+\b/gi, "")
    .trim();
}

export function periodLabel(periodType: string | null | undefined, productId?: string | null) {
  const p = (periodType || "").toUpperCase();
  if (p === "TRIAL") return "Free trial";
  if (p === "INTRO") return "Intro offer";
  if (p === "NORMAL" || p === "REGULAR") {
    return humanProduct(productId || null);
  }
  if (!p) return humanProduct(productId || null);
  return p.charAt(0) + p.slice(1).toLowerCase();
}

export function statusLabel(opts: {
  status: string;
  willCancel: boolean;
  isCancelled: boolean;
  periodType: string | null;
}): string {
  if (opts.willCancel) return "Cancelling";
  if (opts.status === "ACTIVE") {
    if ((opts.periodType || "").toUpperCase() === "TRIAL") return "On trial";
    return "Active";
  }
  if (opts.isCancelled) return "Cancelled";
  if (opts.status === "INACTIVE") return "Inactive";
  return "Ended";
}

export function inferPeriodDays(
  billingPeriodDays: number | null,
  productId: string | null,
  periodType: string | null,
): number | null {
  if (billingPeriodDays && billingPeriodDays > 0 && billingPeriodDays < 800) {
    return billingPeriodDays;
  }
  const p = (periodType || "").toUpperCase();
  if (p === "TRIAL") return 3;
  const id = (productId || "").toLowerCase();
  if (id.includes("weekly")) return 7;
  if (id.includes("monthly")) return 30;
  if (id.includes("quarterly")) return 90;
  if (id.includes("yearly") || id.includes("annual")) return 365;
  return billingPeriodDays && billingPeriodDays > 0 ? billingPeriodDays : null;
}

/** 0–100 progress through current billing period. Null if cancelled / no renew date. */
export function renewProgressPct(opts: {
  autoRenew: boolean;
  willCancel: boolean;
  nextBillingAt: string | null;
  periodStartAt: string | null;
  billingPeriodDays: number | null;
  productId: string | null;
  periodType: string | null;
}): number | null {
  if (opts.willCancel || !opts.nextBillingAt) return null;
  // Still show progress for active renewing subs even if autoRenew flag is off edge cases
  if (!opts.autoRenew && !opts.willCancel) {
    // allow when we have a future billing date
  }

  const end = new Date(
    opts.nextBillingAt.includes("T")
      ? opts.nextBillingAt
      : opts.nextBillingAt.replace(" ", "T") + "Z",
  ).getTime();
  if (Number.isNaN(end)) return null;

  const now = Date.now();
  if (end <= now) return 100;

  let start: number | null = null;

  if (opts.periodStartAt) {
    const s = new Date(
      opts.periodStartAt.includes("T")
        ? opts.periodStartAt
        : opts.periodStartAt.replace(" ", "T") + "Z",
    ).getTime();
    if (!Number.isNaN(s) && s < end) start = s;
  }

  if (start === null) {
    const days =
      inferPeriodDays(opts.billingPeriodDays, opts.productId, opts.periodType) ?? 30;
    start = end - days * 24 * 60 * 60 * 1000;
  }

  const total = end - start;
  if (total <= 0) return null;
  const elapsed = now - start;
  return Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
}

export function money(amount: number | null | undefined, currency?: string | null) {
  if (amount === null || amount === undefined) return "—";
  const code = currency && currency.length === 3 ? currency : "USD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

export function priceLabel(opts: {
  lastPrice: number | null;
  paidPrice: number | null;
  catalogPrice?: number | null;
  periodType: string | null;
  currencyCode: string | null;
}): string {
  const catalog =
    opts.catalogPrice && opts.catalogPrice > 0 ? opts.catalogPrice : null;
  const paid = opts.paidPrice && opts.paidPrice > 0 ? opts.paidPrice : null;
  const last = opts.lastPrice && opts.lastPrice > 0 ? opts.lastPrice : null;

  if ((opts.periodType || "").toUpperCase() === "TRIAL") {
    const after = paid ?? catalog;
    if (after) return `Trial → ${money(after, opts.currencyCode)}`;
    return "Free trial";
  }

  const amount = last ?? paid ?? catalog;
  if (amount === null) return "—";
  return money(amount, opts.currencyCode);
}

export function fmtDate(value: string | null | undefined) {
  if (!isValidDate(value)) return "—";
  const d = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function fmtDateTime(value: string | null | undefined) {
  if (!isValidDate(value)) return "—";
  const d = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function renewCountdown(daysUntil: number | null, nextBillingAt: string | null) {
  if (daysUntil === null || !nextBillingAt) return { primary: "—", secondary: "" };
  if (daysUntil < 0) {
    return {
      primary: "Past due",
      secondary: fmtDate(nextBillingAt),
    };
  }
  if (daysUntil === 0) {
    return { primary: "Renews today", secondary: fmtDate(nextBillingAt) };
  }
  if (daysUntil === 1) {
    return { primary: "Renews tomorrow", secondary: fmtDate(nextBillingAt) };
  }
  if (daysUntil < 14) {
    return { primary: `Renews in ${daysUntil} days`, secondary: fmtDate(nextBillingAt) };
  }
  return { primary: `Renews in ${daysUntil} days`, secondary: fmtDate(nextBillingAt) };
}
