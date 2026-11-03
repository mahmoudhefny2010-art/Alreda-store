BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE orders DROP CONSTRAINT orders_payment_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_check CHECK (payment_method IN ('CASH_ON_DELIVERY','INSTAPAY_ON_DELIVERY','PAY_AT_CASHIER','ONLINE','INSTAPAY'));
CREATE TABLE payment_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  order_id UUID UNIQUE REFERENCES orders(id),
  public_id VARCHAR(240) NOT NULL UNIQUE,
  content_hash VARCHAR(64) NOT NULL UNIQUE,
  format VARCHAR(8) NOT NULL DEFAULT 'png' CHECK (format='png'),
  status VARCHAR(16) NOT NULL DEFAULT 'UPLOADED' CHECK (status IN ('UPLOADED','PENDING','APPROVED','REJECTED')),
  transfer_reference VARCHAR(120) UNIQUE,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT payment_proof_review_check CHECK ((status IN ('APPROVED','REJECTED')) = (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  CONSTRAINT payment_proof_order_check CHECK (status='UPLOADED' OR order_id IS NOT NULL)
);
CREATE INDEX payment_proofs_owner_created_idx ON payment_proofs(user_id,created_at);
COMMIT;
