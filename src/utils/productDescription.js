const sanitizeDescription = require('./sanitizeProductDescription');
const sanitizeHtml = require('sanitize-html');
const descriptions = new Map();
function analyzeDescription(value) {
  if (descriptions.has(value)) return descriptions.get(value);
  const html = sanitizeDescription(value);
  const result = Object.freeze({ html, ...contentLanguage(html) });
  // Public text only, keyed by its contents so edits take effect immediately.
  // Bound both entry count and entry size on small free-tier instances.
  if (value.length <= 16384 && html.length <= 16384) {
    if (descriptions.size >= 64) descriptions.delete(descriptions.keys().next().value);
    descriptions.set(value, result);
  }
  return result;
}

function contentLanguage(html) {
  const text = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
  const arabic = (text.match(/[\u0620-\u064a\u066e-\u06d3]/gu) || []).length;
  const english = (text.match(/[a-z]/gi) || []).length;
  return { language: arabic > english ? 'ar' : 'en', readable: Boolean(text.trim()) };
}

// Source descriptions may be bilingual even on the English storefront. Preserve
// every paragraph/table; never mistake a handful of translated option names for
// an absent description, or present the source text as a generated translation.
function productDescription(record, locale = 'en') {
  const candidates = (locale === 'ar'
    ? [record.descriptionArHtml, record.descriptionHtml]
    : [record.descriptionHtml, record.descriptionArHtml])
    .filter(value => typeof value === 'string')
    .map(analyzeDescription)
    .filter(value => value.readable);
  const selected = candidates.find(value => value.language === locale) || candidates[0];
  return selected ? { html: selected.html, language: selected.language, originalLanguage: selected.language !== locale }
    : { html: '', language: locale, originalLanguage: false };
}

module.exports = { productDescription, contentLanguage };
