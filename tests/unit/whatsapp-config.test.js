const { createWhatsAppConfig } = require('../../src/config/whatsapp');
describe('WhatsApp configuration', () => {
  it('disables the button when no number is configured', () => {
    expect(createWhatsAppConfig({})).toBeNull();
    expect(createWhatsAppConfig({ WHATSAPP_PHONE: '' })).toBeNull();
  });
  it('builds an encoded greeting link from a synthetic number', () => {
    const config = createWhatsAppConfig({ WHATSAPP_PHONE: '+15550100100', WHATSAPP_GREETING: 'Hello & welcome مرحباً' });
    const href = new URL(config.href);
    expect(href.origin).toBe('https://wa.me');
    expect(href.pathname).toBe('/15550100100');
    expect(href.searchParams.get('text')).toBe('Hello & welcome مرحباً');
  });
  it.each(['not-a-number', '123/../../other', 'javascript:alert(1)', '123?text=bad'])('rejects invalid phone input', WHATSAPP_PHONE => {
    expect(() => createWhatsAppConfig({ WHATSAPP_PHONE })).toThrow('Invalid WhatsApp configuration');
  });
});
