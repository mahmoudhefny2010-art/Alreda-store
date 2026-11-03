# Product images, types and bilingual entry

In **Admin → Products & categories → Add/Edit product**, upload the product gallery first. In **Card images and product types**, select:

- **Hover image**: the photo displayed on desktop pointer hover. Automatic uses gallery image 2.
- **Full-set image on mobile**: the photo displayed immediately on touch devices. Automatic uses the cover, or an image explicitly labeled as a complete/full set. Set cards use `contain` on touch devices to show the entire photograph.
- **Manage type options**: an explicit replacement of the active option matrix. Choose a common bathroom-accessory type or add a bilingual custom type. Each type has its own gallery photo, price and stock. Type controls remain inside the product page; card options show colors only.

When type management is enabled, type stock is the source of truth. With multiple selected colors, each type's stock is divided evenly among those colors (remainder goes to the first colors). The color-only stock inputs are not used in this mode. Existing variant rows are retained for order history and marked unavailable; repeat saves reuse stable variant IDs. Type selection shows its type image; color selection shows its color image. Image URLs must belong to the submitted Cloudinary gallery.

Bilingual fields use the existing catalog dictionary in both directions after a short typing pause. Matching product names, descriptions and catalog terms fill automatically, and manually edited translations are preserved. Unsupported prose explicitly requests manual translation and is never presented as translated. No translation API, key or external text transmission is used.

## Database and rollout

`20261103030000_product_presentation` adds a JSONB `catalog_details.presentation` column, defaulting to `{}`. It stores image references and type settings, never image binaries. `20261103040000_variant_color_hex` supplies the existing Prisma color field for restored databases, preserving values where it already exists.

Apply migrations before starting the updated app, then regenerate Prisma. Neon migrations were applied and status verified on 2026-11-03. Existing products are not rewritten by these migrations.

Rollback after real usage: restore the previous application while retaining the additive columns and metadata. Do not drop populated metadata or variant columns. The automated isolated migration test drops and reapplies only the empty new presentation column; it verifies product rows survive and exercises actual Prisma type/image persistence and repeat saves.

## Verification

Focused Vitest coverage includes dictionary directions, unsupported input, HTML sanitization, image/stock validation, managed type persistence, stable variant IDs and migration apply/rollback/reapply on disposable PostgreSQL. Playwright exercises bilingual entry/manual edits, adding types, selecting images, desktop hover, touch color selection and full-set framing at mobile width. Synthetic browser fixtures make no production writes.

## Guided editor update

The display editor now includes immediate automatic-image previews, clickable gallery thumbnails, an upload shortcut, bilingual usage guidance and an empty-type state. Each type shows its color stock breakdown; a live summary shows the total. While type management is enabled, color-only stock inputs are disabled and the product stock field is automatically calculated/read-only. Turning it off re-enables manual stock entry. Saving still uses the existing validated transaction and explicit type-management switch.
