# Velora: modular frontend refactor design

## Purpose

Replace the monolithic storefront and admin React modules with small, focused modules while preserving the current UI, routes, Ukrainian copy, server contracts and security behaviour. Remove all product data from the browser source: PostgreSQL and the existing public API become the only source of catalogue data.

## Constraints

- Preserve the public storefront and admin UX, visual styling and current URLs.
- Keep the current React, TypeScript and CSS stack. Do not add a router, state-management library or a new runtime dependency.
- Preserve cookie-based authentication, CSRF handling, API validation and all backend routes.
- Keep `server/src/catalog.ts` as seed-only server data. No product names, prices, image IDs, stock figures or product fallbacks may remain under `src/`.
- A failed catalogue request must render an explicit loading, empty or error state. It must never render a hard-coded local catalogue.

## Target module boundaries

```text
src/
  app/
    App.tsx                         # page composition and top-level navigation only
  shared/
    api/
      client.ts                     # api client and CSRF request implementation
      types.ts                      # API response and request types
    lib/
      format.ts                     # price/date formatting
      storage.ts                    # safe wishlist storage helper
    ui/
      Icon.tsx
      Brand.tsx
      AsyncState.tsx                # shared loading, empty and error primitives
  storefront/
    components/
      Header.tsx
      Footer.tsx
      ProductCard.tsx
      CategoryRail.tsx
      OrderSummary.tsx
    hooks/
      useCatalog.ts
      useCustomerSession.ts
      useToast.ts
    model/
      displayProduct.ts             # API product -> display model, category icon mapping
      cart.ts                       # joins cart API lines to current catalogue products
    pages/
      HomePage.tsx
      CatalogPage.tsx
      ProductPage.tsx
      CartPage.tsx
      CheckoutPage.tsx
      AccountPage.tsx
      AboutPage.tsx
  admin/
    AdminApp.tsx                    # admin layout and route selection only
    components/
      AdminSidebar.tsx
      AdminTitle.tsx
      AdminAsyncState.tsx
    model/
      routes.ts
      productForm.ts
      format.ts
    pages/
      DashboardPage.tsx
      ProductsPage.tsx
      ProductEditorPage.tsx
      OrdersPage.tsx
      OrderDetailPage.tsx
      CategoriesPage.tsx
```

CSS remains in the current storefront and admin stylesheets for this refactor. The task changes module ownership, not the visual language. A later style-module migration is out of scope.

## Storefront state and data flow

`useCatalog` owns fetching `/api/products` and `/api/categories`. Its initial products array is empty. It exposes loading and error state plus a `refreshCatalog` action. It converts only API responses into display products; category icon mapping is presentation metadata, not catalogue content.

`useCustomerSession` owns CSRF bootstrap, the current user, raw cart lines and order history. It does not duplicate product objects in state. `cart.ts` derives display-ready cart lines by joining cart lines with the current API catalogue. Consequently session restoration can finish before catalogue loading without creating stale fallback products.

The selected product is stored as a product identifier and resolved from the current catalogue at render time. When an order updates stock and calls `refreshCatalog`, product, cart and availability widgets use the refreshed response. If an item becomes unavailable, the appropriate existing empty/error UX is shown rather than stale data.

`app/App.tsx` owns only public page selection, top-level redirects, wishlist state, toast coordination and composition of pages with focused callbacks. Page components receive only the data and actions they use. Shared visual components remain presentational and reusable.

## Admin state and data flow

`admin/AdminApp.tsx` owns the current admin route, browser history integration and the shared admin shell. Route parsing and URL construction live in `admin/model/routes.ts`.

Each admin page owns its own API query, form state and page-specific actions. Dashboard, product listing, editor, orders, order detail and categories move to independent `admin/pages` modules. Repeated framing and UI states move to `admin/components`; product-form conversion and slug helpers move to `admin/model/productForm.ts`.

The admin API client and its types are shared with the storefront. This refactor does not change admin permissions, mutation endpoints, audit logging, image handling or order-status rules.

## Error handling

- Catalogue, session and admin pages retain explicit loading, empty and Ukrainian-language error states.
- An unavailable public catalogue produces an error state, never a local product substitute.
- API errors remain instances of `ApiClientError`; authentication expiry keeps the existing sign-in redirect behaviour.
- Cart mutations and checkout continue to use the API as the authority for availability and stock. The UI disables impossible actions for convenience but never replaces server validation.

## Implementation boundaries

The refactor is behaviour-preserving. It does not change database migrations, seed product data, backend APIs, page copy, design tokens, payment behaviour, authentication cookies or routes. The only intentional runtime data change is removal of frontend hard-coded products and their replacement with explicit catalogue loading states.

## Verification

- Confirm no product dataset or product-image ID remains in `src/`.
- Build frontend and server and run the linter.
- Verify public catalogue, product view, login, cart, checkout and post-order catalogue refresh against the API.
- Verify admin dashboard, product list/editor, categories and order detail routes.
- Visually inspect desktop and mobile storefront plus desktop admin after the module moves.

## Acceptance criteria

1. `App.tsx` and `AdminApp.tsx` are lightweight composition modules; pages and reusable components live in the stated folders.
2. The browser source contains no 50-product dataset, product prices, stock values or external product image IDs.
3. The public catalogue renders only server data and handles unavailable API data explicitly.
4. Existing public and admin user flows remain operational and visually unchanged.
5. Frontend build, server build and lint complete successfully.
