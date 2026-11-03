-- Disposable/test databases only. Refuse to discard selections or merge cart lines.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM cart_items WHERE variant_id IS NOT NULL)
 OR EXISTS (SELECT 1 FROM order_items WHERE variant_id IS NOT NULL) THEN
  RAISE EXCEPTION 'VARIANT_PURCHASING_ROLLBACK_WOULD_LOSE_SELECTIONS';
 END IF;
END $$;
DROP INDEX cart_items_cart_product_variant_uq;
DROP INDEX cart_items_cart_product_variant_idx;
DROP INDEX order_items_variant_idx;
ALTER TABLE cart_items DROP COLUMN variant_id;
ALTER TABLE order_items DROP COLUMN variant_id;
CREATE UNIQUE INDEX cart_items_cart_product_uq ON cart_items(cart_id, product_id);
