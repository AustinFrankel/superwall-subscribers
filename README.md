# Superwall Subscribers

Live subscriber dashboard for Superwall.

**Site:** https://superwall-users-dashboard.vercel.app  
**GitHub:** https://github.com/AustinFrankel/superwall-subscribers  

Built by [Austin Frankel](https://github.com/AustinFrankel)

## Connect

1. Superwall → **Settings → Keys**
2. Under **Organization API Keys**, create or copy a key (`sk_…`)
3. Paste it on the site → **Connect**

No org ID needed. We resolve it from your key.

Do **not** use the public `pk_` key.

## Privacy

- Key stays in your browser only
- Not saved on our servers
- Static Superwall queries only
- Optional Redis rate limits (Upstash)

## Redis (optional)

On Vercel, add:

```bash
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

Without Redis, in-memory limits still apply.

## Local

```bash
npm install
npm run dev
```

```bash
npm run qa
npm run build
BASE_URL=http://localhost:3000 npm run qa:smoke
```
