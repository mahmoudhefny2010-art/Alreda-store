-- Add editable homepage sections and collection ordering without changing product/category data.
CREATE TABLE storefront_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(80) NOT NULL UNIQUE,
  title_en VARCHAR(100) NOT NULL,
  title_ar VARCHAR(120) NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX storefront_sections_display_idx ON storefront_sections(is_active, display_order);

ALTER TABLE categories ADD COLUMN home_section_id UUID;
ALTER TABLE categories ADD COLUMN homepage_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD CONSTRAINT categories_home_section_fk
  FOREIGN KEY (home_section_id) REFERENCES storefront_sections(id) ON DELETE SET NULL ON UPDATE NO ACTION;
CREATE INDEX categories_home_order_idx ON categories(home_section_id, homepage_order);

INSERT INTO storefront_sections (id, slug, title_en, title_ar, display_order) VALUES
  ('00000000-0000-4000-8000-000000000101', 'home-primary', 'Collections', 'المجموعات', 0),
  ('00000000-0000-4000-8000-000000000102', 'home-secondary', 'Collections', 'مجموعات أخرى', 1);

UPDATE categories SET home_section_id = '00000000-0000-4000-8000-000000000101', homepage_order = CASE slug
  WHEN 'individual-pieces' THEN 0 WHEN 'accessories-sets' THEN 1 WHEN 'mirrors' THEN 2
  WHEN 'mirror-stand' THEN 3 WHEN 'paper-holder' THEN 4 WHEN 'soap-holder' THEN 5
  WHEN 'soap-dispensers' THEN 6 WHEN 'bathroom-clothes-hooks' THEN 7 WHEN 'bathtub-grab-bar' THEN 8
  WHEN 'bathroom-shelves' THEN 9 WHEN 'towel-holders' THEN 10 WHEN 'toilet-brush' THEN 11
  WHEN 'hand-dryers' THEN 12 WHEN 'hair-dryers' THEN 13 WHEN 'door-stoppers' THEN 14 ELSE homepage_order END
WHERE slug IN ('individual-pieces','accessories-sets','mirrors','mirror-stand','paper-holder','soap-holder','soap-dispensers','bathroom-clothes-hooks','bathtub-grab-bar','bathroom-shelves','towel-holders','toilet-brush','hand-dryers','hair-dryers','door-stoppers');
UPDATE categories SET home_section_id = '00000000-0000-4000-8000-000000000102', homepage_order = CASE slug
  WHEN 'safe-boxes' THEN 0 WHEN 'door-handles' THEN 1 WHEN 'waste-bins' THEN 2 ELSE homepage_order END
WHERE slug IN ('safe-boxes','door-handles','waste-bins');

-- Keep other existing categories visible after the reference groups, in a stable order.
WITH remaining AS (
  SELECT id, 100 + row_number() OVER (ORDER BY created_at, slug) AS position
  FROM categories WHERE home_section_id IS NULL
)
UPDATE categories AS category
SET home_section_id = '00000000-0000-4000-8000-000000000102', homepage_order = remaining.position
FROM remaining WHERE category.id = remaining.id;
