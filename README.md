# Velora

Velora is a premium Ukrainian full-stack storefront case study. It has a React + TypeScript storefront, an Express + PostgreSQL API, cookie sessions, a mock checkout and an admin area for catalogue operations.

Payment is deliberately a mock: an order is created, but money is never charged.

## Included scenarios

- Ukrainian-language storefront with UAH prices, 50 varied seed products, search, category/price filters, sorting, product views and wishlist;
- registration, login, server-side cart and order history for each account;
- PostgreSQL-backed opaque session in an `HttpOnly`, `SameSite=Lax` cookie;
- CSRF validation on every cookie-authenticated mutation;
- `/admin` protected by both client UX and server-side role checks;
- admin dashboard, product CRUD, categories, stock, image gallery, order views and controlled status changes;
- media upload to Cloudinary: only real JPG, PNG and WebP images, up to 10 MB, are accepted;
- `node-pg-migrate` migrations and an idempotent seed command for a clean local setup.

## Stack

- Frontend: React, TypeScript, CSS, Vite
- Backend: Node.js, Express, TypeScript
- Database: PostgreSQL 16
- Media: Cloudinary (optional for local development)

## First local launch

### 1. Configure environment

Copy [`.env.example`](.env.example) to a local `.env` file. This file is ignored by Git.

Set a strong `POSTGRES_PASSWORD`, then use the exact same password in `DATABASE_URL`. The included Docker service is exposed only locally on port `5433` by default:

```dotenv
POSTGRES_PASSWORD=your-local-password
POSTGRES_HOST_PORT=5433
DATABASE_URL=postgresql://velora:your-local-password@127.0.0.1:5433/velora
```

`POSTGRES_HOST_PORT` is the host port for this project's container. If another local PostgreSQL container already occupies `5433`, choose a free port (for example `55432`) and use the same port in `DATABASE_URL`. This keeps the Velora database separate from other projects and lets Docker restart the correct database after a reboot.

To create the first administrator during seed, set both fields:

```dotenv
ADMIN_EMAIL=your-admin-email@example.com
ADMIN_PASSWORD=a-long-password-with-letters-and-numbers
```

Do not commit the real `.env`, session cookies, passwords or Cloudinary credentials.

### 2. Start PostgreSQL

```powershell
docker compose up -d postgres
docker compose ps
```

The named Docker volume `velora-postgres` keeps database files. PostgreSQL listens inside the container on `5432`, and only from this computer on `127.0.0.1:${POSTGRES_HOST_PORT}`. The service uses `restart: unless-stopped` so it comes back after Docker restarts.

### 3. Apply schema migrations and seed test data

```powershell
npm install
npm run migrate:up
npm run seed
```

`npm run seed` adds the 50 test products and first admin idempotently. It fills old bootstrap-only rows, but it does not overwrite products that were already edited in the admin panel.

### 4. Run the application

In two terminals:

```powershell
npm run dev:server
npm run dev
```

Or use a single terminal:

```powershell
npm run dev:all
```

Open the Vite address, normally `http://localhost:5173`. Log in with the seeded admin account and open `http://localhost:5173/admin`.

## Database migrations

| Command                                      | Purpose                                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run migrate:up`                         | apply migrations that have not run yet                                                    |
| `npm run migrate:down`                       | attempt one rollback; the supplied data migrations block it intentionally to protect data |
| `npm run migrate:create -- add_feature_name` | create a new migration template in `server/migrations`                                    |
| `npm run seed`                               | seed the catalogue and configured initial admin                                           |

Migrations are a permanent, ordered history of schema changes. Never edit a migration that was already applied to a shared environment; create a new one instead. The initial migrations intentionally block automatic rollback rather than silently marking a schema as rolled back while retaining the data. Use a dedicated, reviewed migration when a real rollback is required.

## Cloudinary image upload

Images are optional until you want to upload them from the admin panel. Create a free Cloudinary account, then put these values only in your local `.env` or production secret manager:

```dotenv
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

Without all three values the rest of the store works, and the upload endpoint replies with a clear “not configured” message. The browser never receives `CLOUDINARY_API_SECRET`.

## Production notes

For a zero-cost Netlify + Render + Neon deployment, follow [DEPLOYMENT.md](DEPLOYMENT.md).

- Run the production frontend behind HTTPS; set `NODE_ENV=production`, a unique `CSRF_SECRET` of at least 32 characters and `SESSION_COOKIE_SECURE=true`.
- Set `CLIENT_ORIGINS` to the exact frontend origins—never use a wildcard with cookie credentials.
- Run migrations in deployment before starting the new server version and back up PostgreSQL first.
- Serve the Vite build through a reverse proxy/CDN that provides SPA fallback for `/admin/*` and verifies the final response security headers.
- Connect a real provider only when payment is implemented server-side with signed webhooks. Do not trust browser-only payment confirmations.

## Verification commands

```powershell
npm run build:server
npm run build
npm run lint
npm audit --omit=dev
```
