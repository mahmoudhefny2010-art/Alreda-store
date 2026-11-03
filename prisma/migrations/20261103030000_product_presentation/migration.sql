-- Additive: preserve all product, inventory, and media records.
ALTER TABLE "catalog_details" ADD COLUMN "presentation" JSONB NOT NULL DEFAULT '{}';
