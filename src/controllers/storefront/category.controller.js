const { z } = require('zod');
const { getDatabaseCollection } = require('../../services/category.service');
const { translate } = require('../../config/storefront-i18n');
const paramsSchema = z.object({ slug: z.string().min(1).max(200).regex(/^[\p{L}\p{N}_-]+$/u).optional() });
const querySchema = z.object({
  q: z.string().trim().max(120).default(''),
  sort: z.enum(['featured', 'price-asc', 'price-desc']).default('featured'),
  page: z.string().regex(/^[1-9]\d{0,4}$/).default('1').transform(Number),
});
exports.show = async (req, res, next) => {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) return next();
  const query = querySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).render('layouts/storefront', { title: translate(req.locale, 'invalidCollectionFilter'),
      contentView: '../errors/500', message: translate(req.locale, 'invalidFilter') });
  }
  let collection;
  try { collection = await getDatabaseCollection(params.data.slug || null, { ...query.data, locale: req.locale }); }
  catch (error) { return next(error); }
  if (!collection || collection.invalidPage) return next();
  res.render('layouts/storefront', { ...collection, title: collection.category.name,
    contentView: '../storefront/category-details' });
};
