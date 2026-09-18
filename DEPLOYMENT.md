# Free deployment: Netlify + Render + Neon

This guide deploys the Vite storefront to Netlify, the Express API to Render and PostgreSQL to Neon. The browser calls the Render API directly. This avoids Netlify's proxy timeout when a free Render service wakes from sleep.

## Architecture

```
Browser -> Netlify storefront -> Render API -> Neon PostgreSQL
                         \-> Cloudinary (optional product uploads)
```

The frontend URL is public configuration (`VITE_API_ORIGIN`). All database, CSRF, admin and Cloudinary credentials exist only in Render or Neon.

## 1. Push this repository

The repository must contain `netlify.toml` and `render.yaml`. Do not commit `.env` or use a production password in any tracked file.

```powershell
npm ci
npm run build
npm run build:server
npm run lint
git add .
git commit -m "Prepare Netlify and Render deployment"
git push -u origin master
```

## 2. Create the Netlify storefront

1. In Netlify, choose **Add new project** and connect `ivandevelopweb/veloraShop`.
2. Netlify reads `netlify.toml`: build command is `npm run build`, publish directory is `dist`, and `/admin/*` receives the SPA fallback.
3. Deploy once to obtain the public site URL, for example `https://velora-shop.netlify.app`.
4. In **Project configuration -> Environment variables**, add `VITE_API_ORIGIN` after the Render API exists. Its value must be the complete HTTPS URL without a trailing slash, for example `https://velora-api.onrender.com`.
5. Trigger a new production deploy after setting this variable. Vite substitutes `VITE_*` variables at build time, so a redeploy is required.

Netlify serves the frontend only. Do not put `DATABASE_URL`, `CSRF_SECRET`, `ADMIN_PASSWORD`, or Cloudinary secrets in Netlify.

## 3. Create the Neon PostgreSQL database

1. Create a free Neon project in a region near the Render service.
2. Open **Connect** and copy the PostgreSQL connection string. It must include Neon TLS settings such as `sslmode=require`.
3. Keep the connection string private. It is the value for Render's `DATABASE_URL`.

The free Neon tier is intended for low-traffic applications and may wake from idle. The API automatically runs migrations and the idempotent seed command when it starts.

## 4. Deploy the Express API on Render

1. In Render, select **New -> Blueprint**, then connect `ivandevelopweb/veloraShop`.
2. Render reads `render.yaml` and creates the free `velora-api` web service.
3. When Render prompts for variables marked as secret, set:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Private Neon PostgreSQL connection string |
| `CLIENT_ORIGINS` | Exact Netlify URL, for example `https://velora-shop.netlify.app` |
| `ADMIN_EMAIL` | Email for the first administrator |
| `ADMIN_PASSWORD` | New password, 12–72 characters, with letters and digits |
| `GEMINI_API_KEY` | Google AI Studio API key; keep it only on Render |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` |
| `GEMINI_TIMEOUT_MS` | `12000` |

`NODE_ENV`, secure cookies, `SameSite=None` and a generated `CSRF_SECRET` are configured by `render.yaml`. Add all three Cloudinary variables in Render later only if uploading new product images is required.

Render uses its assigned `PORT`, listens on its public interface and checks `/api/health`. The `start:render` command applies pending migrations, seeds missing default data, then starts the API. Both migration and seed operations are idempotent.

The assistant uses the stable `gemini-3.1-flash-lite` model. Do not put
`GEMINI_API_KEY` in Netlify or in any `VITE_*` variable; the browser must call
the backend endpoint and never receive the key.

Copy the resulting Render URL, for example `https://velora-api.onrender.com`.

## 5. Connect the deployed frontend to the API

1. Return to Netlify and set `VITE_API_ORIGIN` to the copied Render URL.
2. Redeploy the production site.
3. In Render, confirm `CLIENT_ORIGINS` exactly matches the Netlify production URL. No trailing slash and no wildcard are allowed.

The frontend uses `credentials: include`. Production cookies are `Secure` and `SameSite=None`, which is required because the Netlify and Render domains are different sites.

## 6. Verify the release

1. Open `https://YOUR-RENDER-SERVICE.onrender.com/api/health`; it must return `{ "status": "ok" }`.
2. Open the Netlify URL in a private browser window.
3. Register a test customer, add an item to cart, refresh the page and verify the cart persists.
4. Log in as the administrator and open `/admin`; change a product stock value and confirm it appears in the storefront.
5. Verify a direct `/admin/...` refresh works and that browser developer tools show requests to the Render API without CORS errors.

The first API request after around 15 minutes without traffic can be slow because Render Free wakes the service. Do not add fake availability data or client-side product fallbacks to mask this condition.

## Operations and limits

- Render Free can sleep after inactivity and is for a low-traffic demo, not a commercial store.
- Neon Free has monthly compute and storage limits; monitor them in Neon.
- Netlify's `VITE_API_ORIGIN` is public by design. Never prefix a secret with `VITE_`.
- Before each push, run `npm run build`, `npm run build:server` and `npm run lint`.
- Back up production data before applying destructive database changes. Never edit an existing migration after it has reached a shared database.
