'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER = /^[\p{L}\p{N}_-]{1,80}$/u;

function createWishlistRepository(getClient) {
  const client = () => getClient();
  async function visibleProduct(productId) {
    const row = await client().products.findUnique({ where: { id: productId }, include: { catalog_details: true } });
    return Boolean(row?.is_available && !row.catalog_details?.presentation?.archivedAt);
  }
  return {
    async listIds(userId) {
      const rows = await client().customer_favorites.findMany({ where: { user_id: userId }, orderBy: { created_at: 'desc' }, select: { product_id: true } });
      return rows.map(row => row.product_id);
    },
    async add(userId, productId) {
      if (!await visibleProduct(productId)) throw new Error('PRODUCT_UNAVAILABLE');
      await client().customer_favorites.upsert({ where: { user_id_product_id: { user_id: userId, product_id: productId } }, create: { user_id: userId, product_id: productId }, update: {} });
      return true;
    },
    async remove(userId, productId) {
      await client().customer_favorites.deleteMany({ where: { user_id: userId, product_id: productId } });
      return true;
    },
    async merge(userId, identifiers) {
      const uuids = identifiers.filter(value => UUID.test(value));
      const sources = identifiers.filter(value => !UUID.test(value) && IDENTIFIER.test(value));
      if (!uuids.length && !sources.length) return 0;
      const products = await client().products.findMany({ where: { is_available: true, OR: [
        ...(uuids.length ? [{ id: { in: uuids } }] : []), ...(sources.length ? [{ source_id: { in: sources } }] : []),
      ] }, include: { catalog_details: true }, select: undefined });
      const publicIds = products.filter(row => !row.catalog_details?.presentation?.archivedAt).map(row => row.id);
      if (!publicIds.length) return 0;
      const result = await client().customer_favorites.createMany({ data: publicIds.map(product_id => ({ user_id: userId, product_id })), skipDuplicates: true });
      return result.count;
    },
  };
}

module.exports = { createWishlistRepository, wishlistIdentifier: value => UUID.test(value) || IDENTIFIER.test(value) };
