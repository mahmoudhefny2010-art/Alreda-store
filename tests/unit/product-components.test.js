const ejs = require('ejs');
const path = require('node:path');
const { translate } = require('../../src/config/storefront-i18n');
const render = products => ejs.renderFile(path.resolve(__dirname, '../../src/views/partials/product-grid.ejs'), {
  products, t: key => translate('en', key),
});
describe('prepared product UI components', () => {
  it('renders a clear empty state', async () => {
    expect(await render([])).toContain(translate('en', 'noProducts'));
  });
  it('escapes display data and keeps purchasing disabled', async () => {
    const html = await render([{ name: '<script>unsafe</script>', href: '/#collections', image: null,
      price: { currentFormatted: 'EGP 100.00', compareAtFormatted: 'EGP 120.00' }, availability: { label: 'Preview only' } }]);
    expect(html).not.toContain('<script>unsafe</script>');
    expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;');
    expect(html).toContain('EGP 100.00');
    expect(html).toContain('<del>EGP 120.00</del>');
    expect(html).toContain('disabled');
    expect(html).toContain(translate('en', 'inventoryPending'));
  });
  it('renders a usable add button without a false disconnected message for a stocked database product', async () => {
    const html = await render([{ id: 'a6c56b98-f00b-4b4b-8b03-3af6a37a9204', name: 'Stocked item', stock_quantity: 3, purchaseEligible: true, purchaseStatus: 'ready', href: '/products/stocked', image: null, price: { currentFormatted: 'EGP 100.00' }, availability: { label: 'In stock' } }]);
    expect(html).not.toContain('disabled'); expect(html).not.toContain(translate('en', 'shoppingNotConnected'));
  });
});
