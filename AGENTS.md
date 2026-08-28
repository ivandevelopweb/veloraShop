# Velora storefront — project instructions

## Product scope

- This is a premium Ukrainian storefront prototype for **Velora**. Prices are displayed in Ukrainian hryvnias.
- Authentication, carts, profiles and orders now use the Node.js + PostgreSQL backend. Payment remains a mock confirmation and must never charge a customer.
- Keep the catalogue at 50 varied test products, with a product card, product view, wishlist, cart, search, category filters, price filter and sorting.

## Design direction

- Use a quiet, premium palette: warm white, ivory and subtle beige, with charcoal text and restrained muted-gold accents.
- Preserve generous spacing, clear hierarchy and responsive behaviour. Do not imitate Rozetka branding or its dense visual style.
- Use `src/assets/velora-logo.png` as the source brand asset; do not replace it with another brand mark.

## Engineering

- Keep the implementation in TypeScript + React with CSS. The production backend stack is Node.js + PostgreSQL.
- Use a PostgreSQL-backed opaque server session stored in an `HttpOnly` cookie. Never put session tokens, secrets or passwords in the frontend, local storage, source control or logs.
- Validate all API input with schemas, use parameterized SQL only, enforce ownership on every user resource, and protect cookie-authenticated mutations with CSRF validation.
- Use `helmet`, explicit CORS allowlists and authentication rate limits. Do not weaken these controls to simplify local development.
- Before handoff, run `npm run build` and visually check the key desktop and mobile flows.
