const { Router } = require('express');
const dashboard = require('../../controllers/admin/dashboard.controller');
const router = Router();
router.get('/', dashboard.index);
module.exports = router;
