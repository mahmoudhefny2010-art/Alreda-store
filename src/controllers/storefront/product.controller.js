const { z } = require('zod');
const { getDatabaseProduct } = require('../../services/product.service');
const { translate } = require('../../config/storefront-i18n');
const slugSchema = z.string().min(1).max(200).regex(/^[\p{L}\p{N}_-]+$/u);
const paramsSchema = z.object({ slug: slugSchema });
const querySchema = z.object({ variant: z.string().max(80).regex(/^[A-Za-z0-9_-]+$/).optional(), collection: slugSchema.optional() });
exports.show = async (req, res, next) => {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) return next();
  const query = querySchema.safeParse(req.query);
  let page = null;
  try { if (query.success) page = await getDatabaseProduct(params.data.slug, { ...query.data, locale: req.locale }); }
  catch (error) { return next(error); }
  if (!query.success || page?.invalidSelection) {
    return res.status(400).render('layouts/storefront', { title: translate(req.locale, 'invalidProductSelection'), contentView: '../errors/500', message: translate(req.locale, 'invalidProduct') });
  }
  if (!page) return next();
  res.render('layouts/storefront', { ...page, title: page.product.name, contentView: '../storefront/product-details' });
};
