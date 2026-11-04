# Design system

## Storefront direction

The storefront follows the collection-first shopping hierarchy of [Alreda Store](https://alredastore.com/): white header, centered brand text, Home/Catalog/Contact/About Us navigation, language control and search/account/bag icons. The main page begins with Collections and large square category tiles. The previous storytelling hero, decorative illustration, green/beige storefront palette, workspace link and coming-soon messaging have been removed.

The original Delight logo, bathroom hero and collection photography are sourced from the reference store and served locally. The latest collection screenshot supplies the order and grouping of 18 homepage cards. Catalog products and prices remain explicit reference snapshots; stock and purchasing are not connected. No fabricated product photos or availability claims appear.

## Tokens and layout

- Storefront background: #fff; primary text: #222; secondary text: #666; borders: #e5e5e5; placeholder background: #f5f5f5.
- Arial/system sans-serif typography. Desktop page heading 38px, mobile 30px; category titles 17px/14px. No oversized marketing type or decorative animation.
- Shared spacing tokens remain 0.5–5rem; content container 1200px; desktop side gutter 40px, mobile 20px. Card gaps 24px desktop and 16px mobile.
- Category and product grids: four columns above 1000px, two columns from 360px through 1000px, one column below 360px. Square image slots use object-fit: contain for future product photography.
- Navigation collapses below 761px, with accessible Menu state and Escape/focus handling. Brand remains centered on desktop and mobile.
- Storefront-specific styles live in src/public/css/pages/storefront.css and scoped storefront variables. Shared base/layout utilities remain in main.css. The separate admin foundation retains its existing appearance and route.

## Components and interactions

Reusable EJS partials: category-card, product-card, product-grid, product-price, availability, add-to-cart, icon, header and footer. Prices are preformatted display values; templates do not calculate money. Product rendering is prepared but no mock products are listed on the homepage. Add-to-cart remains explicitly disabled until the shopping service is implemented.

Temporary category fixtures are isolated in src/config/storefront-preview.js, with no database persistence. The home controller validates an optional collection query and supplies display data. Category links load a selected collection preview and honest empty product state. Future repositories/services will replace this fixture source.

Search opens a native modal and filters collection names, including no-results feedback. It does not claim to search products. Account and bag modals explain their disconnected state. Native dialogs provide Escape closing, focus containment and focus return. User-visible search results use textContent, not HTML insertion. Language selection shows English and a disabled, labeled Arabic option; translations remain future scope. Contact and About Us navigate to footer sections; no contact information is invented.

## Accessibility and future localization

Semantic landmarks and headings, skip link, keyboard focus outlines, labeled icon buttons, text image-placeholder descriptions, status feedback and reduced-motion preference. CSS logical properties support RTL. Storefront copy and catalog labels are localized in English and Arabic; the language choice persists in an HttpOnly, same-site preference cookie (Secure in production).

## Header and footer sizing refinement

Desktop header uses an 88px brand row with symmetrical side columns, a 26px centered wordmark and 44px minimum controls/navigation targets. Mobile uses a centered 23px brand above a single menu/language/icons row, reducing header height. Footer has a subtle #fafafa background, three desktop columns, a full-width mobile brand above two link/contact columns, and a wrapping copyright/developer-credit row. Developer attribution links to Mahmoud Mohamed Hefny's supplied LinkedIn profile with bold name text and safe new-tab attributes.

## Compact sizing update

Current header sizing supersedes the earlier values: 64px desktop brand row, 22px desktop / 20px mobile brand, 13px navigation with 36px desktop / 44px mobile link targets. Shopping/menu buttons remain 44px. Footer uses 28px desktop / 24px mobile top padding, 17px wordmark, 12px body/links, inline wrapping quick links and 11px copyright/developer credit. Duplicate footer heading removed to reduce height.

## Screenshot-inspired header and hero

The user's latest screenshot supersedes the compact text-only header: single desktop row 132px tall beneath an 8px brown rule, with navigation left, the authentic Delight logo centered, and language/search/account/bag controls right. Header content is capped at 1400px. Mobile uses the logo over a compact menu/tools row.

A local Assistant regular font follows the reference's typography. The full-width bathroom hero uses the original image with object-fit: cover, desktop focal point 58%, a 40% black overlay and white Browse our latest products text. The outlined Shop all link scrolls to Collections. Hero height follows the desktop viewport, bounded between 560 and 900px; mobile is bounded between 440 and 640px with responsive text. A verified WhatsApp link appears as a desktop pill and mobile icon button. It opens externally without automatically sending a message. No decorative illustration is used.

Product and populated category photography is delivered from Cloudinary; see [Cloudinary media setup](cloudinary-media.md). Categories without an uploaded image use the accessible placeholder. The compact footer with Mahmoud Mohamed Hefny credit is preserved.

## Current collection showcase

The homepage now renders two Collections sections following the supplied screenshot: 15 bathroom-accessory cards (four desktop columns) and three home collections (three desktop columns). The second group contains Safe Box, Door handle and basket. Tablet primary cards use two columns; secondary cards use three. Mobile uses two columns, switching to one below 360px. Body/captions use the local Assistant font; section headings are 32px desktop / 26px mobile, captions 15px / 13px, with small adjacent arrows. All 18 photos use local, source-cropped square WebP files, replacing placeholders. The hero and header above the showcase remain unchanged.

The fallback homepage category order is in `src/config/collection-preview.json`; live catalog/category data comes from the configured catalog repository. Each card opens its collection page. Homepage order and category groups can be managed from the admin dashboard.

## Product detail pages

Product cards open `/products/:slug`, retaining their collection context. The page follows the supplied reference with a restrained two-column desktop layout, large uncropped product photo, four-image thumbnail gallery where available, keyboard-accessible enlargement dialog, title, snapshot price/discount, source color/type choices and quantity controls. Below 760px the gallery and information stack; option chips wrap, and related cards use two columns (one below 360px). Product-only styles live in css/pages/product-details.css.

Descriptions retain safe paragraphs, lists, headings and tables from the source; sanitize-html strips attributes and unsafe markup before EJS renders rich text. Source specifications remain in the description, with a separate More information table for collection/brand/type/SKU. Prices update with the selected variant and the URL retains that selection. A GET select form supports browsers without JavaScript. No stock or purchase availability is inferred: Add to cart and Buy it now remain disabled with a clear preview notice.

## Complete imported catalog

The local catalog replaces the earlier four-product fixtures. The homepage shows only the 18 reference-approved collections in its original two groups; importing a collection does not approve homepage placement. The automatically added More collections group was removed after the user's correction. Source collections remain recorded in the import inventory. Collection and full-catalog pages paginate 24 products, retaining search/sort in page links. Cards use 640px local WebP photos; product main photos have responsive 640/1200px sources, and enlargement uses the untouched original file. Thumbnail strips retain every gallery image and scroll horizontally. Variant-specific images follow source relationships. Available Arabic titles/descriptions are preserved, with an expandable Arabic description where it differs. Public availability is labeled as a source snapshot and never represented as a warehouse quantity. Purchasing remains disabled.

Product image sizing refinement: gallery width is capped at 420px on desktop and 360px on mobile. The main photo frame uses a viewport-aware height capped at 480px desktop / 340px mobile with contain fitting and modest padding. Thumbnails are 60x68px desktop / 54x60px mobile. Enlargement is capped at 720px wide and 82svh high, with a smaller image height on phones; originals remain unchanged.

Changing a color, size or other option selects its source-associated gallery photo and reveals the selected thumbnail horizontally without moving keyboard focus or scrolling the page vertically. The enlarged view uses the same selected original. Options without an associated photo return to the main product image, matching server-rendered/reloaded selection behavior.

## English and Arabic storefront

The language selector switches all customer-facing storefront navigation, collection pages, product pages, checkout states and errors between English/LTR and Arabic/RTL while preserving the current route and query. Catalog collection/product names, common variant options and product descriptions use the available matching language; unavailable source descriptions use a translated notice instead of leaking the other language. The original Delight logo and trademark/vendor names retain their brand spelling. Three mirror-stand records absent from the stale captured collection-membership list are attached to the matching mirror-stand collection by their verified product slugs.

### Product card variants and alternate images — 2026-11-02
- Compact color swatches and size/type choices appear directly below each product image, using actual catalog options and variant-image associations.
- Selecting a choice updates its photo, displayed price, availability and product links. Invalid combinations reconcile to a real variant and update every pressed state.
- Fine-pointer hover previews the next gallery photo, then restores the selected variant on leave. Touch devices use tap selections. Image failures preserve the current decoded image.
- Buttons have accessible names, pressed states, focus outlines and Arabic/English labels. Without JavaScript the image and product navigation stay usable, and inactive preview controls are hidden.

### Reference-style card refinement — 2026-11-02
Reviewed the original storefront catalog and the supplied reference. Cards now follow image/title/price/color-circle/action hierarchy. Colors use named CSS classes (no inline swatch style dependency); secondary type/size choices use a compact select. Multi-option items link to Choose options rather than an inactive Add to cart. Color changes resolve direct variant image IDs first, then explicit gallery variantIds, preserving exact variant links and matching prices. Updated the PWA cache version and made CSS/JS network-first with offline fallback so new styling replaces old cached assets. No production data changes.

### Consistent card dimensions — 2026-11-02
Unified product-card padding, restrained borders, square image frames with contain sizing to preserve complete photos, two-line names, compact option spacing and 44px primary actions. Mobile cards use smaller insets/swatches without horizontal overflow. Desktop and Arabic mobile screenshots were reviewed, and actual-color image, hover, keyboard and dropdown behavior passed the browser smoke check. Updated CSS cache versions.

Dropdown refinement: option labels align above equally sized controls, with paired desktop fields and stacked mobile fields. Real 30cm/40cm and Single/Double selections were browser-tested against their exact variant images, including Arabic mobile. Image loading now exposes aria-busy and clears it safely after rapid selection changes. Sixteen focused regression tests and lint passed; no database records changed.

Card simplification: the first gallery photo is always the initial card cover; hovering the photo previews gallery image two, and leaving restores the cover or explicitly selected color photo. Only color choices appear on cards. Size/type/diameter selection remains on product details via Choose options. Real-image desktop/Arabic-mobile checks and product regressions passed; no product data changed.

### Customer account dialog

Account-only dialog uses a 460px maximum width, 24px padding (18px on small screens), 16px outer radius, a compact identity row and separated actions. Notification preference labels provide at least 56px row height with native 20px checkboxes. Full-width save/enable buttons have a 44px minimum height; sign-out is a separate neutral action. Native dialog focus and Escape behavior are preserved. Layout is mirrored using document direction and logical spacing.

### Loading and first-visit setup

The loading overlay uses the existing Delight asset, a small neutral spinner and localized status. It never enforces an artificial minimum duration and provides a manual dismissal plus a bounded timeout.

First-visit setup uses a 480px native dialog, two compact option cards, primary/secondary 44px actions, localized help and logical RTL spacing. Not now opens instructions; native close/Escape dismiss. Reopening is available from the footer. Prompt choices are optional and independent, never alter marketing consent, and automatic display avoids checkout/auth/admin paths or another open dialog. Native browser permission prompts require an explicit click; the UI reports installation and notification connection separately from requests.
## Admin workspace

The admin uses a compact charcoal sidebar, white top bar, light neutral canvas and responsive content panels. Dashboard cards summarize live PostgreSQL data; management links appear only when the authenticated account has the matching server-checked permission. Catalog editing supports English/Arabic text, category, type, color, price, stock and existing Cloudinary image URLs. Discounts can target all products, a product, category, type or color. The language selector switches the workspace between English/LTR and Arabic/RTL.

## Homepage collection management

Homepage sections have bilingual headings and a saved display order. Admins can edit bilingual collection names, reorder sections, drag cards within or between sections, move cards with accessible arrow buttons, hide cards from the homepage, and restore them later. The storefront uses the established responsive grid and category photography. The editor keeps a compact image preview and switches to a single-column touch layout on narrow screens.


## Product cards and option editing (2026-11-03)

Product images fill a fixed square frame using cover. Touch-device set cards use contain so the complete set remains visible. A responsive picture source chooses the configured mobile image without requiring hover or JavaScript. Desktop hover uses the configured gallery image, then returns to the current color image. Colors remain the only variant controls on cards; type controls belong on product pages. Admin type rows use the existing bilingual form layout and Cloudinary gallery selectors.

## Shared catalog image template (2026-11-03)

Product detail galleries use a white square frame, up to 420px on desktop and 380px on mobile, with a small inset and contain fitting so the whole product remains visible. Gallery thumbnails are square, consistently spaced and horizontally scrollable. Product cards keep square media and reserve two title lines; new and existing products use the same product-card and product-details EJS components. Category cards retain the shared square category-card template. Do not add per-product layout rules.

## Optional color prices (2026-11-03)

Each selected admin color row includes its assigned image, stock and an optional labeled EGP price. Empty prices show the regular product price as a placeholder. Fields stack on mobile. For products with managed types, empty color prices inherit each type's price; explicit color prices override every type of that color. Existing discount rules continue to apply to the resolved variant price. Selecting a storefront color or its assigned thumbnail updates the selected variant and displayed price together; unrelated gallery photos only change the displayed image.

## Shopping bag feedback (2026-11-03)

The bag dialog uses rounded corners, compact image rows, separate quantities and line totals, a clear subtotal and a full-width checkout action. Narrow screens stack line totals without horizontal scrolling; logical positioning supports RTL. The header badge counts saved units, hides at zero and displays 99+ above 99. Its accessible button label retains the full count. A polite success notice appears for 3.5 seconds only after a successful cart response, in normal document flow beneath the purchase controls so it never overlays navigation or content. Empty bags hide checkout. Errors preserve the last known count and never display a success notice.

The admin header labels its language action Apply language. Delivery has a separate Save delivery prices button targeting the actual editor form; controls wrap on small screens. Saved delivery feedback explicitly identifies whether checkout is enabled by the configured areas. Storage errors use retry wording rather than presenting missing prices. Product editors reject outdated saves with a request to reopen current stock.

## Checkout and delivery pin (2026-11-03)

Checkout has numbered contact, delivery and payment panels, with a sticky order summary beside them on desktop and a stacked layout on mobile. The summary shows product thumbnails, named quantities, subtotal, delivery and total independently. Customer account name/email are prefilled when available. Arabic uses the same layout with RTL spacing.

The delivery panel has a compact Use my location button followed by the editable written address. Coordinates are hidden from the customer interface and remain attached for the admin map link. Clicking requests browser permission, then sends coordinates/locale through the authenticated store endpoint to Photon/OpenStreetMap to obtain an approximate written address. The form discloses the provider and attribution. The customer reviews the result and adds building/apartment details; the selected delivery area and fee never change automatically. Edits made during lookup are preserved. A small removal action clears the attached pin without erasing the written address.

Pending location/address lookup temporarily disables order submission. Permission refusal, timeouts or provider failure retain manual checkout; a failed address lookup can still attach the GPS pin. No location is placed in browser storage or requested automatically on page load. The server does not forward account identity, written addresses or customer IPs to Photon. Bounded short-lived caches and request limits keep free-provider usage modest. Admin order views expose the confirmed written address, validated coordinates and map link from the persistent order snapshot.
# Checkout payment choices

Product color editing uses one bordered card per selected color: name and thumbnail above labeled image, stock, regular override and optional offer price controls. Mobile keeps inputs in two columns without mixing row positions. Existing inherited/imported offers appear as a compact current-offer note. Promotions provides collapsible color controls per product, with independent save actions and explicit empty-to-remove guidance.

Admin Orders uses a filter toolbar and compact equal-height cards (three columns on wide screens, two on medium screens, one on phones). Summary cards omit full addresses and payment-review forms; their View order button opens the detail workspace. Detail uses a product/totals column and a customer/actions sidebar that stacks on mobile. Order status and payment status remain distinct badges, with prominent amount and quantity. Existing sidebar navigation, keyboard focus and RTL spacing are preserved.

The account dialog includes a My orders link using the existing full-width account action style. Customer history separates current and past order cards with status, date, reference, product preview and total. Whole cards open the receipt detail using the same confirmation-card styles. Cancelled orders use a neutral red marker; InstaPay awaiting review uses an amber marker and never a paid label. Empty, pagination and access-error views keep copy concise in both languages.

Verified order confirmations use a centered receipt card (maximum 800px), a quiet green check, separate reference/payment details, item rows with quantity and line totals, and a subtotal/delivery/grand-total summary. Cash orders show “Cash on delivery” instead of an isolated unpaid label. Mobile stacks reference/payment and keeps totals readable; RTL uses logical spacing. The card is rendered only after the existing verified-confirmation response, with escaped text nodes and no change to persistence or payment checks.

Checkout recovery runs silently on entry. Processing disables the submit control and sets `aria-busy` without a separate checking-status message. Show only final confirmation, recorded payment awaiting review, cancellation, or a short actionable error. Keep the recovery action hidden until a failed/uncertain submission or a payment awaiting review needs it. Preserve the same idempotency key on retries; an unknown outcome must never be presented as definitely unsaved or confirmed.

Payment uses two compact accessible radio tiles in the order summary: cash on delivery and InstaPay. Selected tiles have a clear border; unavailable InstaPay remains visibly disabled. A responsive native dialog displays the exact total, configured receiving details, optional QR/link, screenshot preview and upload status. Keyboard close/focus return and RTL layouts are supported. Submission stays disabled while a required proof is missing or uploading. A recorded transfer order displays pending administrator review, never a payment-success message.

