const { z } = require('zod');
const field = z.string().trim().max(200).refine(value => !/[<>]/.test(value) && [...value].every(char => char.codePointAt(0) >= 32 && char.codePointAt(0) !== 127)).nullish();
const propertiesSchema = z.object({ name: field, street: field, housenumber: field, locality: field, district: field, city: field, county: field, state: field, country: field, countrycode: field, type: field, osm_key: field });
function locationError(code = 'ADDRESS_LOOKUP_UNAVAILABLE') { const error = new Error(code); error.code = code; return error; }
function createReverseGeocodingService({ source = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const endpoint = new URL(source.REVERSE_GEOCODING_URL || 'https://photon.komoot.io/reverse');
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error('INVALID_GEOCODING_CONFIGURATION');
  let nextRequestAt = 0;
  const cache = new Map();
  return {
    async address({ latitude, longitude, locale }) {
      const key = `${latitude.toFixed(5)}:${longitude.toFixed(5)}:${locale}`;
      const cached = cache.get(key);
      if (cached && cached.expires > now()) return cached.address;
      if (now() < nextRequestAt) throw locationError('ADDRESS_LOOKUP_BUSY');
      nextRequestAt = now() + 1100;
      const url = new URL(endpoint);
      url.searchParams.set('lat', String(latitude)); url.searchParams.set('lon', String(longitude)); url.searchParams.set('limit', '5');
      if (locale === 'en') url.searchParams.set('lang', 'en');
      try {
        const response = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'AlredaStore/1.0 (delivery address lookup)', ...(locale === 'ar' ? { 'Accept-Language': 'ar' } : {}) }, signal: AbortSignal.timeout(6000), redirect: 'error' });
        if (!response.ok) throw locationError();
        const raw = await response.text();
        if (raw.length > 100000) throw locationError();
        const payload = z.object({ features: z.array(z.object({ properties: propertiesSchema })).max(5) }).parse(JSON.parse(raw));
        const score = p => (p.street ? 3 : 0) + (p.housenumber ? 2 : 0) + (p.type === 'street' || p.osm_key === 'highway' ? 4 : 0);
        const p = payload.features.map(feature => feature.properties).sort((left, right) => score(right) - score(left))[0];
        if (!p) throw locationError('ADDRESS_NOT_FOUND');
        const street = [p.housenumber, p.street || (p.type === 'street' || p.osm_key === 'highway' ? p.name : '')].filter(Boolean).join(' ');
        const parts = [street || p.name, p.locality, p.district, p.city || p.county, p.state, p.country].filter(Boolean);
        const address = [...new Set(parts)].join(locale === 'ar' ? '، ' : ', ').slice(0, 300);
        if (address.length < 5) throw locationError('ADDRESS_NOT_FOUND');
        if (cache.size >= 100) cache.delete(cache.keys().next().value);
        cache.set(key, { address, expires: now() + 300000 });
        return address;
      } catch (error) {
        if (['ADDRESS_NOT_FOUND', 'ADDRESS_LOOKUP_BUSY'].includes(error.code)) throw error;
        throw locationError();
      }
    },
  };
}
module.exports = { createReverseGeocodingService };
