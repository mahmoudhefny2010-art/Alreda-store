const sanitizeDescription = require('../utils/sanitizeProductDescription');
const terms = require('../config/manual-catalog-terms.json');
const catalog = require('../config/catalog.json');
const { colorOptions } = require('../config/catalog-colors');
const { typeOptions } = require('../config/catalog-types');

const pairs = [...Object.entries(terms.ar), ...Object.entries(terms.en).map(([ar, en]) => [en, ar]),
  ...colorOptions.map(item => [item.en, item.ar]), ...typeOptions.map(item => [item.en, item.ar])];
for (const product of catalog.products) {
  if (product.titleEn && product.titleAr) pairs.push([product.titleEn, product.titleAr]);
  if (product.descriptionHtml && product.descriptionArHtml) pairs.push([product.descriptionHtml, product.descriptionArHtml]);
}
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function translateCatalogText(text, source, rich = false) {
  const clean = rich ? sanitizeDescription(text) : text;
  const entries = pairs.map(([en, ar]) => source === 'en' ? [en, ar] : [ar, en]).filter(([from, to]) => from && to);
  const exact = entries.find(([from]) => from.toLowerCase() === clean.toLowerCase());
  if (exact) return { translated: rich ? sanitizeDescription(exact[1]) : exact[1], complete: true };
  const dictionary = new Map(entries.filter(([from]) => !from.includes('<')).map(([from, to]) => [from.toLowerCase(), to]));
  const pattern = [...dictionary.keys()].sort((a, b) => b.length - a.length).map(escape).join('|');
  const matcher = new RegExp(`(?<![\\p{L}])(?:${pattern})(?![\\p{L}])`, 'giu');
  let unknown = false;
  const translated = clean.split(/(<[^>]+>)/g).map(part => {
    if (part.startsWith('<')) return part;
    // Translate known phrases, but never pretend unknown words were translated.
    let last = 0;
    for (const match of part.matchAll(matcher)) {
      const gap = part.slice(last, match.index);
      if ((source === 'en' ? /[a-z]/i : /[\u0600-\u06ff]/).test(gap)) unknown = true;
      last = match.index + match[0].length;
    }
    if ((source === 'en' ? /[a-z]/i : /[\u0600-\u06ff]/).test(part.slice(last))) unknown = true;
    return part.replace(matcher, match => dictionary.get(match.toLowerCase()));
  }).join('');
  return { translated: unknown ? null : translated, complete: !unknown };
}
module.exports = { translateCatalogText };
