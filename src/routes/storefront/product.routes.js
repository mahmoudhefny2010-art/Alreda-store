const { Router } = require('express');
const { z } = require('zod');
const controller = require('../../controllers/storefront/product.controller');
const { searchCatalogProducts } = require('../../services/catalog.repository');
const router = Router();
router.get('/api/products/search', async (req, res) => {
  const input = z.object({ q: z.string().trim().min(2).max(80) }).strict().safeParse(req.query);
  if (!input.success) return res.status(400).json({ products: [] });
  const products = await searchCatalogProducts(input.data.q, req.locale);
  return res.set('Cache-Control', 'private, no-store').json({ products });
});
router.get('/products/:slug', controller.show);
module.exports = router;
