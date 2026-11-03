const { translateDescription, buildTranslations, applyTranslations, untranslatedArabicWords } = require('../../scripts/catalog-import/translate-manual');
const { localizeCatalogText } = require('../../src/utils/localizeCatalogText');
const { productDescription } = require('../../src/utils/productDescription');
const sanitize = require('../../src/utils/sanitizeProductDescription');
const catalog = require('../../src/config/catalog.json');
const original = (descriptionHtml = '<p>طفاية عمود مدور استاليس</p>') => ({ products: [{ sourceId: '10', slug: 'round-column-stainless-ashtray', name: 'Round Column Ashtray',
  titleEn: 'Round Column Ashtray', titleAr: 'طفاية عمود مدور', descriptionHtml, descriptionArHtml: '<p>طفاية عمود مدور</p>',
  gallery: [{ src: 'https://res.cloudinary.com/test/image/upload/photo.jpg' }], variants: [{ id: '20', priceAmount: '100.00' }], stock_quantity: 5 }] });
const blocks = html => (html.match(/<(?:p|li|th|td|table|h3|h4)(?:\s|>)/g) || []).length;

describe('manually authored catalog translations', () => {
  it('translates source text without contacting any external provider and preserves safe structure', () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('External calls forbidden'));
    expect(translateDescription('<h2>تفاصيل المنتج</h2><p>سعة 25 لتر.</p><script>bad()</script>', 'en'))
      .toBe('<h3>Product details</h3><p>25-liter capacity.</p>');
    expect(network).not.toHaveBeenCalled(); network.mockRestore();
  });
  it('covers every captured product in both languages and keeps all paragraphs, lists and table cells', () => {
    const translated = buildTranslations(catalog);
    expect(translated.products).toHaveLength(catalog.products.length);
    for (const [index, product] of translated.products.entries()) {
      const source = catalog.products[index];
      expect(productDescription(product, 'en').originalLanguage, product.slug).toBe(false);
      expect(productDescription(product, 'ar').originalLanguage, product.slug).toBe(false);
      expect(product.descriptionHtml, product.slug).not.toMatch(/[\u0600-\u06ff]/u);
      expect(untranslatedArabicWords(product.descriptionArHtml), product.slug).toEqual([]);
      expect(blocks(product.descriptionHtml), product.slug).toBe(blocks(sanitize(sanitize(source.descriptionHtml))));
      expect(blocks(product.descriptionArHtml), product.slug).toBe(blocks(sanitize(sanitize(source.descriptionArHtml || source.descriptionHtml))));
      expect(product.gallery).toEqual(source.gallery);
      expect(product.variants).toEqual(source.variants);
      expect(product.stock_quantity).toBe(source.stock_quantity);
      for (const number of sanitize(source.descriptionHtml).match(/\d+(?:\.\d+)?/g) || []) expect(product.descriptionHtml, product.slug).toContain(number);
    }
    expect(buildTranslations(translated)).toEqual(translated);
  }, 15000);
  it('localizes metadata without changing technical model codes', () => {
    expect(localizeCatalogText('Door Handles', 'ar')).toBe('مقابض أبواب');
    expect(localizeCatalogText('Delight 304 ABS MJ1', 'ar')).toBe('ديلايت 304 ABS MJ1');
    expect(localizeCatalogText('الأهرام', 'en')).toBe('Al Ahram');
  });
  it('refuses unknown untranslated source content instead of inventing a description', () => {
    expect(() => buildTranslations(original('<p>هذا نص جديد غير موجود ضمن الترجمة اليدوية</p>'))).toThrow('MANUAL_ENGLISH_INCOMPLETE');
  });
  it('writes names/descriptions only and preserves administrator edits', async () => {
    const before = original(); const after = buildTranslations(before);
    const row = { id: 'uuid', source_id: '10', slug: before.products[0].slug, name: before.products[0].titleEn,
      name_ar: before.products[0].titleAr, description: before.products[0].descriptionHtml, description_ar: before.products[0].descriptionArHtml };
    const update = vi.fn(async () => {});
    const tx = { $queryRaw: vi.fn(), products: { findMany: async () => [row], update } };
    const client = { $transaction: fn => fn(tx) };
    expect(await applyTranslations(client, before, after)).toMatchObject({ matched: 1, changed: 1 });
    expect(Object.keys(update.mock.calls[0][0].data).sort()).toEqual(['description', 'description_ar', 'name', 'name_ar']);
    update.mockClear(); row.description = '<p>Administrator edit</p>';
    await expect(applyTranslations(client, before, after)).rejects.toThrow('MANUAL_DATABASE_EDIT_CONFLICT');
    expect(update).not.toHaveBeenCalled();
  });
});
