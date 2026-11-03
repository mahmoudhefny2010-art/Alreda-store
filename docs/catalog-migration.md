# Complete public catalog migration

The storefront now reads a generated local catalog through `src/services/catalog.repository.js`. PostgreSQL/Prisma is **not implemented** in this project; this pipeline prepares normalized records and serves them locally. It performs no database writes. Authentication, cart, checkout and payments remain outside scope.

The authorized source is https://alredastore.com/. No Admin API credentials or official export were provided. Discovery uses permitted public product/collection feeds in the default and Arabic locales, follows pagination until empty, and reconciles product and collection handles with both locales' sitemaps. Collection membership is fetched separately for every collection; products are keyed by source ID and can belong to multiple collections. Public collection HTML resolves discrepancies between metadata counters and published listings. Empty source collections remain empty. Parent relationships are unknown; no subcategory hierarchy is invented. Navigation links are retained for review.

## Storage and commands

- `scripts/catalog-import/`: discovery, export extraction, normalization, image download, validation, local activation and reports.
- `data/imports/alreda/raw/`: URL-addressed raw responses with capture time; ignored by Git.
- `data/imports/alreda/discovered.json`: source inventory including English/Arabic records, memberships, sitemaps and navigation.
- `data/imports/alreda/normalized.json`: normalized migration input; includes original source IDs, null missing fields, gallery order, variant image associations, prices, public availability and translations.
- `data/imports/alreda/image-manifest.json`: resumable source-to-local image/checksum mapping.
- `src/public/images/products/` and `collections/`: SHA-256-named original binary files plus 640px and 1200px WebP display copies. Originals are never recompressed. Display copies preserve aspect ratio and do not upscale.
- `src/config/catalog.json`: one atomically activated catalog snapshot, outside the public static directory.
- `docs/catalog-migration-report.md` and `.json`: counts, reconciliation, missing fields and failures.

Run with Node 22+ from the project root:

```powershell
# Discover/download/stage; leave the active catalog unchanged.
npm.cmd run catalog:import
# Activate a fully validated staged public snapshot.
npm.cmd run catalog:import -- --cached --activate
# Intentionally re-fetch source metadata; image files resume from verified cache.
npm.cmd run catalog:import -- --refresh --activate
# Prefer an authorized local export when one is available.
npm.cmd run catalog:import -- --source path/to/export.json
npm.cmd run catalog:import -- --source path/to/products.csv
```

JSON accepts a public-product-feed-shaped `products` array plus `collections`, source-ID `memberships`, optional Arabic arrays and explicit EGP currency. No credentials belong in export files. Standard Shopify CSV quoting, multiline descriptions, continuation image rows, variants and variant images are supported. Standard CSV lacks collection membership, translations, source IDs and verified public availability: those remain unknown, and deterministic derived import keys are explicitly marked in the source type. CSV is a staging path; review publication status and supplement missing relationships before activating an official export. Other currencies or unsupported schemas are rejected, not silently converted. No automatic admin-export/public merge overwrites fields.

## Integrity and conflict policy

Every source record crosses a Zod validation boundary. Network URLs are restricted to the source storefront and its specific image CDN namespace; redirects, authentication and access restrictions are not bypassed. Metadata requests are sequential with a delay; image downloads use two workers. HTTP failures are reported and can be resumed later. Originals are decoded/validated with Sharp; local file checksums prevent silently accepting corrupted cached originals. Canonical source URLs prevent repeat downloads; content hashes prevent duplicate stored binaries. Complete product galleries are imported without the old four-image limit. Original descriptions/specification tables are retained; safe HTML is rendered through the existing sanitizer. Missing source images are labeled unavailable rather than replaced with unrelated photos.

Activation validates IDs/slugs, money, image relationships, collection membership and downloaded paths before replacing one local catalog file. It does not append rows, so re-importing cannot duplicate records. An activation checksum prevents overwriting a catalog edited since the last import; resolve those edits explicitly before proceeding. A future Prisma adapter must use source-ID unique keys, transactions and an explicit field conflict policy; this task does not create a speculative database schema or claim a completed database import.

Public availability is stored per variant as true/false/null, with inventory quantity always null. It is displayed as an import snapshot and never used to enable purchasing. Prices/discounts remain exact decimal strings. Default-locale titles can themselves contain Arabic; locale fields preserve the source wording without inventing translations. Specifications are retained in rich descriptions and extracted table rows; unknown specifications remain absent.

## Storefront

The homepage shows the 18 reference-approved collections. Ten additionally discovered collections were initially added automatically; the user rejected that extra homepage group, which has been removed. Source discovery verifies provenance, not business approval or homepage placement. The source inventory and existing collection URLs are preserved for review. Existing friendly local collection URLs and the legacy hotel-accessories alias remain; the alias shares the verified hand-dryer collection and is not counted as a new source collection. `/products` lists every discovered product, including products without a source collection. Listings use 24 products per page with validated search/sort/pagination. Product pages retain every gallery photo, show original-quality enlargements, switch variant-specific images/prices and expose available Arabic descriptions. Header, footer and configured WhatsApp destination are preserved.

See the generated report for exact inventory totals and unresolved source fields. Completeness refers to the reconciled public snapshot, never unpublished/admin-only inventory.
