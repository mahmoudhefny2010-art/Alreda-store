# Routes

| Method | Path | Response |
| --- | --- | --- |
| GET / HEAD | `/` | 200 shopping UI with the 18 reference-approved collections in two groups |
| GET / HEAD | `/?collection=:slug` | 302 redirect to the dedicated collection page; invalid or repeated selection returns 400 |
| GET / HEAD | `/collections/:slug` | 200 original collection products; unknown collection returns 404 |
| GET / HEAD | `/collections/:slug?q=...&sort=...&page=...` | Search/sort with 24 products per page; invalid/repeated filters return 400, out-of-range page returns 404 |
| GET / HEAD | `/products` | All discovered products, including those without source collection memberships |
| GET / HEAD | `/products?q=...&sort=...&page=...` | Validated full-catalog search, sort and pagination |
| GET / HEAD | `/products/:slug` | Product preview with local gallery, source options, description and related products; unknown product returns 404 |
| GET / HEAD | `/products/:slug?collection=:slug&variant=:id` | Validated collection context and product-owned variant selection; invalid/repeated query or foreign selection returns 400 |
| GET / HEAD | `/health/live` | 200 process liveness; no-store |
| GET / HEAD | `/health/ready` | 200 ready or 503 database unavailable; no-store; sanitized response |
| GET / HEAD | `/admin`, `/admin/orders` | PostgreSQL order dashboard; verified admin required (401/403 otherwise); no-store |
| GET / HEAD | `/admin/orders/:id` | Protected persistent order details; UUID validation; 404 unknown order |
| GET / HEAD | `/admin/orders?cursor=:uuid` | Protected 50-order cursor pagination |
| GET / HEAD | `/checkout` | Authenticated database-product checkout; 503 while disabled |
| POST | `/api/orders` | JSON + Origin + Idempotency-Key + verified account; 200 verified record, 202 pending, 400/409 validation/conflict |
| GET / HEAD | `/api/orders/requests/:key` | Customer-owned reconciliation; no creation; available during checkout maintenance |
| POST | `/api/payments/webhook` | Raw-body trusted provider verification; disabled without provider adapter; retryable failures |
| GET / HEAD | `/assets/css/main.css` | Custom stylesheet |
| GET / HEAD | `/assets/css/base/variables.css` | Shared design tokens |
| GET / HEAD | `/assets/js/main.js` | Vanilla JavaScript navigation |
| Any | Unknown route | 404 rendered HTML |

Malformed JSON returns 400. Bodies above 16 KB return 413. Unexpected failures return generic 500 HTML. An injected test application verifies async errors; there is no publicly accessible failure route. No login endpoints are implemented. New order writes are disabled by default; their protected workflow is documented in order-workflow.md. Readiness checks configured database connectivity without exposing provider details.

Storefront UI navigation uses `/#collections`, `/#contact` and `/#about-us`. Search filters temporary category names in a browser dialog; account and bag controls open informational UI dialogs. These introduce no backend API or persistence. Admin routes require verified administrator access and are not linked from the storefront.

Homepage cards expose the 18 reference-approved collections: 15 bathroom-accessory categories and three home collections. The additional More collections group has been removed; source discovery alone does not determine homepage placement. Imported records and existing collection URLs remain available separately. The existing `/collections/hotel-accessories` URL remains an alias of hand dryers, without inventing another source collection. Product galleries contain all source photos. Data is a reconciled local import snapshot; there are no live warehouse-stock or purchase operations.

## Planned routes (not available)

Storefront: `/categories`, `/categories/:slug`, `/cart`, `/account`, `/account/orders` and account-based order history. Checkout/confirmation have a gated implementation described above. Future database catalog reads require validation; account and order reads require verified ownership. Existing product routes read the local catalog snapshot.

Authentication: `/admin/login`, customer login/registration, logout. Credential flows require validation, rate limits and CSRF. Logout must invalidate sessions.

Admin: `/admin/products`, `/admin/categories`, `/admin/inventory`, `/admin/customers`, `/admin/promotions`, `/admin/banners`, `/admin/reports`, `/admin/settings`. All real administration requires authenticated permissions. Every mutation must use a non-GET method, CSRF validation and server-side schemas. Add endpoint details alongside each phase rather than implying unimplemented APIs exist.
