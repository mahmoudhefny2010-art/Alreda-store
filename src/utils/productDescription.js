const sanitizeDescription = require('./sanitizeProductDescription');
const sanitizeHtml = require('sanitize-html');

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
    .map(sanitizeDescription)
    .map(html => ({ html, ...contentLanguage(html) }))
    .filter(value => value.readable);
  const selected = candidates.find(value => value.language === locale) || candidates[0];
  return selected ? { html: selected.html, language: selected.language, originalLanguage: selected.language !== locale }
    : { html: '', language: locale, originalLanguage: false };
}

module.exports = { productDescription, contentLanguage };
