# Superwall Subscribers

A simple dashboard for your Superwall subscribers.

See who is active, who is cancelling, how much they spent, and when they renew.

## Live site

https://superwall-users-dashboard.vercel.app

## How to use it

1. Open the site.
2. Go to Superwall → Settings → API Keys.
3. Create a key with `data:read`.
4. Paste your Organization ID and API key.
5. Hit Connect.

Your key stays in your browser. It is not saved on the server.

## Run it yourself

```bash
npm install
npm run dev
```

Optional: put keys in `.env.local` instead of the connect screen.

```bash
SUPERWALL_API_KEY=sk_...
SUPERWALL_ORG_ID=12345
```

## Deploy

Push to GitHub and deploy on Vercel. No env vars required if people use the connect screen.
