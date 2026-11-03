-- Earlier application code already uses color_hex. Keep existing values if present.
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "color_hex" VARCHAR(7) NOT NULL DEFAULT '';
