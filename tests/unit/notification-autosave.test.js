const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../src/public/js/onesignal-client.js'), 'utf8');
function setup(fetch) {
  const listeners = {};
  const status = { textContent: '' };
  const form = { elements: { transactional: { checked: true }, marketing: { checked: false } },
    querySelector: () => status, setAttribute: vi.fn(), addEventListener: (event, callback) => { listeners[event] = callback; } };
  const document = { currentScript: { dataset: { appId: 'test', userId: 'test', savedLabel: 'Saved', errorLabel: 'Error' } },
    querySelector: selector => selector === '[data-notification-preferences]' ? form : null,
    createElement: () => ({}), head: { append: vi.fn() } };
  vm.runInNewContext(source, { document, window: { isSecureContext: true, dispatchEvent: vi.fn() }, navigator: { serviceWorker: {} },
    fetch, AbortSignal, Event, setTimeout: () => 1, clearTimeout: vi.fn() });
  return { form, status, change: name => listeners.change({ target: form.elements[name] }) };
}
describe('automatic notification preference saving', () => {
  it('saves immediately on change without needing the SDK or submitting a form', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true }); const test = setup(fetch);
    expect(fetch).not.toHaveBeenCalled();
    test.form.elements.marketing.checked = true;
    await test.change('marketing');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ transactional: true, marketing: true });
    expect(test.status.textContent).toBe('Saved');
  });
  it('serializes rapid changes and persists the latest complete preference state', async () => {
    let resolveFirst;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; })).mockResolvedValue({ ok: true });
    const test = setup(fetch); test.form.elements.marketing.checked = true;
    const first = test.change('marketing');
    test.form.elements.transactional.checked = false;
    await test.change('transactional');
    expect(fetch).toHaveBeenCalledTimes(1);
    resolveFirst({ ok: true }); await first;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ transactional: false, marketing: true });
    expect(test.status.textContent).toBe('Saved');
  });
  it.each(['rejected', 'network'])('restores last saved values on a %s failure', async type => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true });
    if (type === 'network') fetch.mockRejectedValueOnce(new Error('offline')); else fetch.mockResolvedValueOnce({ ok: false });
    const test = setup(fetch); test.form.elements.marketing.checked = true; await test.change('marketing');
    test.form.elements.transactional.checked = false; await test.change('transactional');
    expect(test.form.elements.transactional.checked).toBe(true);
    expect(test.form.elements.marketing.checked).toBe(true);
    expect(test.status.textContent).toBe('Error');
    expect(test.form.setAttribute).toHaveBeenLastCalledWith('aria-busy', 'false');
  });
});
