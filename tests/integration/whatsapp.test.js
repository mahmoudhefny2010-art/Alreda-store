const request = require('supertest');
const { createApp } = require('../../src/app');
describe('WhatsApp component rendering', () => {
  it('omits a broken contact action when configuration is absent', async () => {
    const response = await request(createApp({ whatsappSettings: {} })).get('/').expect(200);
    expect(response.text).not.toContain('data-whatsapp-contact');
  });
  it('renders a configured accessible action without an inline script', async () => {
    const app = createApp({ whatsappSettings: { WHATSAPP_PHONE: '15550100100', WHATSAPP_GREETING: 'Hello & welcome' } });
    const response = await request(app).get('/').expect(200);
    expect(response.text).toContain('data-whatsapp-contact');
    expect(response.text).toContain('https://wa.me/15550100100?text=Hello+%26+welcome');
    expect(response.text).toContain('Contact Alreda Store on WhatsApp');
    expect(response.text).toContain('noopener noreferrer');
    expect(response.text).not.toContain('class="whatsapp-chat"');
  });
});
