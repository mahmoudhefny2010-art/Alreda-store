const sourceProducts = new Map(require('../config/catalog.json').products.map(product => [product.sourceId, product]));
function classification(product) {
  const source = sourceProducts.get(product.source_id);
  const colorIndex = source?.options?.findIndex(option => /colou?r/i.test(option.name)) ?? -1;
  const sourceColor = source?.variants?.length === 1 && colorIndex >= 0 ? source.variants[0].options[colorIndex] : '';
  return { type_en: product.catalog_details?.type_en || source?.productType || '', color_en: product.catalog_details?.color_en || sourceColor || '' };
}
function matches(product, rule) {
  const target = rule.target.trim().toLowerCase();
  if (rule.scope === 'ALL') return true;
  if (rule.scope === 'PRODUCT') return product.id === rule.target;
  if (rule.scope === 'CATEGORY') return product.category_id === rule.target || product.product_categories?.some(link => link.category_id === rule.target);
  if (rule.scope === 'TYPE') return classification(product).type_en.toLowerCase() === target;
  if (rule.scope === 'COLOR') return classification(product).color_en.split(/[,;|/]+/).some(color => color.trim().toLowerCase() === target);
  return false;
}
function effectivePrice(product, rules = [], now = new Date(), basePrice = product.price_egp, existingSale = product.sale_price_egp) {
  const regularCents = Math.round(Number(basePrice) * 100);
  let cents = Math.min(regularCents, existingSale == null ? regularCents : Math.round(Number(existingSale) * 100));
  for (const rule of rules) {
    if (!rule.is_active || new Date(rule.starts_at) > now || new Date(rule.ends_at) <= now || !matches(product, rule)) continue;
    const discounted = rule.mode === 'PERCENT' ? Math.floor(regularCents * (100 - rule.amount) / 100) : regularCents - rule.amount * 100;
    cents = Math.min(cents, Math.max(100, discounted));
  }
  // Existing checkout stores whole EGP; campaign rounding is explicit and consistent.
  return Number.isInteger(Number(basePrice)) ? Math.max(1, Math.floor(cents / 100)) : Math.max(1, cents / 100);
}
async function activeDiscounts(db, now = new Date()) {
  return db.discount_rules.findMany({ where: { is_active: true, starts_at: { lte: now }, ends_at: { gt: now } } });
}
module.exports = { matches, effectivePrice, activeDiscounts, classification };
