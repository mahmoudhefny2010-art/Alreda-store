'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { createWishlistRepository } = require('../repositories/wishlist.repository');
const { getPrismaClient } = require('../config/prisma');
const { getDatabaseCatalog } = require('../services/catalog.repository');
const { getProductFromData } = require('../services/product.service');
const { productName, translate } = require('../config/storefront-i18n');
const formatPrice = require('../utils/formatPrice');
const { sameOrigin } = require('./auth.routes');

const UUID = z.uuid();
const identifier = z.string().min(1).max(80).regex(/^[\p{L}\p{N}_-]+$/u);
const mergeSchema = z.object({ identifiers: z.array(identifier).max(100) }).strict();
const guestIdsSchema = z.string().max(8100).transform(value => value ? value.split(',') : []).pipe(z.array(identifier).max(100));

function createWishlistRoutes({ repository = createWishlistRepository(getPrismaClient), catalogProvider = getDatabaseCatalog } = {}) {
  const router = Router();
  router.use(['/api/wishlist', '/wishlist'], (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/wishlist', (req, res) => res.render('layouts/storefront', { title: translate(req.locale, 'wishlistTitle'), contentView: '../storefront/wishlist' }));
  router.get('/api/wishlist/ids', async (req, res) => {
    if (!req.customer) return res.json({ authenticated: false, ids: [] });
    try { return res.json({ authenticated: true, ids: await repository.listIds(req.customer.id) }); }
    catch { return res.status(503).json({ error: 'WISHLIST_UNAVAILABLE' }); }
  });
  router.get('/api/wishlist', async (req, res) => {
    try {
      const localFallback = req.query.local === '1';
      const parsed = req.customer && !localFallback ? z.array(UUID).max(100).safeParse(await repository.listIds(req.customer.id)) : guestIdsSchema.safeParse(req.query.ids || '');
      if (!parsed.success) return res.status(400).json({ error: 'INVALID_WISHLIST' });
      const data = await catalogProvider();
      const byId = new Map([...data.products.values()].flatMap(item => [[item.id, item], [item.sourceId, item]]).filter(([id]) => typeof id === 'string'));
      const items = parsed.data.map(id => {
        const record = byId.get(id);
        if (!record || !record.isAvailable || !record.id) return { id, unavailable: true };
        const detail = getProductFromData(data, record.slug, { locale: req.locale })?.product;
        if (!detail) return { id, unavailable: true };
        const variants = detail.variants.map(variant => ({ id: variant.databaseId || '', title: variant.title, price: variant.currentFormatted,
          compareAt: variant.compareAtFormatted || '', image: variant.gallerySrc || record.gallery[0]?.src || '', available: variant.purchaseEligible === true }));
        const options = detail.optionGroups.map(group => ({ name: group.name, values: group.values.map(choice => ({ value: choice.value, label: choice.displayValue })) }));
        const hasOptions = options.length > 0 || variants.length > 1;
        const chosen = variants.length === 1 && !hasOptions ? variants[0] : null;
        return { id, productId: record.id, unavailable: false, slug: record.slug, href: `/products/${encodeURIComponent(record.slug)}`, name: productName(record, req.locale),
          image: detail.primaryImage?.displaySrc || record.gallery[0]?.displaySrc || '', status: variants.some(v => v.available) ? translate(req.locale, 'available') : translate(req.locale, 'outOfStock'),
          outOfStock: !variants.some(v => v.available), variants, options, hasOptions, selectedVariantId: chosen?.id || '', price: chosen?.price || variants[0]?.price || formatPrice(record.priceEgp || 0, req.locale),
          compareAt: chosen?.compareAt || variants[0]?.compareAt || '', chooseLabel: translate(req.locale, 'wishlistChooseVariant'),
        };
      });
      return res.json({ authenticated: Boolean(req.customer), items });
    } catch { return res.status(503).json({ error: 'WISHLIST_UNAVAILABLE' }); }
  });
  router.post('/api/wishlist/merge', async (req, res) => {
    if (!req.customer) return res.status(401).json({ error: 'SIGN_IN_REQUIRED' });
    if (!sameOrigin(req)) return res.status(403).json({ error: 'REQUEST_ORIGIN_REJECTED' });
    const parsed = mergeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_WISHLIST' });
    try { await repository.merge(req.customer.id, [...new Set(parsed.data.identifiers)]); return res.json({ ok: true, ids: await repository.listIds(req.customer.id) }); }
    catch { return res.status(503).json({ error: 'WISHLIST_UNAVAILABLE' }); }
  });
  router.post('/api/wishlist/items', async (req, res) => {
    if (!req.customer) return res.status(401).json({ error: 'SIGN_IN_REQUIRED' });
    if (!sameOrigin(req)) return res.status(403).json({ error: 'REQUEST_ORIGIN_REJECTED' });
    const parsed = z.object({ productId: UUID }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_WISHLIST_ITEM' });
    try { await repository.add(req.customer.id, parsed.data.productId); return res.json({ ok: true, ids: await repository.listIds(req.customer.id) }); }
    catch (error) { return res.status(error.message === 'PRODUCT_UNAVAILABLE' ? 409 : 503).json({ error: error.message === 'PRODUCT_UNAVAILABLE' ? error.message : 'WISHLIST_UNAVAILABLE' }); }
  });
  router.delete('/api/wishlist/items/:productId', async (req, res) => {
    if (!req.customer) return res.status(401).json({ error: 'SIGN_IN_REQUIRED' });
    if (!sameOrigin(req)) return res.status(403).json({ error: 'REQUEST_ORIGIN_REJECTED' });
    const parsed = UUID.safeParse(req.params.productId);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_WISHLIST_ITEM' });
    try { await repository.remove(req.customer.id, parsed.data); return res.json({ ok: true, ids: await repository.listIds(req.customer.id) }); }
    catch { return res.status(503).json({ error: 'WISHLIST_UNAVAILABLE' }); }
  });
  return router;
}

module.exports = { createWishlistRoutes, mergeSchema, guestIdsSchema };
