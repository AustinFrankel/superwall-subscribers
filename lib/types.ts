export type AppInfo = {
  applicationId: number;
  name: string;
  platform: string;
};

export type AppGroup = {
  name: string;
  applicationIds: number[];
  count: number;
  activeCount: number;
};

export type SubscriberRow = {
  appUserId: string;
  displayUserId: string;
  applicationId: number;
  appName: string;
  platform: string;
  status: string;
  statusLabel: string;
  entitlements: string | null;
  lastStatusAt: string | null;
  ltv: number;
  lastPrice: number | null;
  paidPrice: number | null;
  catalogPrice: number | null;
  priceLabel: string;
  productId: string | null;
  productLabel: string;
  periodType: string | null;
  periodLabel: string;
  nextBillingAt: string | null;
  periodStartAt: string | null;
  daysUntilBilling: number | null;
  billingPeriodDays: number | null;
  renewProgress: number | null;
  firstPurchaseAt: string | null;
  lastPurchaseAt: string | null;
  currencyCode: string | null;
  countryCode: string | null;
  cancelReason: string | null;
  willCancel: boolean;
  isCancelled: boolean;
  autoRenew: boolean;
  purchaseCount: number;
  sessions7d: number;
  sessions30d: number;
  lastActiveAt: string | null;
  store: string | null;
  environment: string | null;
};

export type UsersResponse = {
  fetchedAt: string;
  count: number;
  totalAvailable: number;
  apps: AppInfo[];
  users: SubscriberRow[];
  error?: string;
};
