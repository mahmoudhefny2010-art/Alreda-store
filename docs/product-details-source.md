# Product details source refresh

The active product catalog is `src/config/catalog.json`. `npm run catalog:details` refetches the public English and Arabic product feeds, builds a validated change plan, and writes an ignored local report at `docs/product-details-source-report.json`. Add `-- --execute` only when the reviewed description changes should be applied to PostgreSQL. The refresh does not run during storefront startup or change prices, stock, variants or Cloudinary images.

The previous language filter discarded an entire English description if it contained even one Arabic option name. Product pages now preserve the entire sanitized source description and select by predominant visible-text language. Missing translations display an explicit original-language notice and correct content lang/direction; this is not a claim of complete translation. There are 66 English and 22 Arabic source translation gaps. Supplying a Google Translation key alone does not translate the existing catalog automatically.

Commands:

```powershell
npm.cmd run catalog:details
# Apply reviewed description changes only, without any schema changes:
npm.cmd run catalog:details -- --execute
# Read-only browser checks against configured Neon:
node scripts/testing/product-details-check.js
```

Refresh refuses incomplete or duplicate source inventories, ID/slug mismatches, blank descriptions, and conflicting administrator edits. Database changes use a serializable Prisma transaction and are followed by retrieval using the storefront catalog repository. Existing source snapshots update only after successful persistent verification and a concurrent-file check. Product-description-only backups and raw source responses are saved under ignored data/imports/alreda/details-refresh/. No credentials or customer/order records are captured. A failure after commit is reported and can be reconciled by rerunning the idempotent plan.

No stock, prices, orders, category links, variant associations or Cloudinary URLs are changed. The source refresh is an operator command, never an automatic network call during storefront rendering.

## Manual translation update

The previous source-language fallback counts describe the original capture. They have been resolved in the active storefront by manually authored translations: all 237 product descriptions are now available in both languages. See manual-catalog-translations.md and manual-translation-report.json. The external translation integration and its settings have been removed.
