const { Router } = require('express');
const controller = require('../../controllers/storefront/product.controller');
const router = Router();
router.get('/products/:slug', controller.show);
module.exports = router;
