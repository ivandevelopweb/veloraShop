# Velora security review

Reviewed: 2026-08-28

## Executive summary

No critical or high-severity vulnerabilities were found in the application source reviewed. The app has solid foundations: opaque server-side sessions in `HttpOnly` cookies, CSRF validation for mutations, server-side role checks, Zod validation, parameterized SQL, file signature checks and strict CORS origins.

One current configuration error prevents the backend from starting: `ADMIN_PASSWORD` in the local `.env` is shorter than the required 12 characters. This is an availability/configuration issue, not a weakness to bypass. The account is therefore not seeded either.

## Findings

### S-01 — Proxy-aware rate limiting is not configured

- Rule ID: EXPRESS-PROXY-001 / EXPRESS-AUTH-001
- Severity: Medium
- Location: `server/src/auth-rate-limit.ts:11`, `server/src/app.ts:16-47`
- Evidence: the limiter derives its key from `request.ip`, but the app does not configure `trust proxy` at all. The production documentation requires a reverse proxy while `server/src/index.ts:12` binds the API to `127.0.0.1`.
- Impact: behind a conventional single reverse proxy, every public request may be seen as the proxy's loopback address. Ten failed login attempts from one visitor could throttle all visitors for 15 minutes.
- Fix: add an explicit, validated `TRUST_PROXY_HOPS` configuration option (default `0` locally); configure it to the known proxy-hop count in production, rather than setting `trust proxy` to `true`.
- Mitigation: until fixed, do not place the API behind a reverse proxy that is shared by multiple visitors.
- False-positive notes: not exploitable in the current local-only setup; confirm the final deployment topology.

### S-02 — Authenticated API responses do not explicitly prohibit shared caching

- Rule ID: EXPRESS-HEADERS-001 / EXPRESS-ERROR-001
- Severity: Medium
- Location: `server/src/app.ts:53-56`, `server/src/routes/auth.ts:100-108`, `server/src/routes/orders.ts:26-45`, `server/src/routes/admin.ts:210-276`, `server/src/routes/admin.ts:725-849`
- Evidence: only `/api/auth/csrf` sets `Cache-Control: no-store`. The authenticated profile, cart, order and admin responses can contain email, phone, delivery and order data but do not set a cache policy.
- Impact: a misconfigured CDN or reverse proxy could cache a personalized JSON response and disclose it to another visitor.
- Fix: centrally set `Cache-Control: no-store, private` for authenticated API route groups, while retaining explicit cache policies for public catalogue endpoints.
- Mitigation: configure the reverse proxy/CDN never to cache `/api/*` until the response policy is in code.
- False-positive notes: browsers normally do not share private fetch caches across users; the risk depends on production proxy/CDN behavior, which is not present in the repository.

### S-03 — Production can fall back to development CORS origins

- Rule ID: EXPRESS-CORS-001
- Severity: Low
- Location: `server/src/config.ts:10`, `server/src/app.ts:37-45`
- Evidence: `CLIENT_ORIGINS` defaults to `http://localhost:5173,http://127.0.0.1:5173` regardless of `NODE_ENV`.
- Impact: a production deployment that omits this variable has an origin allowlist that does not match its real frontend. This is more likely to break real login flows than to bypass CSRF, but production configuration should fail closed.
- Fix: require a non-empty explicit `CLIENT_ORIGINS` when `NODE_ENV=production`.
- Mitigation: always set the exact HTTPS storefront origin in the deployment secret/configuration.
- False-positive notes: the cookie is `SameSite=Lax` and mutations also require CSRF, so this is not a demonstrated cross-origin account takeover.

### S-04 — Successful registrations are not throttled

- Rule ID: EXPRESS-AUTH-001
- Severity: Low
- Location: `server/src/routes/auth.ts:52-73`, `server/src/auth-rate-limit.ts:22-63`
- Evidence: rate-limit counters are recorded only in the registration `catch` path and on failed logins. A script can submit many valid, unique registrations without incrementing the IP counter.
- Impact: database growth and bcrypt work can be abused to create unwanted accounts.
- Fix: add a separate, bounded registration rate limit keyed by IP, with an explicit limit suitable for the product.
- Mitigation: deploy an edge rate limit on `/api/auth/register`.
- False-positive notes: the impact is lower for a private demonstration instance but matters for a public portfolio deployment.

### S-05 — Production frontend headers are a deployment assumption

- Rule ID: REACT-HEADERS-001 / REACT-CSP-001
- Severity: Low
- Location: `README.md:108-111`, `vite.config.ts:5-14`
- Evidence: the Express API applies Helmet, but the built React application is served separately through an unspecified reverse proxy/CDN. The repository contains no production server or edge configuration that applies CSP, clickjacking and referrer-policy headers to `dist/index.html`.
- Impact: the SPA shell may ship without the intended browser-side defense-in-depth headers if the deployment is configured incorrectly.
- Fix: add deployment configuration that serves `dist/` with the reviewed response headers, then verify them in the production environment.
- Mitigation: use the documented reverse-proxy configuration and test final response headers before publishing.
- False-positive notes: an external host/CDN may already set these headers; that configuration is not visible in this repository.

### S-06 — No automated security or integration test suite is present

- Rule ID: REACT-SUPPLY-001 / EXPRESS-DEPS-001
- Severity: Low
- Location: `package.json:5-20`; no test directory or CI workflow is present.
- Evidence: build and lint commands exist, and `npm audit --omit=dev` currently reports no production vulnerabilities, but no automated test command/CI pipeline exercises authentication, CSRF, ownership or admin authorization.
- Impact: regressions in sensitive flows can reach deployment unnoticed.
- Fix: add API integration tests for guest/admin/customer boundaries, CSRF, ownership, order stock transactions and file upload rejection; run build, lint and audit in CI using `npm ci`.
- Mitigation: run the documented verification commands and manual smoke tests before each deploy.

## Verified strengths

- Client code stores only wishlist preferences in local storage; session identifiers stay in server-validated `HttpOnly` cookies (`src/App.tsx:611-617`, `server/src/security.ts:50-55`).
- Cookie-authenticated mutations use a signed double-submit CSRF token (`server/src/security.ts:22-47`) and the React client attaches it (`src/api.ts:156-180`).
- Admin APIs enforce role checks on the server, not just in the UI (`server/src/routes/admin.ts:68-70`).
- Route input is validated by Zod and database values are passed as PostgreSQL parameters; no user-controlled shell commands, raw HTML sinks, unsafe redirects or user-file serving routes were found.
- Product image uploads use memory storage, size limits, an allowlist and a signature check before Cloudinary upload (`server/src/media.ts:7-25`, `server/src/media.ts:37-65`).

## Verification performed

- PostgreSQL container healthy; two migrations applied; 50 products present.
- TypeScript server build, Vite production build and lint pass.
- `npm audit --omit=dev` reports zero production dependency vulnerabilities.
- A startup reproduction confirmed the backend stops because the configured `ADMIN_PASSWORD` is shorter than 12 characters.

---

# ZAP report triage

Reviewed: 2026-09-04

## Scope and executive summary

Only the six alerts reported for `https://velora-api-cg44.onrender.com` were assessed. Findings for LiqPay, Google Pay, PrivatBank, analytics, CDNs and other third-party hosts were excluded.

No ZAP alert in this scope is a confirmed vulnerability. The two cookie alerts describe the deliberate, signed double-submit CSRF design required by the separately hosted Netlify storefront and Render API. The other four alerts are informational classifications or a parser false positive.

One separate low-severity abuse risk was found during the auth review: a client could create many valid, unique accounts because only failed authentication attempts incremented a rate-limit counter. It is remediated below without changing sessions, authorisation or checkout logic.

## ZAP alert assessment

| ZAP alert | Assessment and severity | Evidence and cause | Changed file / resolution |
| --- | --- | --- | --- |
| Cookie No HttpOnly Flag (`GET /api/auth/csrf`) | False positive; no vulnerability. | `server/src/security.ts:22-31` deliberately makes only the CSRF double-submit value readable by the storefront. It is an HMAC-signed, short-lived anti-CSRF value, not an authenticated session. The opaque session cookie is separately set `httpOnly: true` at `server/src/security.ts:50-56`. | No change required. |
| Cookie with SameSite Attribute None (`GET /api/auth/csrf`) | False positive; no vulnerability. | The storefront and API are on different sites, so production needs `SameSite=None; Secure` (`server/src/config.ts:129`, `server/src/security.ts:6-10`). State-changing routes require the matching signed CSRF cookie and custom header (`server/src/security.ts:33-47`), while CORS accepts only exact configured origins (`server/src/app.ts:39-47`). | No change required. |
| Timestamp Disclosure - Unix (`GET /api/products?pageSize=100`) | False positive; informational only. | ZAP matched `1549465220` inside a public Unsplash image identifier returned in product data. These seed URLs are constructed in `server/src/catalog.ts:656`; the value is neither a session, token nor internal server timestamp. | No change required. |
| Authentication Request Identified (`POST /api/auth/login`) | Informational scanner classification; no vulnerability. | It correctly identifies the login route. Credentials are schema-validated and login requires CSRF (`server/src/routes/auth.ts:77-100`); failed attempts are rate-limited (`server/src/auth-rate-limit.ts:22-34`). | No change required. |
| Session Management Response Identified (`GET /api/auth/csrf`) | Informational scanner classification; no vulnerability. | It correctly identifies the CSRF bootstrap response (`server/src/app.ts:59-62`). Authenticated requests use a server-stored opaque random token and an `HttpOnly` cookie, not a client-stored bearer token (`server/src/auth.ts:16-42`, `server/src/security.ts:50-56`). | No change required. |
| User Agent Fuzzer (`POST /api/auth/logout`) | Informational active-scan record; no vulnerability. | No security decision depends on `User-Agent`. Logout is protected by both CSRF and authentication (`server/src/routes/auth.ts:112-121`), so a forged or modified user agent cannot terminate another user's session. | No change required. |

## Remediated non-ZAP finding

### ZAP-EXT-01 — Valid registration throughput was not rate-limited

- Severity: Low
- Location: `server/src/routes/auth.ts:53-74`, formerly relying on failed-auth counters only.
- Impact: an automated client could submit many valid, unique registrations, consuming bcrypt and database capacity.
- Fix: `reserveRegistrationAttempt()` in `server/src/auth-rate-limit.ts:66-93` atomically reserves one of five registrations per source IP per hour. The reservation runs only after CSRF and schema validation (`server/src/routes/auth.ts:56-59`), so cross-site requests cannot exhaust the quota. It reuses the existing hashed-counter table and does not store source addresses in plaintext.

## Focused control review

- Authorisation: customer resource queries filter by the authenticated `user_id`; admin routes use a server-side `requireAdmin` middleware (`server/src/routes/admin.ts:71-75`).
- CORS: credentialed CORS is exact-origin allowlisted (`server/src/app.ts:39-47`), and production rejects missing or non-HTTPS origin configuration (`server/src/config.ts:96-113`).
- Cookies and tokens: production uses `Secure`, `SameSite=None`, `__Host-` names and an `HttpOnly` opaque session cookie; no session identifiers are stored in browser storage (`server/src/security.ts:6-10`, `server/src/security.ts:50-59`).
- Error disclosure: the final error handler returns generic 500 messages and logs only the internal message server-side (`server/src/errors.ts:18-40`).
- Sensitive data: API responses receive `Cache-Control: no-store` centrally (`server/src/app.ts:51-55`); all SQL request values are parameterized and validated at route boundaries.

## Verification

- `npm run build:server` — passed.
- `npm run build` — passed.
- `npm run lint` — passed.
- Desktop and 390 × 844 mobile checks of the production build — passed for the static UI shell. The local API was unavailable, so dynamic catalogue/auth flows were not exercised locally.
- `npm audit --omit=dev` — reports three moderate, transitive `qs` advisories through Express, with no fix available in npm for the current dependency tree. No automatic dependency upgrade was applied.
