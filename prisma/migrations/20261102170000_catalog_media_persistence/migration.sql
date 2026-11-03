-- Additive catalog/media persistence. No existing rows are removed or rewritten.
ALTER TABLE "categories"
  ADD COLUMN "source_id" VARCHAR(80),
  ADD COLUMN "image_url" TEXT NOT NULL DEFAULT '';

ALTER TABLE "products"
  ADD COLUMN "source_id" VARCHAR(80);

CREATE UNIQUE INDEX "categories_source_id_uq" ON "categories"("source_id");
CREATE UNIQUE INDEX "products_source_id_uq" ON "products"("source_id");
ALTER TABLE "categories"
  ADD CONSTRAINT "categories_cloudinary_image_check"
  CHECK ("image_url" = '' OR "image_url" LIKE 'https://res.cloudinary.com/%');

CREATE TABLE "product_categories" (
  "product_id" UUID NOT NULL,
  "category_id" UUID NOT NULL,
  CONSTRAINT "product_categories_pk" PRIMARY KEY ("product_id", "category_id"),
  CONSTRAINT "product_categories_product_id_foreign" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "product_categories_category_id_foreign" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "product_categories_category_product_idx" ON "product_categories"("category_id", "product_id");

CREATE TABLE "product_variants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_id" VARCHAR(80) NOT NULL,
  "product_id" UUID NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "title_ar" VARCHAR(160) NOT NULL DEFAULT '',
  "price_egp" DECIMAL(12,2) NOT NULL,
  "compare_at_egp" DECIMAL(12,2),
  "sku" VARCHAR(120) NOT NULL DEFAULT '',
  "options" TEXT NOT NULL DEFAULT '[]',
  "is_available" BOOLEAN NOT NULL DEFAULT false,
  "stock_quantity" INTEGER,
  "source_image_id" VARCHAR(80),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_variants_product_id_foreign" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "product_variants_price_check" CHECK ("price_egp" >= 0 AND ("compare_at_egp" IS NULL OR "compare_at_egp" >= 0)),
  CONSTRAINT "product_variants_stock_check" CHECK ("stock_quantity" IS NULL OR "stock_quantity" >= 0)
);
CREATE UNIQUE INDEX "product_variants_source_id_uq" ON "product_variants"("source_id");
CREATE INDEX "product_variants_product_available_idx" ON "product_variants"("product_id", "is_available");

CREATE TABLE "product_images" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_id" VARCHAR(80) NOT NULL,
  "product_id" UUID NOT NULL,
  "variant_id" UUID,
  "secure_url" VARCHAR(2048) NOT NULL,
  "public_id" VARCHAR(240) NOT NULL DEFAULT '',
  "asset_id" VARCHAR(240) NOT NULL DEFAULT '',
  "alt_text" VARCHAR(500) NOT NULL DEFAULT '',
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_images_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_images_product_id_foreign" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "product_images_variant_id_foreign" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "product_images_cloudinary_url_check" CHECK ("secure_url" LIKE 'https://res.cloudinary.com/%'),
  CONSTRAINT "product_images_order_check" CHECK ("display_order" >= 0)
);
CREATE UNIQUE INDEX "product_images_product_source_uq" ON "product_images"("product_id", "source_id");
CREATE INDEX "product_images_product_order_idx" ON "product_images"("product_id", "display_order");
CREATE INDEX "product_images_variant_idx" ON "product_images"("variant_id");

