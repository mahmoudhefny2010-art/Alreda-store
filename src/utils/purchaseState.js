const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function purchaseState(record) {
  if (!uuid.test(record.id || '')) return 'catalogOnly';
  if (record.isAvailable === false) return 'productNotForSale';
  const persisted = (record.variants || []).filter(variant => uuid.test(variant.databaseId || ''));
  if (persisted.length) {
    if (persisted.some(variant => Number.isInteger(variant.inventoryQuantity) && variant.inventoryQuantity > 0 && variant.publicAvailable === true)) return 'ready';
    return persisted.every(variant => Number.isInteger(variant.inventoryQuantity) && variant.inventoryQuantity <= 0) ? 'outOfStock' : 'inventoryPending';
  }
  if ((Number.isInteger(record.stock_quantity) && record.stock_quantity <= 0)
    || (record.variants?.length && record.variants.every(variant => Number.isInteger(variant.inventoryQuantity) && variant.inventoryQuantity <= 0))) return 'outOfStock';
  const choice = (record.variants?.length || 0) > 1 || (record.options || []).some(option => (option.values || []).some(value => value !== 'Default Title'));
  if (choice) return 'variantPurchasingPending';
  if (!Number.isInteger(record.stock_quantity)) return 'inventoryPending';
  return record.stock_quantity > 0 ? 'ready' : 'productNotForSale';
}
module.exports = { purchaseState };
