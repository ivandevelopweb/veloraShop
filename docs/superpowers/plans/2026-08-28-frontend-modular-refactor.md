# Implementation plan: modular frontend refactor

## Goal

Move the monolithic storefront and admin UI into feature-oriented modules without changing product behaviour, routes, backend contracts or visual design. Delete all product data from the browser source.

## 1. Split the API boundary

- Move current API types into `src/shared/api/types.ts`.
- Move CSRF state, request helper and `api` object into `src/shared/api/client.ts`.
- Keep `src/api.ts` as a temporary re-export only if existing imports require compatibility; remove it once all imports use the new boundary.
- Verify frontend and server TypeScript builds before moving UI components.

## 2. Introduce shared presentation primitives

- Extract `Icon`, `Brand`, price/date helpers and safe local-storage helper from `App.tsx`.
- Add focused shared loading, error and empty-state components that preserve existing copy and classes.
- Do not alter CSS selectors or rendered markup more than needed for the component boundary.

## 3. Build storefront model and hooks

- Add `displayProduct` API-to-view-model conversion and category icon metadata; it contains no product records.
- Add cart-line hydration that combines `CartItem` responses with the current API catalogue.
- Extract `useCatalog`, `useCustomerSession` and toast timeout behaviour. Initial catalogue state is empty and errors are explicit.
- Store the selected item as an ID and resolve it from current catalogue data.

## 4. Extract storefront components and pages

- Move header, footer, category rail, product card and order summary into `storefront/components`.
- Move Home, Catalogue, Product, Cart, Checkout, Account and About views into `storefront/pages`.
- Preserve routes, event handlers, texts, stock UI and checkout behaviour.
- Replace the hard-coded `rawProducts`, fallback transformations and image helper with API-only state.

## 5. Reduce the storefront app shell

- Rebuild `src/app/App.tsx` as top-level navigation, page selection, user redirects and composition only.
- Remove the old root `src/App.tsx` once `main.tsx` imports the new entry point.
- Ensure expired sessions, an empty cart and a failed catalogue load retain safe visible states.

## 6. Create admin shell modules

- Move admin route parsing/path generation, slugging and product-form conversion to `admin/model`.
- Extract sidebar, title and common async-state UI to `admin/components`.
- Keep browser-history and route state in the lightweight `admin/AdminApp.tsx` shell.

## 7. Extract admin pages

- Move Dashboard, product list, product editor, order list, order detail and categories to `admin/pages`.
- Keep each page's query/form/mutation state local to that page.
- Preserve API calls, confirmation prompts, pagination, status transitions, image updates and all existing admin copy.

## 8. Verify absence of frontend data and regressions

- Search `src/` for the removed product dataset and Unsplash product IDs.
- Run `npm run build:server`, `npm run build` and `npm run lint`.
- Start the app, inspect public product and cart flows plus desktop admin routing.
- Visually check desktop and mobile storefront. Confirm no external product data is hard-coded in frontend files.

## Safe execution notes

- Do not modify PostgreSQL schema, seed content, backend routes, auth or security middleware.
- Use `apply_patch` for all source/document changes.
- No Git commit is possible because the workspace has no `.git` directory.
