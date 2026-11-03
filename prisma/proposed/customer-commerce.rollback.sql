-- Empty disposable/reviewed databases only. Never discard customer/cart data.
BEGIN;
DO $$
DECLARE table_name text; has_data boolean;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['auth_rate_limits','customer_sessions','shopping_carts','cart_items','notification_preferences','notification_outbox','notification_attempts','cart_reminders']
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', table_name) INTO has_data;
    IF has_data THEN RAISE EXCEPTION 'CUSTOMER_COMMERCE_ROLLBACK_REQUIRES_EMPTY_TABLES'; END IF;
  END LOOP;
END $$;
DROP TABLE notification_attempts;
DROP TABLE notification_outbox;
DROP TABLE cart_reminders;
DROP TABLE notification_preferences;
DROP TABLE cart_items;
DROP TABLE shopping_carts;
DROP TABLE customer_sessions;
DROP TABLE auth_rate_limits;
COMMIT;
