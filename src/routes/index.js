const { Router } = require('express');
const router = Router();
router.use('/', require('./storefront/home.routes'));
router.use('/', require('./storefront/category.routes'));
router.use('/', require('./storefront/product.routes'));
module.exports = router;
