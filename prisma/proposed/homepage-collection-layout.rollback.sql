-- Reverses the homepage layout feature. This removes the saved section names and order preferences.
ALTER TABLE categories DROP CONSTRAINT categories_home_section_fk;
DROP INDEX categories_home_order_idx;
ALTER TABLE categories DROP COLUMN home_section_id;
ALTER TABLE categories DROP COLUMN homepage_order;
DROP TABLE storefront_sections;
