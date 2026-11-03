-- Disposable/test databases only. Refuse to discard any feature data.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM admin_access_grants) OR EXISTS(SELECT 1 FROM admin_audit_events)
 OR EXISTS(SELECT 1 FROM catalog_details) OR EXISTS(SELECT 1 FROM discount_rules)
 THEN RAISE EXCEPTION 'ADMIN_DATA_PRESENT_USE_FORWARD_RECOVERY'; END IF;
END $$;
DROP TABLE discount_rules;
DROP TABLE catalog_details;
DROP TABLE admin_audit_events;
DROP TABLE admin_access_grants;
