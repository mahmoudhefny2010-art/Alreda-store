# Reference storefront assets

The user requested a storefront similar to their Alreda screenshot. These public assets were obtained from the reference store, not generated or presented as newly created brand assets. They are stored locally and served by Express; no Shopify code or runtime is used.

| Local asset | Public source |
| --- | --- |
| src/public/images/alreda-delight-logo.jpg | https://alredastore.com/cdn/shop/files/WhatsApp_Image_2025-02-23_at_18.24.42_d65c970f.jpg?v=1745538951&width=180 |
| src/public/images/bathroom-hero.jpg | https://alredastore.com/cdn/shop/files/IMG_4198.jpg?v=1763242915&width=1920 |
| src/public/fonts/assistant-regular.woff2 | https://alredastore.com/cdn/fonts/assistant/assistant_n4.9120912a469cad1cc292572851508ca49d12e768.woff2 |
| src/public/images/whatsapp-icon.png | https://alredastore.com/cdn/shop/files/whatsapp-icon.png?crop=center&height=96&v=1788453091&width=96 |

The hero source is only 736 by 736 pixels despite the requested CDN width. Desktop cover enlargement matches the reference's soft image appearance; a higher-resolution original would improve sharpness. The logo source is 180 by 180 pixels and displayed at up to 110 by 110.

The WhatsApp destination was taken from the reference page's public enabled phoneNumber configuration. The local widget is an ordinary link; no message is sent automatically. Header icons reuse the existing project icon partial. Category images remain clearly labeled temporary placeholders, as previously authorized; no unrelated category content was changed.

## Collection photographs and product snapshots

The latest homepage uses 18 original collection photos in the exact order shown in the user's screenshot. src/config/collection-preview.json records each public source image, reference collection handle, local path and homepage group. Source images are requested at 640x640 with center crop and Accept: image/webp, then served locally. The 18 current files total 467,042 bytes. The primary group has 15 cards; the secondary group has Safe Box, Door handle and basket. The hotel-accessories alias remains available as a legacy category page.

Product snapshots in src/config/catalog-preview.json now cover all 19 local collection routes, with four samples per route. They retain source product URLs and image provenance; displayed prices are explicitly snapshots, not current quotes, and stock/purchasing are not connected. Product and collection imports are manual scripts only, not production network dependencies.

To refresh intentionally: run node scripts/import-collection-previews.js, inspect the data/image output, then node scripts/import-preview-catalog.js. Changing fixture assets does not create or migrate a database.

## Product detail snapshots

src/config/product-details-preview.json contains 72 unique source products already present in the collection samples. Each record includes its original Alreda product URL, source description, vendor/type, option labels and variant price snapshots. Local galleries in src/public/images/product-details contain up to four source photographs per product, requested at 1000px with WebP negotiation. Each gallery record retains its original image source URL. These are reference-store photos, not invented assets or live availability claims.

Run node scripts/import-product-details.js only for an intentional refresh after importing the collection catalog. The importer validates the fixed source origin, image CDN namespace, fields, prices and image response types. Runtime pages use local data and assets. sanitize-html is a runtime dependency for safely displaying source descriptions; it does not fetch content or introduce a storefront platform dependency.

## Complete catalog migration (supersedes preview imports)

The active storefront reads src/config/catalog.json, populated by scripts/catalog-import/run.js: 237 products, 28 collections, 1,074 variants and all 898 ordered product-gallery relationships. Every record retains its original Alreda URL and image source. Default/English and Arabic feeds and both sitemap inventories are captured under ignored data/imports/alreda; no Admin export or private API was supplied.

All 917 canonical image URLs were downloaded and validated, resulting in 910 content-deduplicated original files (785,597,901 bytes). Local originals are in src/public/images/products and collections, alongside 640px/1200px WebP display copies. Originals retain source binary quality. Seven source collections have no image and are labeled unavailable. Use catalog:import to refresh the active catalog; the historical preview scripts no longer supply storefront data. No generated imagery, invented assets or runtime source downloads are used.
