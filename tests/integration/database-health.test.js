const request = require('supertest');
const { createApp } = require('../../src/app');
describe('deployment health checks', () => {
  it('separates process liveness from successful database readiness', async () => {
    const app = createApp({ environment: 'test', databaseReadiness: async () => true });
    await request(app).get('/health/live').expect('Cache-Control', 'no-store').expect(200).expect({ status: 'ok' });
    await request(app).get('/health/ready').expect(200).expect({ status: 'ready' });
  });
  it('returns a generic unavailable response without exposing database errors', async () => {
    const app = createApp({ environment: 'test', databaseReadiness: async () => { throw new Error('private-endpoint-and-credentials'); } });
    await request(app).get('/health/live').expect(200);
    const response = await request(app).get('/health/ready').expect(503).expect({ status: 'unavailable' });
    expect(response.text).not.toContain('private');
  });
});
