# Durable order workflow

## Status and activation boundary

The order workflow is implemented and tested against a disposable PostgreSQL database using Prisma. The current Neon target has the workflow tables from the initial Prisma migration, but checkout remains disabled and the workflow is **not production-ready**. There is no login system and inventory quantities have not been set.

Default configuration rejects new checkout requests. `/admin` and `/admin/orders` require a verified identity and a database-backed administrator role; there is no public order dashboard or development identity bypass. Existing storefront purchase buttons remain disabled. The imported gallery/variant catalog has not been mapped into the legacy database product model.

Neon was inspected read-only for constraint definitions/names. No shared database writes, stock assignments, orders, payment records, schema changes, resets or deletes were performed. Synthetic fixtures exist only inside isolated test clusters.

## Confirmation invariant

`Order Confirmed` is displayed only for a server response built after:

1. Strict Zod validation of customer details, Egyptian shipping address, supported city/payment method, item identities, quantities and expected whole-EGP prices/total.
2. Database lookup of a previous request under the same verified customer and UUID idempotency key.
3. A successful Prisma transaction with `synchronous_commit=on`. A transaction-scoped advisory lock serializes the customer/key across processes; deterministic product row locks protect current prices/availability. Conditional stock decrements, customer/address snapshots, order totals, order items, order event and request mapping are committed together.
4. A separate post-commit lookup of the request and the complete order using `getAdminOrder`, with exactly the projection used by admin listing/detail. Ownership, required snapshots, item arithmetic and totals are checked before confirmation. Reconstructing the stored submission must also reproduce its persisted request fingerprint, so coherently changed customer/item/price snapshots do not silently pass verification.

Generated references, a button click, frontend state or an incomplete database row cannot produce a confirmed result. Cancelled existing orders remain cancelled on retries and never create replacement orders.

The legacy schema stores whole-EGP integers. No imported fractional prices are silently rounded. `stock_quantity=NULL` means unconfigured and cannot be sold. Existing product options/variants are rejected until their price/inventory mapping is implemented; they are not treated as simple base-price products.

## Failure and recovery

Unknown transaction errors and commit-time/network timeouts trigger reconciliation by the same customer/key. If a saved order is retrievable and valid, return that existing order. If the outcome cannot be established, return HTTP 202 with `state: pending_verification`, `confirmed: false` and `retryWithSameKey: true`. Do not automatically create a second order or invent a definitive failure.

A repeated POST with the same validated payload/key returns the original order. A different payload using that key returns 409 `IDEMPOTENCY_CONFLICT`. The existing `(user_id, request_key)` PostgreSQL primary key remains the final uniqueness constraint. The lock and in-transaction lookup cover retries while an earlier commit is still in flight. No TTL deletes these mappings.

GET `/api/orders/requests/:key` checks status without creating anything. Recovery remains available to authenticated customers while new checkout is disabled. A missing/unavailable result stays pending rather than asserting that an ambiguous request failed. Do not replace its key automatically.

The browser retains only the retry key in sessionStorage and a URL fragment, never customer details, carts, order records or payment proof. Fragments are not sent in HTTP request URLs or Referer headers. PostgreSQL is authoritative. Refresh checks that key against the server, even if sessionStorage is blocked; response interruption leaves an uncertainty message. Starting a new order requires an explicit action after a server-verified terminal result. Hidden controls have explicit CSS and a JavaScript state guard. Recovery requires the same verified account and original key; losing both browser history/key and session storage requires store support or a future authenticated order-history interface, not a blind replacement submission.

Logs contain fixed event/stage codes only, without customer fields, credentials, request bodies, raw provider errors or idempotency keys. Error responses are sanitized and no-store.

## Admin and authentication contract

`src/app.js` accepts an internal `orders.authenticate(req)` adapter. It must verify a real session/token and return `{ userId }`; it must never trust a request-supplied user ID or role. No default adapter exists. Each request rechecks the active user and current admin roles in PostgreSQL. Customer request lookups are scoped by that verified user. Admin list/detail routes require an administrator before querying order records.

`/admin` and `/admin/orders` show persistent references, customer names/phones/emails, delivery details, item names/quantities/prices, totals, payment method/status and fulfillment status. Listing uses 50-row cursor pagination; all pages and direct details use the shared database repository. EJS escapes stored values, including legacy address snapshots. No mock-order source is installed.

POST `/api/orders` requires JSON, a UUID `Idempotency-Key`, verified identity and an exact configured Origin. This gives the browser request boundary a same-origin check in addition to strict validation. Authentication/session issuance and its CSRF/session protections must be integrated and tested before activation; this task does not introduce an insecure temporary login.

## Payment boundary

New orders start `UNPAID`. Cash-on-delivery is the only option shown in the current checkout form. Online submissions are rejected unless a server-injected provider adapter exists. No real provider is currently configured and no real payment was verified.

The internal `paymentProvider.verifyWebhook(rawBody, headers)` adapter must verify the provider signature, timestamp/replay window, final settlement status, currency and authoritative amount/reference. The route preserves raw bytes before generic JSON parsing. Browser redirects and client `paid` fields are never payment proof. A normalized verified settlement is validated again, then an order lock, unique provider/event and provider/payment-reference receipts and paid-state update are committed atomically. Wrong amount, currency, order method or conflicting settlement cannot mark the order paid. Duplicate delivery of a valid receipt is idempotent. Uncertain settlement failures return retryable 503 so the trusted provider can reconcile/retry. Webhooks for existing orders remain available during checkout maintenance.

The proposed SQL preserves legacy cash payment checks and permits a verified provider reference as the actor for online settlement. Provider integration, payment initiation and live provider sandbox testing remain required before enabling online payments.

## Proposed database change

The current Neon target uses the order tables/constraints from `20261102000000_initial_schema`; catalog persistence is added by `20261102170000_catalog_media_persistence`. `prisma/proposed/order-workflow.sql` and its rollback are compatibility material for the previously inspected legacy database and must not be applied to this target. The checkout code stays fail-closed until identity, stock, shipping and trusted payment requirements are met.

The schema change does not overwrite legacy records or assign invented quantities. It adds a nonnegative-stock check, preserves existing method values while allowing ONLINE, and retains legacy paid-by/amount/change checks while allowing the server-verified provider reference. Lock acquisition is bounded by a five-second timeout; individual statements have a 30-second timeout. CHECK validation can scan existing orders while holding locks. Review actual table sizes, migration privileges and the deployment window before application; do not mix old and new schema expectations on active checkout workers.

The current Neon target is Prisma-managed with two recorded migrations. Do not run the compatibility patch against this target. Do not run `db push`, reset or a generated initial schema against it. No migrations run at application startup.

The [db-migration skill](C:/Users/hp/.agents/skills/db-migration/SKILL.md) explicitly says: “Stop for explicit authorization before executing against shared/staging/production databases or running destructive operations.” Accordingly, shared-database application was not attempted. This is an explicit skill gate, separate from the implementation decision to keep checkout disabled without authentication and stock.

The rollback acquires exclusive locks and refuses to run if stock is configured, online orders exist, provider references exist or receipt rows exist. After use, a forward fix/backup-based recovery is required; dropping used workflow data is not a data-preserving rollback. Local tests verified apply → rollback → reapply, preservation of a pre-existing synthetic product, and refusal after workflow data exists.

## Verification

The real PostgreSQL integration suite covers successful creation/admin retrieval; backend insert failure with full rollback; concurrent same-key requests; changed-payload conflict; invalid identity/customer/shipping/payment/quantity/price; insufficient and unconfigured stock; concurrent oversell protection; unsupported product options; timeout after successful commit; missing/incomplete/unavailable post-commit verification; reconciliation failure before writes; ownership/admin/origin restrictions; pending/verified payment and duplicate webhook delivery; disabled checkout; cancelled-order retries; and guarded migration rollback.

Chrome tests use a loopback-only test server and synthetic authenticated principal, never a production identity bypass. They cover desktop confirmation plus admin visibility, mobile pending verification and reload recovery, and an actually aborted browser response after the server has committed. Screenshots are saved under ignored `test-results/checkout-*.png` and `orders-admin-*.png`.

The development-only `embedded-postgres` dependency runs an owned temporary local cluster with a generated password and does not load dotenv or use Neon credentials. Temporary cluster files remain in the OS temp directory; tests shut down their processes. Schema fixtures are limited to affected legacy tables and explicitly reproduce relevant CHECK constraints; they are not a full migration baseline.

Final command totals and any regression reruns are recorded in [progress](progress.md). There is no Git baseline in this workspace, so changed files are reviewed directly. No commit or deployment was performed.

## Before production activation

1. Implement and wire verified customer/admin authentication and authorize real admin accounts.
2. Reconcile Knex/Prisma migration ownership; authorize/apply the reviewed schema change with a backup and deployment plan.
3. Map real store products/options/variants into PostgreSQL, enter verified stock quantities and configure approved shipping fees and Origin. Keep checkout disabled until those checks pass.
4. Run staging tests against an isolated Neon branch, including deployed session/CSRF behavior, concurrent requests and post-commit recovery.
5. If online payment is wanted, choose and implement the trusted provider integration and verify its sandbox webhook/amount/replay behavior before enabling it.

Reference: [Prisma 7 transaction documentation](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions).

## Product selections and delivery setup

Cart and order lines can persist a product variant UUID. A variant must belong to its product, be available and have sufficient known inventory. The server uses database prices and discounts, stores the selection snapshot with the order, and decrements variant inventory in the same transaction. The idempotency fingerprint includes variant IDs. Variants of the same product are separate cart lines. Order cancellation restores their inventory. The NULLS NOT DISTINCT cart-line unique index is maintained in the additive SQL migration.

Delivery areas and prices are edited in /admin/delivery and reloaded on submission. No configured areas means checkout remains unavailable with an explicit setup message; no default live shipping prices are invented. Cash on delivery records UNPAID. Online payment stays unavailable without a trusted verified provider adapter.
