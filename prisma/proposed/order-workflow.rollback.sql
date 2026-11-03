-- Only reversible before the new fields contain meaningful data.
-- Once used, preserve data and deploy a forward fix instead.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.products, public.orders, public.payment_receipts IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.payment_receipts)
     OR EXISTS (SELECT 1 FROM public.orders WHERE payment_method = 'ONLINE' OR payment_provider_reference IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.products WHERE stock_quantity IS NOT NULL) THEN
    RAISE EXCEPTION 'Forward recovery required: workflow data exists';
  END IF;
END $$;
DROP TABLE public.payment_receipts;
ALTER TABLE public.orders DROP CONSTRAINT orders_payment_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_check CHECK (payment_method IN ('CASH_ON_DELIVERY', 'INSTAPAY_ON_DELIVERY', 'PAY_AT_CASHIER'));
ALTER TABLE public.orders DROP CONSTRAINT orders_payment_received_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_received_check CHECK (
  payment_status <> 'PAID' OR (paid_at IS NOT NULL AND paid_by IS NOT NULL
    AND amount_received_egp IS NOT NULL AND change_due_egp IS NOT NULL
    AND amount_received_egp >= total_egp AND change_due_egp = amount_received_egp - total_egp)
);
ALTER TABLE public.orders DROP COLUMN payment_provider_reference;
ALTER TABLE public.products DROP CONSTRAINT products_stock_nonnegative;
ALTER TABLE public.products DROP COLUMN stock_quantity;
COMMIT;
