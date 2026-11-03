# Database connection and future design

The Neon database is connected through Prisma 7.10.1. It now has 23 application tables, two completed Prisma migrations, and no incomplete migration. The additive catalog/media migration and validated catalog import ran without resetting or deleting existing rows. See [Neon verification and Northflank deployment](neon-prisma.md).

The opt-in, idempotent `db:catalog:import` script copied the catalog into Neon. Product images are represented only by Cloudinary URLs and provider asset identifiers; no image bytes are stored in PostgreSQL. Configured runtimes read catalog products, variants, memberships and images from the database; local/test mode without `DATABASE_URL` uses the snapshot in `src/config/catalog.json`.

The following broader entities remain a future design proposal, requiring reconciliation and reviewed migrations before implementation.

## Proposed entities and relationships

The current Neon target has the order tables and constraints from the initial Prisma schema migration. `prisma/proposed/order-workflow.sql` is retained only as a compatibility patch for a different legacy Knex-managed database; do not apply it to this Neon target. Checkout remains disabled until verified authentication, real stock, shipping rates and origin are configured. See [order workflow](order-workflow.md).

| Entity | Key relationships and constraints |
| --- | --- |
| roles | Unique role name; permission definition |
| users | Unique normalized email, argon2id hash, role FK; customer identity lives here |
| categories | Self-referencing parent FK, unique slug, bilingual names, description, image, active flag, display order; prohibit cycles |
| products | Category FK, unique slug and SKU, bilingual names/descriptions, decimal base/compare-at prices, publication status, featured, timestamps |
| product_variants | Product FK, unique purchasable SKU, attributes, optional decimal price override |
| product_images | Product FK, optional variant association, storage key, URL, alt text and order; one main image per product |
| inventory | Unique purchasable variant FK, quantity, reserved, threshold, tracking flag |
| inventory_movements | Inventory FK, signed change, reason, actor and timestamp; immutable audit history |
| carts | User FK or opaque guest session identity, expiry |
| cart_items | Cart and variant FKs; unique cart/variant pair, positive quantity |
| addresses | User FK with ownership checks; address fields |
| orders | Optional customer FK, contact/address snapshot, independent fulfillment and payment status, decimal totals, unique idempotency key |
| order_items | Order FK, optional source variant FK, immutable name/SKU/quantity/unit-price/discount snapshots |
| promotions | Percentage/fixed rule, validity interval, active flag, optional category scope |
| promotion_products | Promotion and product FKs; unique pair |
| coupons | Unique normalized code, promotion FK, limits and expiry |
| banners | Image storage key/URL, bilingual text, safe internal link, display order, enabled flag |
| payments | Order FK, method, status, decimal amount, optional external reference; no gateway credentials |
| settings | Unique key, validated configuration value; no secrets |
| audit_logs | Actor FK, entity/action identifiers, sanitized change metadata and timestamp |

The catalog migration adds stable source IDs, many-to-many product/collection membership, product variants with exact EGP decimal prices, and a Cloudinary-only product image table. Existing nullable inventory is preserved as `NULL`; public source availability is not stock and is not imported as a quantity. Import commands are dry-run by default. To deliberately write the validated catalog after migration, run `npm run db:catalog:import -- --execute` with `CONFIRM_CATALOG_IMPORT=true` in the process environment. Existing rows with no source ID stop the importer instead of being overwritten. The importer is resumable and performs no deletes.

Subcategories use the categories parent relationship. Customers use users and optional guest order snapshots. These do not require separate duplicate identity tables. PostgreSQL session storage is added in Phase 3.

## Money and stock invariants

Use PostgreSQL NUMERIC with explicit scale and Prisma Decimal, with a defined rounding policy. Never use JavaScript floating-point totals as authoritative. Store order prices and shipping snapshots independently of later catalog changes. Checkout recalculates every amount server-side.

All purchasable items, including products without selectable options, have a default variant; stock therefore has one unambiguous owner. Require quantity >= 0, reserved >= 0 and reserved <= quantity. Availability is quantity minus reserved, never a manually assigned label. Use atomic conditional updates and transactions for reservation, order creation, cancellation and stock restoration. Record movements and audit events in the same transaction. Enforce idempotency with a unique key.

## Indexes and lifecycle

Index active categories by parent/order, products by category/status/date, variants by product, orders by customer/date and status/date, movements by inventory/date, and promotions by validity. Unique indexes cover email, SKU, slugs, coupon code and idempotency keys. Add constraints for nonnegative money, positive item quantities, valid intervals and percentage limits. Decide global product/variant SKU namespace enforcement before migrating. Preserve order snapshots; archive referenced products rather than cascading order history deletion. Database integration tests must verify constraints, migrations and transaction rollback in an isolated test database.
