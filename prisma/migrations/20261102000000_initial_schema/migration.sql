-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "label" VARCHAR(60) NOT NULL DEFAULT 'Home',
    "address_line" VARCHAR(300) NOT NULL,
    "landmark" VARCHAR(200) NOT NULL DEFAULT '',
    "floor" VARCHAR(20) NOT NULL DEFAULT '',
    "apartment" VARCHAR(20) NOT NULL DEFAULT '',
    "phone" VARCHAR(24) NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(80) NOT NULL,
    "name_ar" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "description_ar" TEXT NOT NULL DEFAULT '',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "manual_code_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_locations" (
    "id" BIGSERIAL NOT NULL,
    "order_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knex_migrations" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "batch" INTEGER,
    "migration_time" TIMESTAMPTZ(6),

    CONSTRAINT "knex_migrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knex_migrations_lock" (
    "index" SERIAL NOT NULL,
    "is_locked" INTEGER,

    CONSTRAINT "knex_migrations_lock_pkey" PRIMARY KEY ("index")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "product_id" UUID,
    "product_name" VARCHAR(120) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_egp" INTEGER NOT NULL,
    "line_total_egp" INTEGER NOT NULL,
    "options" TEXT NOT NULL DEFAULT '[]',
    "is_custom" BOOLEAN NOT NULL DEFAULT false,
    "product_name_ar" VARCHAR(160) NOT NULL DEFAULT '',

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_requests" (
    "user_id" UUID NOT NULL,
    "request_key" UUID NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "order_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_requests_pkey" PRIMARY KEY ("user_id","request_key")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_number" VARCHAR(24) NOT NULL,
    "user_id" UUID,
    "address_id" UUID,
    "address_snapshot" TEXT NOT NULL,
    "customer_name" VARCHAR(160) NOT NULL,
    "customer_phone" VARCHAR(24) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'PLACED',
    "fulfillment_type" VARCHAR(16) NOT NULL DEFAULT 'DELIVERY',
    "payment_method" VARCHAR(24) NOT NULL DEFAULT 'CASH_ON_DELIVERY',
    "subtotal_egp" INTEGER NOT NULL,
    "delivery_fee_egp" INTEGER NOT NULL DEFAULT 0,
    "total_egp" INTEGER NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "assigned_driver_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payment_status" VARCHAR(16) NOT NULL DEFAULT 'UNCONFIRMED',
    "amount_received_egp" DECIMAL(12,2),
    "change_due_egp" DECIMAL(12,2),
    "paid_at" TIMESTAMPTZ(6),
    "paid_by" UUID,
    "receipt_number" BIGSERIAL NOT NULL,
    "payment_provider_reference" VARCHAR(240),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_options" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "option_group" VARCHAR(60) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "name_ar" VARCHAR(120) NOT NULL,
    "price_delta_egp" INTEGER NOT NULL DEFAULT 0,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "name_ar" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "description_ar" TEXT NOT NULL DEFAULT '',
    "price_egp" INTEGER NOT NULL,
    "image_url" TEXT NOT NULL DEFAULT '',
    "ingredients" TEXT NOT NULL DEFAULT '[]',
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "prep_minutes" INTEGER NOT NULL DEFAULT 20,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sale_price_egp" INTEGER,
    "stock_quantity" INTEGER,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "event_id" VARCHAR(160) NOT NULL,
    "payment_reference" VARCHAR(160) NOT NULL,
    "amount_egp" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "verified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscribers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "external_id" VARCHAR(80) NOT NULL,
    "onesignal_subscription_id" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_copy" (
    "source_text" VARCHAR(500) NOT NULL,
    "value_en" TEXT NOT NULL DEFAULT '',
    "value_ar" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_copy_pkey" PRIMARY KEY ("source_text")
);

-- CreateTable
CREATE TABLE "site_page_views" (
    "id" BIGSERIAL NOT NULL,
    "visitor_key" VARCHAR(64) NOT NULL,
    "user_id" UUID,
    "path" VARCHAR(160) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_page_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_settings" (
    "setting_key" VARCHAR(120) NOT NULL,
    "value_en" TEXT NOT NULL DEFAULT '',
    "value_ar" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("setting_key")
);

-- CreateTable
CREATE TABLE "site_visitors" (
    "visitor_key" VARCHAR(64) NOT NULL,
    "user_id" UUID,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visit_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "site_visitors_pkey" PRIMARY KEY ("visitor_key")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role" VARCHAR(24) NOT NULL,

    CONSTRAINT "user_roles_pk" PRIMARY KEY ("user_id","role")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "google_id" VARCHAR(160),
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(24),
    "role" VARCHAR(24) NOT NULL DEFAULT 'customer',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "addresses_user_default_idx" ON "addresses"("user_id", "is_default");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_unique" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_tokens_token_hash_unique" ON "delivery_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "delivery_tokens_valid_idx" ON "delivery_tokens"("order_id", "expires_at", "used_at");

-- CreateIndex
CREATE INDEX "driver_locations_order_recorded_idx" ON "driver_locations"("order_id", "recorded_at");

-- CreateIndex
CREATE INDEX "order_events_order_created_idx" ON "order_events"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "order_items_order_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_requests_order_idx" ON "order_requests"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_unique" ON "orders"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_receipt_number_unique" ON "orders"("receipt_number");

-- CreateIndex
CREATE INDEX "orders_created_id_idx" ON "orders"("created_at", "id");

-- CreateIndex
CREATE INDEX "orders_driver_created_idx" ON "orders"("assigned_driver_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "orders_driver_status_idx" ON "orders"("assigned_driver_id", "status");

-- CreateIndex
CREATE INDEX "orders_status_created_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "orders_user_created_idx" ON "orders"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "product_options_product_group_idx" ON "product_options"("product_id", "option_group", "is_available");

-- CreateIndex
CREATE UNIQUE INDEX "product_options_group_name_uq" ON "product_options"("product_id", "option_group", "name");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_unique" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_available_featured_idx" ON "products"("is_available", "is_featured");

-- CreateIndex
CREATE INDEX "products_category_available_idx" ON "products"("category_id", "is_available");

-- CreateIndex
CREATE UNIQUE INDEX "payment_receipts_order_id_key" ON "payment_receipts"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_receipts_provider_event_id_key" ON "payment_receipts"("provider", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_receipts_provider_payment_reference_key" ON "payment_receipts"("provider", "payment_reference");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscribers_onesignal_subscription_id_unique" ON "push_subscribers"("onesignal_subscription_id");

-- CreateIndex
CREATE INDEX "push_subscribers_user_idx" ON "push_subscribers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscribers_user_subscription_uq" ON "push_subscribers"("user_id", "onesignal_subscription_id");

-- CreateIndex
CREATE INDEX "site_page_views_created_path_idx" ON "site_page_views"("created_at", "path");

-- CreateIndex
CREATE INDEX "site_page_views_user_created_idx" ON "site_page_views"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "site_page_views_visitor_created_idx" ON "site_page_views"("visitor_key", "created_at");

-- CreateIndex
CREATE INDEX "site_visitors_seen_idx" ON "site_visitors"("last_seen_at");

-- CreateIndex
CREATE INDEX "site_visitors_user_seen_idx" ON "site_visitors"("user_id", "last_seen_at");

-- CreateIndex
CREATE INDEX "user_roles_role_user_idx" ON "user_roles"("role", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_uq" ON "users"("google_id") WHERE (google_id IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_unique" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_active_idx" ON "users"("role", "is_active");

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "delivery_tokens" ADD CONSTRAINT "delivery_tokens_order_id_foreign" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "driver_locations" ADD CONSTRAINT "driver_locations_driver_id_foreign" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "driver_locations" ADD CONSTRAINT "driver_locations_order_id_foreign" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_id_foreign" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_foreign" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_foreign" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_foreign" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_order_id_foreign" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_address_id_foreign" FOREIGN KEY ("address_id") REFERENCES "addresses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_assigned_driver_id_foreign" FOREIGN KEY ("assigned_driver_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_paid_by_foreign" FOREIGN KEY ("paid_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_product_id_foreign" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_foreign" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "push_subscribers" ADD CONSTRAINT "push_subscribers_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "site_page_views" ADD CONSTRAINT "site_page_views_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "site_visitors" ADD CONSTRAINT "site_visitors_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Prisma schema does not model PostgreSQL CHECK constraints. Keep the guards
-- required by the order and catalog services in this initial database schema.
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_check"
    CHECK ("payment_method" IN ('CASH_ON_DELIVERY', 'INSTAPAY_ON_DELIVERY', 'PAY_AT_CASHIER', 'ONLINE'));
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_status_check"
    CHECK ("payment_status" IN ('UNCONFIRMED', 'UNPAID', 'PAID'));
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_received_check"
    CHECK ("payment_status" <> 'PAID' OR (
        "paid_at" IS NOT NULL
        AND ("paid_by" IS NOT NULL OR "payment_provider_reference" IS NOT NULL)
        AND "amount_received_egp" IS NOT NULL
        AND "change_due_egp" IS NOT NULL
        AND "amount_received_egp" >= "total_egp"
        AND "change_due_egp" = "amount_received_egp" - "total_egp"
    ));
ALTER TABLE "orders" ADD CONSTRAINT "orders_address_json"
    CHECK ("address_snapshot"::jsonb IS NOT NULL);
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_check"
    CHECK ("subtotal_egp" >= 0 AND "delivery_fee_egp" >= 0 AND "total_egp" >= 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_amounts_check"
    CHECK ("quantity" > 0 AND "unit_price_egp" >= 0 AND "line_total_egp" >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_price_check"
    CHECK ("price_egp" > 0);
ALTER TABLE "products" ADD CONSTRAINT "products_sale_check"
    CHECK ("sale_price_egp" IS NULL OR ("sale_price_egp" > 0 AND "sale_price_egp" < "price_egp"));
ALTER TABLE "products" ADD CONSTRAINT "products_stock_nonnegative"
    CHECK ("stock_quantity" IS NULL OR "stock_quantity" >= 0);
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_amount_check"
    CHECK ("amount_egp" > 0);
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_currency_check"
    CHECK ("currency" = 'EGP');
