# Velora inventory reservations and payment reconciliation

## Scope and outcome

This design remediates H-01, H-02, M-01, and M-02 from SECURITY_AUDIT.md. LiqPay remains sandbox-only. The system must never accept a customer-controlled price, ownership, payment state, or inventory result.

The primary invariant is:

    available inventory = products.stock - products.reserved_stock

where stock is physical on-hand inventory and reserved_stock is inventory held by active payment reservations. Both values are non-negative integers and reserved_stock can never exceed stock.

## Data model

Migration 005 adds:

- products.reserved_stock INTEGER NOT NULL DEFAULT 0;
- products check constraint enforcing reserved_stock >= 0 and reserved_stock <= stock;
- orders.reservation_expires_at and orders.payment_reconciliation_reason;
- payment_status value reconciliation_required in addition to pending, paid, failed, cancelled, and expired;
- inventory_reservations with one row per order item:
  - order_id and product_id as the composite primary key;
  - quantity > 0;
  - state active, consumed, or released;
  - expires_at, consumed_at, released_at, release_reason;
  - foreign key to orders and restrictive foreign key to products;
  - active-reservation expiry index for the reconciliation worker.

order_items remains the immutable order snapshot. Migration 005 adds product_slug so product identity, name, slug, unit price, and quantity are retained on the order item. It is never joined to products to determine a paid order’s items.

The migration treats only pre-existing pending orders with no reservation as legacy sandbox payment attempts. It marks them expired with a clear reconciliation reason. Paid rows are untouched. The migration is written to be idempotent.

## State machine

Payment/order states:

    pending -> paid
    pending -> failed
    pending -> cancelled
    pending -> expired
    pending -> reconciliation_required
    failed -> reconciliation_required (only for a later valid paid provider event)
    cancelled -> reconciliation_required (only for a later valid paid provider event)
    expired -> reconciliation_required

Paid and reconciliation_required are terminal for automated payment processing. Failed, cancelled, and expired are terminal unless a later cryptographically valid authoritative paid provider event proves that the released reservation must be reconciled. That exceptional event moves the order to reconciliation_required rather than to paid. A separate manual reconciliation/refund workflow is required for reconciliation_required and is intentionally not hidden as a normal paid transition.

Reservation states:

    active -> consumed
    active -> released

Neither consumed nor released can transition again. Every consume/release query uses WHERE state = 'active', so a replayed callback, duplicate worker, or concurrent cancellation cannot decrement or restore stock twice.

## Checkout and inventory flow

Checkout runs in one PostgreSQL transaction:

1. lock the authenticated user;
2. reject an existing pending payment after checking its reservation state;
3. lock cart rows;
4. lock all requested product rows in increasing product ID order;
5. require active/available catalog state and stock - reserved_stock >= quantity;
6. insert order, immutable order_items, and active inventory_reservations;
7. increment products.reserved_stock;
8. commit;
9. only after commit, create the sandbox LiqPay checkout data.

The signed checkout contains an expired_date equal to the reservation’s payment deadline. The client never receives checkout data before the reservation transaction commits.

For a valid paid callback, the API locks the user, order, then products in increasing product ID order. It reads the reservation rows rather than performing an inner join against catalog. It conditionally consumes active reservations, atomically decrements both stock and reserved_stock, and finally records paid. A replay sees paid/consumed state and is idempotent.

For valid terminal failed/cancelled provider events, the API conditionally releases active reservations, decrements reserved_stock only, then records the matching terminal payment state.

## Expiry and reconciliation

Local expiry is not treated as proof that a provider payment did not occur.

An expiry worker finds pending orders whose reservation_expires_at has passed. For each order it obtains the authoritative LiqPay payment status using the fixed LiqPay API endpoint, never an attacker-supplied URL:

- paid/success: process with the same locked paid-finalization path;
- terminal failed/cancelled: release active reservations and set failed/cancelled or expired;
- non-final, unknown, or temporary network failure: retain the active reservation and retry while inside a bounded grace period;
- grace exhausted without a safe terminal result: preserve the provider event/status data, release nothing silently, and mark reconciliation_required.

If a cryptographically valid paid callback arrives after a reservation was already released/expired, the service records the provider payment ID/event and moves the order to reconciliation_required. It never silently marks it paid, never re-reserves stock implicitly, and never discards the provider event.

Expiry worker operations are idempotent through order row locks plus conditional reservation state changes. The worker does not hold PostgreSQL locks across the network request to LiqPay.

## Catalog lifecycle

The normal admin DELETE endpoint becomes a soft archive operation. It sets the catalog item unavailable/archived and retains its row and images; it performs no physical delete.

Archive/inactive status removes the item immediately from new cart and checkout availability. It does not invalidate active reservations. A user with an existing reservation can complete the payment using the immutable order snapshot.

Admin may change physical stock only while the proposed value is at least reserved_stock. Product content and price changes do not mutate order snapshots. A normal archive is allowed with active reservations. An emergency product recall that cancels active paid/pending work is deliberately a separate explicit reconciliation/refund workflow, not a side effect of archive.

Physical deletion is not exposed by normal admin routes. The restrictive inventory_reservations foreign key also prevents accidental catalog deletion while reservation history exists; a maintenance workflow must prove the absence of active reservations and satisfy historic-order retention requirements.

## Global lock order

All paths use this order, omitting resources they do not need:

    1. users row
    2. orders row
    3. cart rows
    4. products rows in ascending products.id
    5. inventory_reservations rows

Admin catalog mutation locks only the product row before examining reservations, so it never acquires order after product. The expiry worker gets provider status before its database transaction, then locks order and products; it does not lock a user. No path may acquire product and then order.

## Login rate limiting

Login attempts reserve both IP and account quota before bcrypt through one PostgreSQL transaction using conditional UPSERT rows. A failed reservation rolls back every key reservation and returns 429. Failed login no longer increments later, closing the parallel check-then-increment window. Successful login clears the account key according to the existing UX policy.

## Test architecture

The test runner starts an ephemeral PostgreSQL Docker container with random credentials, applies real migrations, runs Node/TypeScript HTTP integration tests against Express, and removes the container afterwards. It does not use database mocks.

Tests cover authorization/CSRF/mass assignment/input manipulation as well as:

- two users contending for one stock unit;
- checkout racing stock update and archive;
- callback racing expiry, cancellation, and another callback worker;
- repeated consume/release;
- late paid callback after expiry;
- provider status temporary failure and reconciliation transition;
- migration treatment of legacy pending orders;
- database invariant enforcement.

## Dependency hygiene

The lockfile will be updated without a forced major upgrade. npm audit --omit=dev must be clean for the previously reported qs advisory before handoff.
