const { productDescription } = require('../../src/utils/productDescription');
const { getProduct } = require('../../src/services/product.service');
const catalog = require('../../src/config/catalog.json');

describe('complete source product descriptions', () => {
  it('keeps a full English description containing Arabic option labels and specifications', () => {
    const html = '<h2>Bathroom accessories</h2><p>Individual stainless steel pieces for the bathroom.</p><ul><li>Single towel bar (مفرد)</li></ul><table><tr><td>Material</td><td>Steel 304</td></tr></table>';
    expect(productDescription({ descriptionHtml: html }, 'en')).toMatchObject({ language: 'en', originalLanguage: false });
    expect(productDescription({ descriptionHtml: html }, 'en').html).toContain('Steel 304');
    expect(productDescription({ descriptionHtml: html }, 'en').html).toContain('مفرد');
  });
  it('selects the actual requested language before falling back to the original', () => {
    const record = { descriptionHtml: '<p>English details</p>', descriptionArHtml: '<p>تفاصيل المنتج الأصلية</p>' };
    expect(productDescription(record, 'ar')).toEqual({ html: record.descriptionArHtml, language: 'ar', originalLanguage: false });
    expect(productDescription(record, 'en')).toEqual({ html: record.descriptionHtml, language: 'en', originalLanguage: false });
  });
  it('explicitly identifies an untranslated source description without losing it', () => {
    expect(productDescription({ descriptionHtml: '<p>وصف المنتج الأصلي كاملاً</p>' }, 'en'))
      .toEqual({ html: '<p>وصف المنتج الأصلي كاملاً</p>', language: 'ar', originalLanguage: true });
  });
  it('ignores scripts, attributes and empty markup when selecting language or content', () => {
    expect(productDescription({ descriptionHtml: '<script>تفاصيل</script><p title="تفاصيل">English details</p>' }, 'en'))
      .toEqual({ html: '<p>English details</p>', language: 'en', originalLanguage: false });
    expect(productDescription({ descriptionHtml: '<p>&nbsp;</p><script>bad()</script>' }).html).toBe('');
  });
  it.each(['en', 'ar'])('retains readable source details for every catalog product in %s', locale => {
    for (const record of catalog.products) {
      const page = getProduct(record.slug, { locale });
      expect(page.product.descriptionHtml, record.slug).not.toBe('');
      expect(page.product.descriptionLanguage).toMatch(/^(en|ar)$/);
    }
  });
});
