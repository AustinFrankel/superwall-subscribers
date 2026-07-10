/**
 * Lightweight QA checks for format helpers.
 * Run: npx tsx scripts/qa-format.ts
 */
import {
  cleanAppName,
  displayUserId,
  humanProduct,
  isValidDate,
  priceLabel,
  renewProgressPct,
  sanitizeDate,
  statusLabel,
} from "../lib/format";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(!isValidDate("1969-12-31 19:00:00"), "epoch date rejected");
assert(!isValidDate(null), "null date rejected");
assert(isValidDate("2026-07-10 12:00:00"), "valid date accepted");
assert(sanitizeDate("1970-01-01 00:00:00") === null, "1970 sanitized");

assert(displayUserId("$SuperwallAlias:ABCDEFGH12345678") === "ABCDEFGH…5678", "alias shortened");
assert(cleanAppName("6770344832", 45676) === "App 45676", "numeric app name cleaned");
assert(cleanAppName("My Cool App", 1) === "My Cool App", "human app name kept");
assert(humanProduct("seatmaker_pro_weekly_v3") === "Weekly", "weekly product");
assert(humanProduct("com.timeCapsule.yearly1") === "Yearly", "yearly product");

assert(
  priceLabel({
    lastPrice: 0,
    paidPrice: null,
    catalogPrice: 17.99,
    periodType: "TRIAL",
    currencyCode: "USD",
  }).includes("Trial"),
  "trial uses catalog price",
);

assert(
  statusLabel({
    status: "ACTIVE",
    willCancel: true,
    isCancelled: false,
    periodType: "TRIAL",
  }) === "Cancelling",
  "cancelling label",
);

const pct = renewProgressPct({
  autoRenew: true,
  willCancel: false,
  nextBillingAt: new Date(Date.now() + 3 * 86400000).toISOString(),
  periodStartAt: new Date(Date.now() - 4 * 86400000).toISOString(),
  billingPeriodDays: 7,
  productId: "pro_weekly",
  periodType: "NORMAL",
});
assert(pct !== null && pct > 40 && pct < 70, `renew progress mid-period got ${pct}`);

assert(
  renewProgressPct({
    autoRenew: true,
    willCancel: true,
    nextBillingAt: new Date(Date.now() + 86400000).toISOString(),
    periodStartAt: null,
    billingPeriodDays: 7,
    productId: "pro_weekly",
    periodType: "NORMAL",
  }) === null,
  "no progress when cancelling",
);

console.log("qa-format: ok");
