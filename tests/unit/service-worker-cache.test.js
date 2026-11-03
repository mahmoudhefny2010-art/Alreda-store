const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../src/public/service-worker.js'), 'utf8');
function worker(fetchImpl) {
  const listeners = {}, saved = new Response('old-css'), put = vi.fn();
  vm.runInNewContext(source, { self: { location: { origin: 'https://store.example' }, addEventListener: (name, handler) => { listeners[name] = handler; } }, caches: { open: async () => ({ match: async () => saved.clone(), put }), match: async () => saved.clone() }, fetch: fetchImpl, Response, URL });
  return { listeners, put };
}
describe('updatable PWA storefront assets', () => {
  it('uses fresh CSS rather than an old cached stylesheet when online', async () => {
    const { listeners, put } = worker(async () => new Response('new-css')); let result;
    listeners.fetch({ request: { method: 'GET', url: 'https://store.example/assets/css/main.css' }, respondWith: promise => { result = promise; } });
    expect(await (await result).text()).toBe('new-css'); expect(put).toHaveBeenCalledOnce();
  });
  it('keeps CSS available offline and leaves private checkout requests alone', async () => {
    const { listeners } = worker(async () => { throw new Error('offline'); }); let result;
    listeners.fetch({ request: { method: 'GET', url: 'https://store.example/assets/js/product-card.js' }, respondWith: promise => { result = promise; } });
    expect(await (await result).text()).toBe('old-css');
    const respondWith = vi.fn(); listeners.fetch({ request: { method: 'GET', url: 'https://store.example/checkout' }, respondWith }); expect(respondWith).not.toHaveBeenCalled();
  });
});
