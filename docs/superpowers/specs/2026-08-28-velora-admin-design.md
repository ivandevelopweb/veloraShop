# Velora: full-stack storefront and custom admin design

## Purpose

Turn Velora into a portfolio-ready simulation of a freelance commercial build for a Ukrainian DTC lifestyle store. The application must demonstrate a premium public storefront and a genuinely working owner administration area without real payment processing.

## Goals

- Keep the existing Ukrainian-language storefront and 50-item catalogue.
- Add a secure, role-based custom admin area within the same React application.
- Let administrators manage categories, products, images, stock and order status through the UI.
- Persist all business data in PostgreSQL and expose it through a secure Node.js API.
- Upload product images to Cloudinary, storing only asset metadata in PostgreSQL.
- Keep payments in a `payment_pending` mock state and never charge a customer.

## Non-goals

- Marketplace sellers, supplier workflows, returns, promotions and multi-admin role tiers.
- Real payment provider integration.
- A public API or a separate admin subdomain.

## Architecture

The React application has two route groups:

```text
Storefront: /, /catalog, /product/:slug, /cart, /checkout, /account
Admin:      /admin, /admin/products, /admin/products/new,
            /admin/products/:id/edit, /admin/orders, /admin/categories
```

The admin area uses a dedicated operational layout with a sidebar, header, tables, filters and forms. The storefront retains the existing premium visual treatment.

Node.js exposes public and administrator APIs separately:

```text
/api/products          public active catalogue
/api/admin/...         administrator-only management API
```

React route guards provide navigation UX only. The Node.js API enforces access for every administrator request:

```text
opaque HttpOnly session -> requireAuth -> requireAdmin -> Zod validation -> PostgreSQL
```

Unauthenticated visitors are sent to `/account`; authenticated customers are sent away from `/admin`; administrator API calls from customers receive `403 Forbidden`.

## Roles and initial administrator

`users.role` has the values `customer` and `admin`.

- Public registration always creates `customer` accounts.
- A seed command creates the first administrator from `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`.
- The seed command is idempotent and never prints credentials.

## PostgreSQL data model

Use versioned `node-pg-migrate` migrations. The migration ledger is the source of truth for schema changes across development, demonstration and production environments.

### users

Existing user fields plus `role`, defaulting to `customer`.

### categories

`id`, `name`, `slug`, `description`, `sort_order`, `is_active`, timestamps.

### products

`id`, `category_id`, `name`, `slug`, `description`, `price_uah`, `old_price_uah`, `stock_quantity`, `status`, timestamps.

`status` is `draft`, `active` or `archived`.

- The public catalogue exposes only active products with positive availability rules.
- Archived products are never physically deleted; they remain available to historical order items.
- A draft is visible only to administrators.

### product_images

`id`, `product_id`, `cloudinary_public_id`, `url`, `alt_text`, `sort_order`, `created_at`.

### orders and order_items

Preserve the existing delivery/contact snapshot in orders. Keep product name and price snapshots in `order_items` so a later catalogue change cannot alter a historical order.

Order status is `new`, `processing`, `shipped`, `completed` or `cancelled`.

Allowed transitions:

```text
new -> processing -> shipped -> completed
new -> cancelled
processing -> cancelled
```

Creating an order reduces stock inside a database transaction. If stock is insufficient, the order is rejected without changing any data.

### admin_audit_log

`admin_id`, `action`, `entity_type`, `entity_id`, `metadata`, `created_at`.

Record catalogue, category and order-status actions. Do not store passwords, session tokens or raw personal information in metadata.

## Media upload

Administrators upload images through `POST /api/admin/media` using `multipart/form-data`.

The backend must:

1. require an administrator session and valid CSRF token;
2. permit only JPEG, PNG and WebP after checking MIME type;
3. enforce a server-side size limit no larger than Cloudinary free-plan limits;
4. upload the validated file to Cloudinary using server-side credentials from `.env`;
5. return safe asset metadata for preview and later product attachment.

Cloudinary secrets never reach the browser. PostgreSQL stores only the URL and Cloudinary public ID. If a product write fails after a successful upload, the backend removes the orphaned Cloudinary asset.

## API

All administrator endpoints require `requireAuth`, `requireAdmin` and CSRF validation for mutations.

### Dashboard

```text
GET /api/admin/dashboard
```

Returns seven- and thirty-day revenue, counts of new orders, recent orders, and low-stock products from PostgreSQL.

### Products

```text
GET    /api/admin/products?page=1&perPage=20&search=&status=&categoryId=
POST   /api/admin/products
GET    /api/admin/products/:id
PATCH  /api/admin/products/:id
POST   /api/admin/products/:id/archive
POST   /api/admin/media
DELETE /api/admin/media/:id
```

Product listing uses validated server-side filters and pagination. Product create/update validates every mutable field with Zod. Archive is explicit and does not delete records.

### Categories

```text
GET    /api/admin/categories
POST   /api/admin/categories
PATCH  /api/admin/categories/:id
POST   /api/admin/categories/:id/deactivate
```

A category with products cannot be physically deleted. It may be deactivated or its products moved first.

### Orders

```text
GET   /api/admin/orders?page=1&status=&search=&from=&to=
GET   /api/admin/orders/:id
PATCH /api/admin/orders/:id/status
```

Status changes are validated against the allowed transition map and appended to `admin_audit_log`.

## Admin UI

### Dashboard

Show order count, revenue over seven and thirty days, recent orders, low-stock products and shortcuts to create a product or manage orders.

### Products

Show a table with thumbnail, name, category, price, stock, status and update date. Support server-side search, filtering and pagination. Product forms provide details, pricing/stock, publish state, category and a drag-and-drop media area with previews, sorting and removal.

### Categories

Support creation, edit, deactivation and display order.

### Orders

Show filters by status, search and date. The order detail includes contact/delivery snapshot, items, total and status history. Status controls expose only valid next transitions.

All admin views define loading, empty, permission-denied and error states. Destructive or irreversible user-facing actions require confirmation.

## Security and error handling

- Do not rely on a hidden navigation item or client-side route guard for authorization.
- Use the existing opaque PostgreSQL-backed HttpOnly session, explicit CORS allowlist, Helmet, CSRF validation and server-side authentication throttling.
- Use parameterized SQL and Zod validation for all input, including filters and pagination.
- Validate uploads before forwarding to Cloudinary.
- Return safe, Ukrainian-language errors; do not log or return passwords, session tokens, Cloudinary secrets or raw database errors.
- Enforce data ownership for customer cart/order routes and administrator role for management routes.

## Environment configuration

Add non-secret placeholders to `.env.example` for:

```text
ADMIN_EMAIL
ADMIN_PASSWORD
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
```

Actual values belong only in the ignored `.env` file.

## Verification

- API integration checks: customer versus admin permissions, product/category CRUD, archive, status transitions, stock transaction and media validation.
- Browser flow: seed admin, login, upload image, create and publish product, find it on storefront, purchase it as customer, change its order status as admin.
- Run `npm run build`, `npm run build:server`, `npm run lint` and dependency audit.
- Visually inspect desktop and mobile storefront plus desktop admin workflows.
