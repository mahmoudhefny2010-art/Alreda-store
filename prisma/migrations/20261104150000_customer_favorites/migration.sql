CREATE TABLE "customer_favorites" (
  "user_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_favorites_pk" PRIMARY KEY ("user_id", "product_id"),
  CONSTRAINT "customer_favorites_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "customer_favorites_product_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "customer_favorites_user_created_idx" ON "customer_favorites"("user_id", "created_at");
