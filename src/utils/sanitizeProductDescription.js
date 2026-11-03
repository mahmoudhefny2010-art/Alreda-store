const sanitizeHtml = require('sanitize-html');
module.exports = function sanitizeProductDescription(html) {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    allowedAttributes: {},
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
    transformTags: { h1: 'h3', h2: 'h3' },
    exclusiveFilter: frame => ['p', 'h3', 'h4'].includes(frame.tag) && !frame.text.trim(),
  });
};
