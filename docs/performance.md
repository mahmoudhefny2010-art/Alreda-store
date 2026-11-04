# Free-tier performance

Assumptions: the checked-in Vercel configuration is the deployment target; the local environment points to Neon's Frankfurt (`eu-central-1`) pooled endpoint. The Vercel function is configured for `fra1` for the next deployment. No production credentials, database contents, or deployments were changed. The comparable Lighthouse runs used local snapshot catalog data and the read-only public Cloudinary manifest; they do not exercise Neon queries or Vercel cold starts.

The main avoidable costs were full catalog hydration on individual product and collection requests, write transactions for the shopping bag on every navigation, unnecessary checkout catalog queries, CSS imports loading admin styles on the storefront, unoptimized URLs for new database images, and a blocking loader waiting for images.

The local configuration already uses Neon's pooled endpoint. `src/config/prisma.js` already creates one shared `pg.Pool` / Prisma client per process, limits the pool to five connections, verifies TLS, has connection/query timeouts, and disconnects on shutdown. Those correct settings were preserved.

## Fixes in priority order

1. **Colocate the function and database.** `vercel.json` now pins `fra1`, matching the configured Neon region. This is a configuration change for the next deployment, not a measured production improvement. If production uses another database region, change the pin to match before deploying. Vercel's platform default is Washington, D.C.; project settings can override it, so the previous deployed region remains unverified. [Region documentation](https://vercel.com/docs/regions).
2. **Remove redundant database work.** Product requests hydrate the requested product plus products in its relevant active collections; collection requests hydrate their own products. Lists omit description bodies and section queries. The homepage retains its existing categories/sections-only path. Identical simultaneous reads share a promise, but the next request still sees current stock, pricing, archives, and discounts.
3. **Make cart reads read-only.** New guests get an empty bag without a connection or cookie. Existing carts are queried by authenticated owner or hashed guest token, without creating rows, starting write transactions, or taking advisory locks. Add/remove/merge operations retain their transactions and locks. Empty carts skip discount queries. Checkout loads the current cart and saved details concurrently and skips the entire product catalog when the cart supplies the items. Notification preferences are no longer queried for API/health requests.
4. **Deliver appropriately sized images.** Public Cloudinary uploads use fixed widths: 160px for bag thumbnails, 640px for cards/categories/favorites, 1200px for detail views, and responsive 768px/1280px mobile hero sources (1920px remains for desktop), with `c_limit`, `q_auto`, and `f_auto`. Existing optimized manifest URLs are reused to avoid duplicate derivatives. Replaced/new images use the current saved URL; deliberate crops, version numbers, and full-size lightbox sources are preserved. Signed/private/non-Cloudinary URLs are left intact. [Cloudinary guidance](https://cloudinary.com/documentation/image_optimization).
5. **Reduce rendering and asset costs.** Production view caching is explicit, description sanitization/language analysis uses a bounded content-keyed memory cache, and number formatting is reused within each render. Admin CSS loads on admin pages; detail CSS loads on detail pages; shared pagination rules remain in storefront CSS. Direct stylesheet links remove the CSS import discovery chain. Shared assets in the head use content hashes and a one-year immutable browser cache; unversioned assets keep a one-hour cache. Personalized HTML/API responses remain private/no-store. Service workers keep their revalidation behavior.
6. **Compress and reveal ready content.** The free `compression` package negotiates text compression on non-Vercel hosts. Vercel keeps its built-in edge compression. The initial white loader no longer covers the first page paint; the transition indicator remains for internal navigation and recovers on readiness, history restoration, dismissal, or timeout. [Express guidance](https://expressjs.com/en/advanced/best-practice-performance/), [Vercel compression](https://vercel.com/docs/how-vercel-cdn-works/compression).

## Measurements and limits

The published site was measured before changes with six serial Lighthouse runs (three per default mobile/desktop profile), cold browser cache, and API paths blocked to avoid writes. For a comparable before/after, Lighthouse then ran three times per viewport against a local production-mode app at the exact production Git revision and against the changed working tree, on the same host and Chrome, with the same local catalog snapshot and public Cloudinary manifest. API paths were blocked, service workers were not involved, and browser caches started cold each run. The local comparison includes Cloudinary image delivery, but not Neon latency, Vercel routing/cold starts, or field traffic. INP is not measurable from this page-load lab run; TBT is reported only as a lab proxy. These timings are not a production promise.

| Same-host local Lighthouse median | Mobile before | Mobile after | Desktop before | Desktop after |
| --- | ---: | ---: | ---: | ---: |
| Performance score | 93 | 97 | 97 | 100 |
| FCP | 1,996 ms | 1,551 ms | 496 ms | 365 ms |
| LCP | 2,976 ms | 2,433 ms | 1,194 ms | 779 ms |
| TTFB | 107 ms | 18 ms | 93 ms | 12 ms |
| TBT | 0 ms | 39 ms | 0 ms | 0 ms |
| CLS | 0.00079 | 0.00066 | 0.00107 | 0.00103 |
| Transferred bytes | 733,181 | 603,212 | 733,179 | 603,122 |
| Requests | 48 | 44 | 48 | 44 |

The comparable local median LCP fell 18% on mobile and 35% on desktop; initial bytes fell 17.7% and requests fell by four. First Cloudinary transformation requests varied, so compare the three-run medians, not a single run. The live production baseline was mobile LCP 2,994 ms, FCP 1,408 ms, TTFB 116 ms, TBT 434 ms, CLS 0, score 77; desktop LCP 1,584 ms, FCP 578 ms, TTFB 160 ms, TBT 0 ms, CLS 0.00107, score 89. There is no live production after measurement because deployment was not authorized.

| Homepage CSS measurement | Before | After |
| --- | ---: | ---: |
| Decoded CSS bytes | 81,407 | 55,820 |
| CSS requests | 10 | 7 |
| CSS import discovery chains | Present | Removed |

That is **31.4% less decoded homepage CSS**, with shared catalog styling preserved. This is a byte comparison, not an assertion of 31.4% faster page loads. Vercel already compresses responses, so adding application compression does not imply equivalent new savings there.

The audit confirms the hero image is the LCP element. The original page waited for Cloudinary image loading and also placed an opaque loader over the first paint. The responsive hero source reduces transferred bytes and its repeated-run mobile median met the 2.5s lab target; cold transformation latency still varies.

## Exact changed files

The source files contain the complete updated code; Git tracks the exact changes without keeping a duplicate patch artifact.

| Files | Change |
| --- | --- |
| `src/app.js` | Compression, explicit view cache, asset cache headers, private dynamic responses, formatting reuse, API preference-query avoidance |
| `src/services/catalog.repository.js` | Scoped queries, lighter list projection, optimized current image delivery |
| `src/services/product.service.js`, `src/services/category.service.js` | Pass page-specific catalog scopes |
| `src/repositories/cart.repository.js`, `src/routes/cart.routes.js` | Read-only cart retrieval, zero-query new guests, thumbnail delivery |
| `src/controllers/storefront/checkout.controller.js` | Parallel independent reads; avoid unnecessary full catalog |
| `src/routes/wishlist.routes.js` | Card-sized favorites and variant images |
| `src/utils/optimizedImage.js` | Public image delivery helper with fixed profiles |
| `src/utils/staticAssets.js` | Cached content hashes and safe immutable-asset checks |
| `src/utils/productDescription.js` | Up to 64 cached public descriptions, capped at 16,384 characters each for both input and sanitized output |
| `src/views/partials/head.ejs` | Direct versioned CSS links, page-specific styles, Cloudinary preconnect |
| `src/public/css/main.css`, `src/public/css/pages/storefront.css`, `src/public/css/pages/product-details.css` | Remove imports and keep shared catalog rules available |
| `src/public/js/page-loading.js` | Keep first paint visible; retain the navigation loader and readiness recovery |
| `src/public/js/cart.js`, `src/public/js/wishlist.js` | Serialize overlapping cart edits and refresh saved hearts on authenticated catalog pages |
| `src/public/js/checkout.js`, `src/controllers/storefront/checkout.controller.js` | Avoid inventory polling during confirmed checkout and parallelize/skip redundant reads |
| `src/repositories/media-journal.repository.js`, `src/services/cloudinary.service.js` | Persist Vercel media audit records using existing database tables instead of a read-only filesystem |
| `src/views/storefront/home.ejs`, `src/services/cloudinary.service.js` | Responsive 768px/1280px Cloudinary hero variants on mobile |
| `vercel.json` | Frankfurt region, versioned CDN caching, text asset inclusion for runtime hashing |
| `.env.example` | Document pooled runtime URLs and per-process pool sizing |
| `package.json`, `package-lock.json` | Add free Express compression middleware |
| `tests/unit/performance.test.js`, `tests/unit/visit-controls.test.js`, `tests/unit/media-journal.test.js` | Compression/cache negotiation, public images, cart/checkout query avoidance, loader recovery, Vercel journaling |
| `tests/integration/catalog-performance.test.js` | Disposable PostgreSQL scopes, pricing/order preservation, archives, fresh stock, cart ownership |
| `tests/e2e/performance.spec.js` | Desktop/mobile controls with delayed images; gallery/variant interactions |
| `tests/e2e/shopping-races.spec.js` | Overlapping cart edits and authenticated favorites |
| `tests/e2e/scroll-reveal.spec.js` | Dismiss the existing welcome dialog before checking hover behavior |
| `scripts/testing/performance-check.js` | Repeatable local measurements; writes ignored `test-results/performance` evidence |
| `docs/architecture.md`, `docs/routes.md`, `docs/design-system.md` | Remove stale duplicate documentation after confirming no live code references |

No application folder reorganization is needed. Continue using controllers for HTTP/rendering, services for page assembly, repositories for database access, and small pure utilities for delivery logic. `src/public` is the editable asset source; `public` is generated by the build and stays out of Git.

## Free-tier operations and follow-up

- Set `NODE_ENV=production`; use `DATABASE_URL` with the Neon `-pooler` hostname and `DIRECT_URL` for CLI/migrations against the same database. Start with `DATABASE_POOL_MAX=2`–`5` per instance. Increasing it multiplies connections across serverless instances and can increase queuing/compute consumption. Keep the singleton and do not connect/disconnect on every request. [Neon pooling](https://neon.com/docs/connect/connection-pooling).
- Preserve live price/stock checks at checkout. Avoid process-local TTL caches for inventory, permissions, sessions, carts, or private HTML. Memory caches disappear during restarts and do not coordinate multiple instances; they are appropriate here only for immutable derived assets/templates and content-keyed public descriptions.
- Neon Free automatically suspends compute after five minutes of inactivity; that setting cannot be disabled on Free. Both the host and database may incur first-request delays. Eliminating cold starts or guaranteeing consistently low latency is not realistic with this setup. Artificial keep-alive traffic consumes quotas and is not used. [Neon scale-to-zero](https://neon.com/docs/introduction/scale-to-zero).
- On persistent Node hosting, the existing notification worker polls every 30 seconds and media cleanup every 60 seconds. Their queries can keep Neon active and consume its compute allowance. Vercel's entry point avoids these local timers and uses the existing scheduled job. Polling intervals were preserved because changing them also changes notification/cleanup timing.
- Use a small set of Cloudinary sizes and versioned public IDs/URLs. Lazy-load offscreen content, keep the hero/detail LCP image eager with high priority, and keep image space reserved. The first request for a new derivative may be slower and consumes transformation usage; inspect actual Cloudinary usage rather than adding arbitrary widths or higher DPR variants.
- Pagination still chooses cards after loading the collection's price/variant data. The all-products listing still loads the catalog's pricing/variant/gallery data. For a much larger catalog, implement database pagination with identical effective-price/variant/search/featured ordering, then hydrate only the selected page. That is a separate behavior-sensitive change; do not replace the current discount-aware sort with a raw `price_egp` sort.
- Existing unique slug/source IDs and product/category relation indexes support these queries; no speculative schema migrations were added. Next, inspect slow query plans on representative non-production data before adding indexes.
- After deployment, verify `Content-Encoding`, `Vary`, `Cache-Control`, actual function region, and repeated cold/warm TTFB. Compare the same routes on mobile with a cold browser cache, including signed-in navigation and checkout. Run Lighthouse or browser traces against the real deployment to establish LCP/CLS/TBT; lab TBT does not establish real-user INP. No analytics installation, deployment, load test, paid service, or production write was performed.

## Verification

The final unit/integration suite passed all 702 tests; lint and the Vercel build passed. Ten focused browser tests passed on an isolated local port: mobile/desktop product and loading interactions, cart race and favorites, checkout validation/retry/duplicate-submit protection, plus a customer-to-admin order lifecycle. An existing development server occupied port 3100 and was left running. Lighthouse INP was unavailable; lab TBT is reported. No deploy or production write was performed. To reproduce the portable snapshot audit, run `node scripts/testing/performance-check.js`; raw results and screenshots go to ignored `test-results/performance`.
