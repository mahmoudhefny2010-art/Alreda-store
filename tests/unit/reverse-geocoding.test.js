const express = require('express');
const request = require('supertest');
const { createReverseGeocodingService } = require('../../src/services/reverse-geocoding.service');
const { createLocationRoutes } = require('../../src/routes/location.routes');
const input = { latitude: 30, longitude: 31, locale: 'en' };
const response = properties => ({ ok: true, text: async () => JSON.stringify({ features: [{ properties }] }) });

it('formats real provider address components, uses the free endpoint and caches repeat lookups', async () => {
  const fetchImpl = vi.fn(async () => response({ street: 'Synthetic Street', housenumber: '5', city: 'Cairo', state: 'Cairo', country: 'Egypt' }));
  const service = createReverseGeocodingService({ source: {}, fetchImpl, now: () => 10000 });
  expect(await service.address(input)).toBe('5 Synthetic Street, Cairo, Egypt');
  expect(await service.address(input)).toBe('5 Synthetic Street, Cairo, Egypt');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  const url = fetchImpl.mock.calls[0][0];
  expect(url.hostname).toBe('photon.komoot.io'); expect(url.searchParams.get('lat')).toBe('30'); expect(url.searchParams.get('lang')).toBe('en');
  expect(url.searchParams.has('key')).toBe(false);
  await expect(service.address({ ...input, latitude: 31 })).rejects.toMatchObject({ code: 'ADDRESS_LOOKUP_BUSY' });
});
it('uses local Arabic names without requiring a supported Arabic database translation', async () => {
  const fetchImpl = vi.fn(async () => response({ street: 'شارع تجريبي', city: 'القاهرة', country: 'مصر' }));
  const service = createReverseGeocodingService({ source: {}, fetchImpl });
  expect(await service.address({ ...input, locale: 'ar' })).toBe('شارع تجريبي، القاهرة، مصر');
  expect(fetchImpl.mock.calls[0][0].searchParams.has('lang')).toBe(false);
  expect(fetchImpl.mock.calls[0][1].headers['Accept-Language']).toBe('ar');
});
it('prefers a nearby street over a city centroid instead of returning only the city name', async () => {
  const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => JSON.stringify({ features: [
    { properties: { name: 'Cairo', city: 'Cairo', country: 'Egypt', type: 'city' } },
    { properties: { name: 'Synthetic Street', city: 'Cairo', country: 'Egypt', type: 'street', osm_key: 'highway' } },
  ] }) }));
  expect(await createReverseGeocodingService({ source: {}, fetchImpl }).address(input)).toBe('Synthetic Street, Cairo, Egypt');
});
it('fails safely for missing places, malformed content or upstream failures', async () => {
  for (const fetchImpl of [async () => ({ ok: false }), async () => ({ ok: true, text: async () => '{"features":[]}' }), async () => response({ street: '<script>invalid</script>' }), async () => { throw new Error('private provider diagnostics'); }]) {
    const service = createReverseGeocodingService({ source: {}, fetchImpl });
    await expect(service.address(input)).rejects.toMatchObject({ code: expect.stringMatching(/^ADDRESS_(NOT_FOUND|LOOKUP_UNAVAILABLE)$/) });
  }
});
function app(authenticated = true) {
  const service = { address: vi.fn(async () => 'Synthetic Street, Cairo, Egypt') };
  const application = express(); application.use((req, res, next) => { if (authenticated) req.customer = { id: 'synthetic-verified-user' }; next(); });
  application.use(createLocationRoutes({ service }));
  return { application, service, post: () => request(application).post('/api/checkout/location').set('X-Requested-With', 'alreda-checkout') };
}
it('requires an authenticated session and rejects invalid coordinates and cross-site requests', async () => {
  await app(false).post().send(input).expect(401);
  const a = app();
  for (const body of [{ ...input, latitude: 91 }, { ...input, longitude: '31' }, { ...input, url: 'https://unexpected.invalid' }]) await a.post().send(body).expect(400);
  await a.post().set('Sec-Fetch-Site', 'cross-site').send(input).expect(403);
  expect(a.service.address).not.toHaveBeenCalled();
});
it('accepts rewritten origin only with the non-simple request header and never caches location responses', async () => {
  const a = app();
  const result = await a.post().set('Origin', 'null').send(input).expect(200).expect('Cache-Control', 'no-store');
  expect(result.body.address).toBe('Synthetic Street, Cairo, Egypt');
  await request(a.application).post('/api/checkout/location').set('Origin', 'null').send(input).expect(403);
});
it('limits repeated location lookups from the same verified account', async () => {
  const a = app();
  for (let i = 0; i < 5; i++) await a.post().send(input).expect(200);
  await a.post().send(input).expect(429);
  expect(a.service.address).toHaveBeenCalledTimes(5);
});
