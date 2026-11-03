-- PROPOSED ONLY: existing Neon is Knex-managed and has no Prisma baseline.
-- Review/baseline first; explicitly authorize shared-database application.
-- NULL stock means unconfigured and cannot be sold. No quantities are invented.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE public.products ADD COLUMN stock_quantity integer;
ALTER TABLE public.products ADD CONSTRAINT products_stock_nonnegative CHECK (stock_quantity IS NULL OR stock_quantity >= 0);
ALTER TABLE public.orders ADD COLUMN payment_provider_reference varchar(240);
ALTER TABLE public.orders DROP CONSTRAINT orders_payment_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_check CHECK (payment_method IN ('CASH_ON_DELIVERY', 'INSTAPAY_ON_DELIVERY', 'PAY_AT_CASHIER', 'ONLINE'));
ALTER TABLE public.orders DROP CONSTRAINT orders_payment_received_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_received_check CHECK (
  payment_status <> 'PAID' OR (paid_at IS NOT NULL AND (paid_by IS NOT NULL OR payment_provider_reference IS NOT NULL)
    AND amount_received_egp IS NOT NULL AND change_due_egp IS NOT NULL
    AND amount_received_egp >= total_egp AND change_due_egp = amount_received_egp - total_egp)
);
CREATE TABLE public.payment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
  provider varchar(64) NOT NULL,
  event_id varchar(160) NOT NULL,
  payment_reference varchar(160) NOT NULL,
  amount_egp integer NOT NULL CHECK (amount_egp > 0),
  currency varchar(3) NOT NULL CHECK (currency = 'EGP'),
  verified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, event_id),
  UNIQUE(provider, payment_reference)
);
COMMIT;
