const { Router } = require('express');
const home = require('../../controllers/storefront/home.controller');
const router = Router();
router.get('/', home.index);
module.exports = router;
