-- Additive customer identity, persistent carts, preferences and notification outbox.
-- Existing order, product and customer records are preserved.
CREATE TABLE "auth_rate_limits" (
  "key_hash" VARCHAR(64) NOT NULL,
  "window_start" TIMESTAMPTZ(6) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_rate_limits_pk" PRIMARY KEY ("key_hash", "window_start")
);
CREATE INDEX "auth_rate_limits_window_idx" ON "auth_rate_limits"("window_start");

CREATE TABLE "customer_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "token_hash" VARCHAR(64) NOT NULL,
  "user_id" UUID NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "customer_sessions_token_hash_uq" ON "customer_sessions"("token_hash");
CREATE INDEX "customer_sessions_user_expiry_idx" ON "customer_sessions"("user_id", "expires_at");
CREATE INDEX "customer_sessions_expiry_idx" ON "customer_sessions"("expires_at");

CREATE TABLE "shopping_carts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "guest_token_hash" VARCHAR(64),
  "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shopping_carts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shopping_carts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "shopping_carts_status_check" CHECK ("status" IN ('ACTIVE','CONVERTED')),
  CONSTRAINT "shopping_carts_owner_check" CHECK ("user_id" IS NOT NULL OR "guest_token_hash" IS NOT NULL)
);
CREATE UNIQUE INDEX "shopping_carts_guest_token_hash_uq" ON "shopping_carts"("guest_token_hash");
CREATE INDEX "shopping_carts_user_status_updated_idx" ON "shopping_carts"("user_id", "status", "updated_at");
CREATE INDEX "shopping_carts_status_updated_idx" ON "shopping_carts"("status", "updated_at");

CREATE TABLE "cart_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cart_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "shopping_carts"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "cart_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "cart_items_quantity_check" CHECK ("quantity" BETWEEN 1 AND 99)
);
CREATE UNIQUE INDEX "cart_items_cart_product_uq" ON "cart_items"("cart_id", "product_id");
CREATE INDEX "cart_items_product_idx" ON "cart_items"("product_id");

CREATE TABLE "notification_preferences" (
  "user_id" UUID NOT NULL,
  "transactional_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "marketing_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "notification_outbox" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "order_id" UUID,
  "reminder_id" UUID,
  "event_type" VARCHAR(40) NOT NULL,
  "dedupe_key" VARCHAR(200) NOT NULL,
  "payload" JSONB NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "locked_until" TIMESTAMPTZ(6),
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sent_at" TIMESTAMPTZ(6),
  "last_error_code" VARCHAR(64) NOT NULL DEFAULT '',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_outbox_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "notification_outbox_status_check" CHECK ("status" IN ('PENDING','SENDING','SENT','DEAD'))
);
CREATE UNIQUE INDEX "notification_outbox_dedupe_uq" ON "notification_outbox"("dedupe_key");
CREATE INDEX "notification_outbox_pending_idx" ON "notification_outbox"("status", "available_at", "created_at");
CREATE INDEX "notification_outbox_user_created_idx" ON "notification_outbox"("user_id", "created_at");

CREATE TABLE "notification_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "outbox_id" UUID NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "provider_message_id" VARCHAR(160) NOT NULL DEFAULT '',
  "error_code" VARCHAR(64) NOT NULL DEFAULT '',
  "attempted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_attempts_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "notification_outbox"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "notification_attempts_outbox_time_idx" ON "notification_attempts"("outbox_id", "attempted_at");

CREATE TABLE "cart_reminders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cart_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'SCHEDULED',
  "run_after" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cart_reminders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cart_reminders_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "shopping_carts"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "cart_reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "cart_reminders_status_check" CHECK ("status" IN ('SCHEDULED','SENT','CANCELLED'))
);
CREATE UNIQUE INDEX "cart_reminders_cart_uq" ON "cart_reminders"("cart_id");
CREATE INDEX "cart_reminders_due_idx" ON "cart_reminders"("status", "run_after");
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "cart_reminders"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
CREATE UNIQUE INDEX "notification_outbox_reminder_uq" ON "notification_outbox"("reminder_id");

