const dictionary = require('../config/manual-catalog-terms.json');
const entries = Object.fromEntries(Object.entries(dictionary).map(([locale, terms]) =>
  [locale, Object.entries(terms).sort(([left], [right]) => right.length - left.length)]));
function localizeCatalogText(value, locale = 'en') {
  let result = String(value || '');
  for (const [source, target] of entries[locale] || []) result = result.replaceAll(source, target);
  return result;
}
module.exports = { localizeCatalogText };
