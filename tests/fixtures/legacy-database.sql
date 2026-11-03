-- Synthetic test schema for affected legacy tables; NOT a Prisma migration baseline.
-- Column shapes reflect the inspected schema. Runtime tests add inspected CHECK constraints.
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), google_id varchar(160), email varchar(254) NOT NULL UNIQUE,
  name varchar(160) NOT NULL, phone varchar(24), role varchar(24) NOT NULL DEFAULT 'customer',
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_roles (user_id uuid NOT NULL REFERENCES users(id), role varchar(24) NOT NULL, PRIMARY KEY(user_id, role));
CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(80) NOT NULL, name_ar varchar(100) NOT NULL,
  slug varchar(80) NOT NULL UNIQUE, description text NOT NULL DEFAULT '', description_ar text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), category_id uuid REFERENCES categories(id), name varchar(120) NOT NULL,
  name_ar varchar(160) NOT NULL, slug varchar(120) NOT NULL UNIQUE, description text NOT NULL DEFAULT '', description_ar text NOT NULL DEFAULT '',
  price_egp integer NOT NULL, image_url text NOT NULL DEFAULT '', ingredients text NOT NULL DEFAULT '[]',
  is_available boolean NOT NULL DEFAULT true, is_featured boolean NOT NULL DEFAULT false, prep_minutes integer NOT NULL DEFAULT 20,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), sale_price_egp integer
);
CREATE TABLE addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), label varchar(60) NOT NULL DEFAULT 'Home',
  address_line varchar(300) NOT NULL, landmark varchar(200) NOT NULL DEFAULT '', floor varchar(20) NOT NULL DEFAULT '', apartment varchar(20) NOT NULL DEFAULT '',
  phone varchar(24) NOT NULL, latitude numeric(10,7), longitude numeric(10,7), is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE product_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL REFERENCES products(id), option_group varchar(60) NOT NULL,
  name varchar(100) NOT NULL, name_ar varchar(120) NOT NULL, price_delta_egp integer NOT NULL DEFAULT 0, is_available boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, option_group, name)
);
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_number varchar(24) NOT NULL UNIQUE, user_id uuid REFERENCES users(id), address_id uuid REFERENCES addresses(id),
  address_snapshot text NOT NULL, customer_name varchar(160) NOT NULL, customer_phone varchar(24) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'PLACED', fulfillment_type varchar(16) NOT NULL DEFAULT 'DELIVERY', payment_method varchar(24) NOT NULL DEFAULT 'CASH_ON_DELIVERY',
  subtotal_egp integer NOT NULL, delivery_fee_egp integer NOT NULL DEFAULT 0, total_egp integer NOT NULL, notes text NOT NULL DEFAULT '', assigned_driver_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), payment_status varchar(16) NOT NULL DEFAULT 'UNCONFIRMED',
  amount_received_egp numeric(12,2), change_due_egp numeric(12,2), paid_at timestamptz, paid_by uuid REFERENCES users(id), receipt_number bigserial UNIQUE
);
CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id), product_id uuid REFERENCES products(id),
  product_name varchar(120) NOT NULL, quantity integer NOT NULL, unit_price_egp integer NOT NULL, line_total_egp integer NOT NULL,
  options text NOT NULL DEFAULT '[]', is_custom boolean NOT NULL DEFAULT false, product_name_ar varchar(160) NOT NULL DEFAULT ''
);
CREATE TABLE order_requests (
  user_id uuid NOT NULL REFERENCES users(id), request_key uuid NOT NULL, request_hash varchar(64) NOT NULL, order_id uuid NOT NULL REFERENCES orders(id),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id, request_key)
);
CREATE TABLE order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id), status varchar(32) NOT NULL,
  actor_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), note text NOT NULL DEFAULT ''
);
