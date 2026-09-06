# Velora storefront URL routing design

## Purpose

Replace the storefront's in-memory page switcher with browser-addressable routes. Every public Velora section, category and product must have a stable URL. Clicking a navigation element must create a history entry, so browser Back/Forward, page reload, copied links and a new tab all restore the expected screen.

The work preserves the React, TypeScript, CSS, Express and PostgreSQL stack. It does not change the catalogue schema, public API contracts, session-cookie design, CSRF protection, LiqPay Sandbox flow, or the visual language.

## Route contract

| URL | Screen | Notes |
| --- | --- | --- |
| `/` | Home | The curated landing screen. |
| `/catalog` | Full catalogue | Filtering and sorting are represented by the query string. |
| `/catalog/:categorySlug` | Category catalogue | `categorySlug` is the API category slug, for example `/catalog/dim`. |
| `/product/:productSlug` | Product detail | `productSlug` is the API product slug, for example `/product/velvet-santal`. |
| `/cart` | Cart | A signed-in customer route. |
| `/checkout` | Checkout | A signed-in customer route. |
| `/account` | Account/profile | `mode=login` or `mode=register` selects the form state. |
| `/about` | About Velora | Public static section. |
| `/payment/result?order=:code` | Payment result | Existing LiqPay return/status route. |
| `/admin/*` | Admin application | Retains its existing protected URLs and isolated route model. |
| all other public paths | Not found | A Ukrainian 404 screen with links to the home page and catalogue. |

`/catalog` and category routes use these optional query parameters:

- `search`: trimmed search phrase;
- `sort`: `popular`, `low`, `high`, or `rating`;
- `maxPrice`: integer in the supported price range;
- `rating`: `4.8` when the high-rating filter is enabled.

Invalid, duplicate or out-of-range values are ignored in favour of the existing default. URL parsing never throws. Filter changes use a normal navigation entry; clearing a filter removes its parameter. This makes Back and Forward reproduce the catalogue view precisely.

## Routing architecture

The frontend will add `react-router-dom` and mount a `BrowserRouter` at the React root. `StorefrontApp` becomes a shared application shell instead of a hand-built page router: it owns session recovery, cart synchronization, wishlist persistence, toast messages, common header/footer composition and the controlled admin boundary.

A small `src/storefront/routing/` layer owns route concerns:

```text
storefront/routing/
  paths.ts          # typed URL builders and query parsing/normalization
  AppRoutes.tsx     # public route tree, protected-route wrapper and 404 route
  CatalogRoute.tsx  # maps path/query state to the existing Catalog page
  ProductRoute.tsx  # resolves a product slug and owns its loading/error state
```

Pages remain visual page components. They receive explicit data and callbacks rather than reading `window.location` or composing URL strings themselves. Reusable navigation controls use router `Link` or `NavLink`; controls which change a filter use a callback supplied by the route component. Actions such as add-to-cart, wishlist toggling, sign-out, form submission and the mobile menu remain buttons because they are not navigation.

Typed builders centralize all navigation targets: catalogue/category/product paths, account sign-in redirects and payment-result URLs. Route params are encoded by the builder, not at component call sites. This removes the existing `page`, `activeCategory` and `selectedProductId` application state; the pathname and query string become the source of truth for navigation state.

`/admin/*` is rendered as an isolated branch in the top-level route tree. The existing `AdminApp` continues to own its nested admin URL model until its own routing is deliberately migrated, avoiding incidental changes to its permission model or workflows.

## Screen and data behaviour

The global catalogue hook still loads the list and categories for home content, catalogue recommendations, category validation and cart hydration. A direct product route additionally uses the existing `GET /api/products/:slug` endpoint through a new typed client method. It renders an explicit loading state, the product data, or a product-not-found state. This avoids depending on the full catalogue list to make a copied product URL valid.

The category route validates its slug against API categories. An archived, missing or malformed category is a 404 route; it never silently falls back to all products. The catalogue route derives its filters from `useSearchParams`, so reload and history navigation recompute the same results. The header search navigates to `/catalog` and writes `search` to the query string before displaying results.

Examples of required link destinations:

- Hero “Переглянути колекцію” and the shop navigation link go to `/catalog`.
- Gift CTAs go to `/catalog/podarunky`.
- Each category tile and rail item links to its category path.
- Each product image, product name and recommendation card links to its product path.
- Breadcrumbs link to real home, catalogue and category URLs.
- Header, footer, cart, checkout, account and about controls link to their corresponding route URLs.

Product-detail tab and shade selection remain local UI state. The wishlist remains browser-local by current product ID, while authentication, cart and orders retain their current API-backed behaviour.

## Protected navigation and errors

`/cart` and `/checkout` are protected by a shared route wrapper. It waits for session restoration, then redirects an anonymous visitor to `/account?mode=login&next=...`. `next` is a URL-encoded relative path including its query string. After successful login or registration, the app validates that `next` begins with a single `/` and does not begin with `//`, then returns the customer there. Invalid values fall back to `/account`, preventing an open redirect.

The existing auth-expiry handling follows the same route helper. A cart mutation or checkout attempt that receives `401` clears only the local authenticated state and redirects to the account route with a clear Ukrainian message.

The 404 screen is used for an unknown path and for unavailable products/categories. Loading and network-error states remain explicit and Ukrainian-language. A catalogue request failure must not render local fallback product data. The LiqPay external form and the payment-result endpoint keep their present flow and security boundaries unchanged.

## Migration steps

1. Add the router dependency, mount `BrowserRouter`, add the API `getProduct(slug)` client method and create typed path/query helpers.
2. Move public route matching, protected-route handling and 404 rendering into the routing layer. Reduce `StorefrontApp` to shared state, shared callbacks and route composition.
3. Convert home, header, footer, cart, checkout, account, about, catalogue, product breadcrumbs and product-card navigation to route links/builders.
4. Refactor `CatalogPage` to receive URL-derived filter state and update callbacks. Refactor product rendering to receive a resolved route product, including direct-load, unavailable and error states.
5. Keep the existing admin branch functional, then remove obsolete public `page`/product/category navigation state and manual public `pushState` calls.

No database migration or backend endpoint change is required. Netlify already rewrites public paths to `index.html`, so direct production deep links remain supported.

## Verification

- Build and lint: `npm run build`, `npm run build:server`, `npm run lint`, and the existing test suite.
- Route checks: open every top-level public URL directly; open representative category and product slugs directly; verify unknown paths, products and categories render 404.
- History checks: use header, hero, category tiles, product cards, breadcrumbs, cart and checkout navigation; then verify Back and Forward restore each preceding screen and catalogue query state.
- Auth checks: enter `/cart` and `/checkout` while anonymous, authenticate, and confirm the app returns to the original protected URL. Confirm malformed external `next` values cannot leave the site.
- Regression checks: add/remove cart items, wishlist toggling, product recommendations, checkout-to-LiqPay Sandbox, payment result, and all existing admin URLs.
- Visual checks: inspect the homepage, category catalogue, product page, cart, checkout, account, 404 and mobile navigation at desktop and mobile widths.

## Acceptance criteria

1. Every storefront page, category and active product has a stable URL built from API slugs where applicable.
2. Internal navigation creates browser history entries; Back, Forward, direct loading and reload work for every public route.
3. Catalogue filters/search/sorting are represented by and restored from the URL query string.
4. Anonymous protected-route requests return to the intended internal target after authentication without introducing an open redirect.
5. Unknown/unavailable routes render clear 404 or error states, never the wrong content or a product fallback.
6. Existing cookie sessions, CSRF protections, server validation, LiqPay Sandbox behaviour, catalogue data and admin workflows remain intact.
7. Frontend and server build, lint, tests and key desktop/mobile visual checks pass.
