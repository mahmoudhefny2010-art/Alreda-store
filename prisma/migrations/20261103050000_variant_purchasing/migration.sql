-- Preserve existing carts and orders; selections are optional for legacy rows.
ALTER TABLE cart_items ADD COLUMN variant_id UUID;
ALTER TABLE order_items ADD COLUMN variant_id UUID;
ALTER TABLE cart_items ADD CONSTRAINT cart_items_variant_id_foreign FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD CONSTRAINT order_items_variant_id_foreign FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL;
DROP INDEX cart_items_cart_product_uq;
CREATE UNIQUE INDEX cart_items_cart_product_variant_uq ON cart_items(cart_id, product_id, variant_id) NULLS NOT DISTINCT;
CREATE INDEX cart_items_cart_product_variant_idx ON cart_items(cart_id, product_id, variant_id);
CREATE INDEX order_items_variant_idx ON order_items(variant_id);
