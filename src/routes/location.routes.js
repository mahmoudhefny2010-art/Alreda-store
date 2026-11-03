const { Router, json } = require('express');
const { z } = require('zod');
const { sameOrigin } = require('./auth.routes');
const { createReverseGeocodingService } = require('../services/reverse-geocoding.service');
const inputSchema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), locale: z.enum(['en', 'ar']) }).strict();
function createLocationRoutes({ service = createReverseGeocodingService(), now = Date.now } = {}) {
  const router = Router(), requests = new Map();
  router.post('/api/checkout/location', json({ limit: '1kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.customer?.id) return res.status(401).json({ code: 'AUTHENTICATION_REQUIRED' });
    // JSON + a custom header cannot be submitted cross-origin without a CORS
    // preflight. No cross-origin access is enabled; rewritten Origin is supported.
    if (req.get('sec-fetch-site') === 'cross-site' || !req.is('application/json') || !sameOrigin(req) && req.get('x-requested-with') !== 'alreda-checkout') return res.status(403).json({ code: 'REQUEST_ORIGIN_REJECTED' });
    const input = inputSchema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ code: 'INVALID_LOCATION' });
    const instant = now(), prior = requests.get(req.customer.id) || [];
    const recent = prior.filter(time => time > instant - 60000);
    if (recent.length >= 5) return res.status(429).set('Retry-After', '60').json({ code: 'ADDRESS_LOOKUP_BUSY' });
    if (requests.size >= 1000) for (const [key, times] of requests) if (times.every(time => time <= instant - 60000)) requests.delete(key);
    if (requests.size >= 1000 && !requests.has(req.customer.id)) return res.status(429).json({ code: 'ADDRESS_LOOKUP_BUSY' });
    requests.set(req.customer.id, [...recent, instant]);
    try { return res.json({ address: await service.address(input.data) }); }
    catch (error) { return res.status(error.code === 'ADDRESS_LOOKUP_BUSY' ? 429 : 503).json({ code: error.code === 'ADDRESS_NOT_FOUND' ? 'ADDRESS_NOT_FOUND' : 'ADDRESS_LOOKUP_UNAVAILABLE' }); }
  });
  return router;
}
module.exports = { createLocationRoutes };
