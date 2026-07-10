# Superwall Subscribers

A simple, mobile-friendly dashboard for your **Superwall** subscribers.

See who is active, who is cancelling, how much they spent, and when they renew — across every app in your org.

**Live site:** https://superwall-users-dashboard.vercel.app  

**GitHub:** https://github.com/AustinFrankel/superwall-subscribers  

**Built by [Austin Frankel](https://github.com/AustinFrankel)**

---

## How to connect (super simple)

Superwall does **not** offer one-click OAuth for third-party dashboards. You create a **read-only** key once (~1 minute). The site walks you through this with screenshots.

### Steps

1. **Open Superwall** → [superwall.com](https://superwall.com) and log in.
2. Go to **Settings → API Keys**  
   Direct link: [Open API Keys](https://superwall.com/select-application?pathname=/applications/:app/settings/api-keys)
3. **Create a key** with only **`data:read`** (you do not need write/admin).
4. **Copy** your **Organization ID** (numbers) and the **API key**.
5. **Paste** them on this site → **Connect**.

On mobile you can use **One paste**: put both in one box as:

```text
123456|your_api_key_here
```

### One-link pairing (easiest way to open again)

After you connect once:

1. Open the sidebar → **Copy one-link**
2. Open that link on another device or bookmark it

The secret lives in the **URL hash** (`#connect=…`), so it is **not** sent to our server in the page request. Clear the link if you shared it by mistake, and rotate the Superwall key if needed.

---

## Privacy & security

| What | How |
|------|-----|
| Where keys live | Your browser `localStorage` only |
| Server storage | **None** — we never save your API key |
| API proxy | Browser → this app → Superwall (key in request headers only) |
| SQL | Static queries only — **no user input** is interpolated |
| Rate limits | Per-IP limits on `/api/*` |
| Headers | CSP, HSTS, `X-Frame-Options: DENY`, no-store on APIs |
| Permissions | Use **`data:read` only** |

This is designed so the dashboard is hard to abuse: no cookie sessions to steal for Superwall, no writable Superwall actions, and no secret stored server-side for the public connect flow.

---

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Optional (private self-host only — skip if people use the connect screen):

```bash
# .env.local
ALLOW_ENV_CREDS=1
SUPERWALL_API_KEY=
SUPERWALL_ORG_ID=
```

Without `ALLOW_ENV_CREDS=1`, env keys are ignored so a public host cannot
accidentally expose your org if those vars are set.

---

## Scripts

```bash
npm run build      # production build
npm run start      # serve production build
npm run lint
npm run qa:format # unit checks for format helpers
# e2e (needs real Superwall creds + running server):
SUPERWALL_API_KEY=… SUPERWALL_ORG_ID=… npm run qa:e2e
```

---

## Deploy

Push to GitHub and deploy on **Vercel**. No env vars required if users connect from the UI.

```bash
git push origin main
```

---

## License

Private / personal project. Built by Austin Frankel.
