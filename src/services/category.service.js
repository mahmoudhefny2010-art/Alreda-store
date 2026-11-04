const { catalog, products: productIndex, categories, byCategory, getDatabaseCatalog } = require('./catalog.repository');
const { productCard } = require('../utils/productPreview');
const { categoryName } = require('../config/storefront-i18n');
const pageSize = 24;
function getCollectionFromData(data, slug, { q = '', sort = 'featured', page = 1, locale = 'en' } = {}) {
  const sourceCategory = slug === null ? { name: 'All products', titleEn: 'All products', titleAr: 'Ø¬Ù…ÙŠØ¹ Ø§Ù„Ù…Ù†ØªØ¬Ø§Øª', href: '/products', slug: '', productIds: [...data.products.keys()] } : data.byCategory.get(slug);
  if (!sourceCategory) return null;
  const source = sourceCategory.productIds.map(id => data.products.get(id)).filter(Boolean);
  const displayCategory = { ...sourceCategory, name: categoryName(sourceCategory, locale) };
  const displayCategories = data.categories.map(category => ({ ...category, name: categoryName(category, locale) }));
  const query = q.toLocaleLowerCase(locale === 'ar' ? 'ar' : 'en');
  const matches = source.filter(product => {
    const name = locale === 'ar' ? product.titleAr || product.name : product.titleEn || product.name;
    return [name, product.name, product.titleAr, product.titleEn, product.vendor].filter(Boolean).some(value => value.toLocaleLowerCase(locale === 'ar' ? 'ar' : 'en').includes(query));
  });
  if (sort !== 'featured') {
    const cents = product => BigInt(product.variants[0].priceAmount.replace('.', ''));
    matches.sort((a, b) => { const left = cents(a); const right = cents(b); const result = left < right ? -1 : left > right ? 1 : 0; return sort === 'price-asc' ? result : -result; });
  }
  const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
  if (page > pageCount) return { invalidPage: true };
  const pageHref = number => `${sourceCategory.href}?${new URLSearchParams({ ...(q ? { q } : {}), ...(sort !== 'featured' ? { sort } : {}), page: String(number) })}`;
  const visiblePages = pageCount <= 7 ? Array.from({ length: pageCount }, (_, index) => index + 1)
    : page <= 4 ? [1, 2, 3, 4, 5, null, pageCount]
    : page >= pageCount - 3 ? [1, null, pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount]
    : [1, null, page - 1, page, page + 1, null, pageCount];
  return { persistentCatalog: data.persistent === true, category: displayCategory, categories: displayCategories, q, sort, page, pageCount, matchedCount: matches.length, totalCount: source.length, capturedAt: data.catalog.capturedAt,
    pagination: visiblePages.map(number => ({ number, href: number ? pageHref(number) : null })),
    products: matches.slice((page - 1) * pageSize, page * pageSize).map(product => productCard(product, displayCategory.slug, locale)) };
}
function getCollection(slug, options) { return getCollectionFromData({ catalog, products: productIndex, categories, byCategory }, slug, options); }
async function getDatabaseCollection(slug, options) { return getCollectionFromData(await getDatabaseCatalog(), slug, options); }
module.exports = { getCollection, getCollectionFromData, getDatabaseCollection, pageSize };
