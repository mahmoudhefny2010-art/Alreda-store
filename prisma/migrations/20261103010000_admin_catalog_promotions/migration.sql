-- Additive access grants, bilingual catalogue details, promotions and audit history.
CREATE TABLE admin_access_grants (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email VARCHAR(254) NOT NULL UNIQUE,
 role VARCHAR(32) NOT NULL CHECK (role IN ('admin','catalog_manager','order_manager')),
 is_active BOOLEAN NOT NULL DEFAULT true, created_by UUID NOT NULL,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
 CHECK (email = lower(email))
);
CREATE TABLE admin_audit_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), actor_id UUID NOT NULL,
 action VARCHAR(64) NOT NULL, target_id VARCHAR(254) NOT NULL,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_created_idx ON admin_audit_events(created_at);
CREATE TABLE catalog_details (
 product_id UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
 color_en VARCHAR(80) NOT NULL DEFAULT '', color_ar VARCHAR(100) NOT NULL DEFAULT '',
 type_en VARCHAR(100) NOT NULL DEFAULT '', type_ar VARCHAR(120) NOT NULL DEFAULT ''
);
CREATE INDEX catalog_details_type_color_idx ON catalog_details(type_en, color_en);
CREATE TABLE discount_rules (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(120) NOT NULL, name_ar VARCHAR(160) NOT NULL,
 mode VARCHAR(16) NOT NULL CHECK (mode IN ('PERCENT','FIXED')), amount INTEGER NOT NULL,
 scope VARCHAR(16) NOT NULL CHECK (scope IN ('ALL','PRODUCT','CATEGORY','TYPE','COLOR')), target VARCHAR(160) NOT NULL DEFAULT '',
 starts_at TIMESTAMPTZ(6) NOT NULL, ends_at TIMESTAMPTZ(6) NOT NULL,
 is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
 CHECK(amount > 0 AND (mode <> 'PERCENT' OR amount <= 100)), CHECK(ends_at > starts_at),
 CHECK(scope = 'ALL' OR length(target) > 0)
);
CREATE INDEX discount_rules_active_idx ON discount_rules(is_active, starts_at, ends_at);
