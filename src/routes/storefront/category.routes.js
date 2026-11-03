const { Router } = require('express');
const controller = require('../../controllers/storefront/category.controller');
const router = Router();
router.get('/collections/:slug', controller.show);
router.get('/products', controller.show);
module.exports = router;
