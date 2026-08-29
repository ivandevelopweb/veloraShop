# Velora: LiqPay Sandbox payment design

## Purpose

Replace the mock checkout with a server-signed LiqPay Sandbox checkout. A payment becomes authoritative only after a verified server-to-server callback; the return URL is display-only.

## Scope

- LiqPay Sandbox only, using the `LIQPAY_PUBLIC_KEY`, `LIQPAY_PRIVATE_KEY` and `LIQPAY_SANDBOX` Render environment variables.
- A pending payment order, full-page LiqPay checkout, verified callback, customer result screen and payment visibility in the admin order views.
- Separate payment state from the existing fulfilment state.

Out of scope: real charges, refunds, saved cards, payment instalments and a background reconciliation worker.

## Data model

A new forward-only migration extends `orders` with:

- `payment_status`: `pending`, `paid`, `failed` or `cancelled`, defaulting existing historical orders to `paid` so their already-reserved stock remains consistent;
- `payment_provider`: currently `liqpay`;
- `payment_order_id`: unique merchant order ID supplied to LiqPay;
- `provider_payment_id`: nullable unique LiqPay payment ID from the callback;
- `paid_at` and `payment_updated_at` timestamps.

`orders.status` stays the fulfilment state (`new`, `processing`, `shipped`, `completed`, `cancelled`). A successfully paid order remains `new` until an administrator begins fulfilment.

## Checkout flow

```text
Checkout form
  -> POST /api/payments/liqpay/checkout (session + CSRF)
  -> lock and validate cart/products, create/reuse one pending order
  -> return signed data and signature
  -> browser POST form to LiqPay Checkout
  -> result_url /payment/result?order=<Velora code>
  -> GET /api/payments/liqpay/orders/:code (ownership checked)
```

The checkout route calculates products, delivery and total only from PostgreSQL. It does not trust client prices, totals, provider IDs or card data. It creates order and order item snapshots, but neither decrements stock nor clears the cart.

At most one `pending` payment belongs to a customer. Cart mutations are rejected while it is active, preventing changed-cart and duplicate-order races. The customer can cancel an unfinished attempt through an authenticated CSRF-protected endpoint. This changes only `payment_status`; a later verified provider success still wins.

The response carries only the LiqPay public checkout payload: endpoint `https://www.liqpay.ua/api/3/checkout`, `data` and `signature`. React submits a short-lived hidden form to that endpoint. The private key never reaches the browser, source tree, logs or API responses.

`result_url` is formed from the configured allowed client origin and points to a Netlify SPA route. Its query parameter identifies an order for lookup only. It never asserts payment success.

## Callback flow

```text
LiqPay POST data + signature
  -> verify signature in constant time
  -> base64 decode and schema validate callback
  -> verify public key, action, order_id, UAH amount and final status
  -> transactionally lock order, order items and products
  -> record payment state; for success decrement stock once and clear cart
```

The callback endpoint is public and has no CSRF requirement because it does not use a browser session. It accepts only URL-encoded `data` and `signature`; it never logs either value. LiqPay's executable examples use `base64(SHA1(private_key + data + private_key))`, while its current callback prose specifies SHA3-256. The endpoint compares both documented provider variants in constant time; either still requires the configured private key. It is not an HMAC construction.

Only `success` transitions an order to `paid`. `error` and `failure` become `failed`; `reversed` becomes `cancelled`; non-final states remain `pending`. Repeated callbacks lock the same order and perform no second stock decrement, cart clear or state event.

On a first successful callback the callback transaction locks product rows, verifies availability and stock again, decrements each quantity and sets `paid_at`. It removes only cart items that still exactly match the paid order, and leaves the cart intact if it belongs to a newer pending payment. A stock conflict is retained as an explicit server-side operational error rather than falsely reporting payment success; it is not silently converted into fulfilment. In normal Sandbox testing, each checkout starts from valid stock.

Administrative fulfilment transitions are allowed only after `payment_status = paid`, except that unpaid failed or cancelled orders can be recorded as cancelled without any stock restoration. Cancelling a paid order restores stock once, preserving the current fulfilment semantics.

## Customer and administrator UX

`/payment/result` shows a neutral “confirming payment” state and polls the ownership-protected payment-status endpoint for a bounded interval. It renders a success, declined/cancelled or still-confirming result from the server response, never from the return URL. It includes a safe return to the account/cart and a retry path after a confirmed non-success status.

The checkout replaces the mock text with LiqPay Sandbox language. The Netlify CSP permits form submission to `https://www.liqpay.ua` and no other payment origin.

Admin order list and details display payment status, provider and provider payment ID independently from delivery status. Dashboard revenue includes only `paid` orders.

## API boundary

```text
POST /api/payments/liqpay/checkout              session + CSRF
POST /api/payments/liqpay/orders/:code/cancel   session + CSRF + ownership
GET  /api/payments/liqpay/orders/:code          session + ownership
POST /api/payments/liqpay/callback              public, signed provider callback
```

The existing `POST /api/orders` mock-creation path is removed so no browser route can bypass verified payment. `GET /api/orders` gains payment state for the customer account.

## Security constraints

- Config validation requires the complete LiqPay key pair together and permits Sandbox only when explicitly configured.
- SQL remains parameterized and all route input is Zod-validated.
- The callback verifies signature, configured public key, payment order ID, integer UAH amount and permitted action/status before writing state.
- Callback errors are safe generic responses; sensitive callback bodies, signatures and keys are never logged.
- Existing Helmet, exact credentialed CORS allowlist, HttpOnly sessions, ownership checks, CSRF and auth rate limits remain intact.

## Verification

- Build: `npm run build`, `npm run build:server`, `npm run lint`.
- Browser: production health check; successful, declined and cancelled LiqPay Sandbox flows; desktop and mobile checkout/result screens.
- Database state: pending does not deduct stock or alter cart; verified success deducts stock once and removes only matching paid cart items; failed/cancelled does neither; duplicate callback is idempotent.
- Access control: unauthenticated checkout/status/cancel requests fail; one customer cannot inspect or cancel another customer's order; an invalid callback signature cannot mutate orders.
