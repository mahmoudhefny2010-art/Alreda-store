-- Data-preserving only before source catalog/image rows are imported.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.product_images)
    OR EXISTS (SELECT 1 FROM public.product_variants)
    OR EXISTS (SELECT 1 FROM public.product_categories)
    OR EXISTS (SELECT 1 FROM public.products WHERE source_id IS NOT NULL OR image_url LIKE 'https://res.cloudinary.com/%')
    OR EXISTS (SELECT 1 FROM public.categories WHERE source_id IS NOT NULL OR image_url <> '') THEN
    RAISE EXCEPTION 'Refusing catalog-media rollback after imported data exists; restore from backup or use a forward migration';
  END IF;
END $$;

DROP TABLE public.product_images;
DROP TABLE public.product_variants;
DROP TABLE public.product_categories;
ALTER TABLE public.categories DROP CONSTRAINT categories_cloudinary_image_check;
ALTER TABLE public.categories DROP COLUMN image_url, DROP COLUMN source_id;
ALTER TABLE public.products DROP COLUMN source_id;
COMMIT;
