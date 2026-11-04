const express = require('express');
const request = require('supertest');
const { createNotificationRoutes } = require('../../src/routes/notification.routes');
const { createOneSignalService } = require('../../src/services/onesignal.service');
const { createNotificationWorker, deliveryFailureCode } = require('../../src/services/notification-worker.service');

describe('customer push preferences and OneSignal delivery', () => {
  it.each([
    [{ name: 'AbortError' }, 'PROVIDER_TIMEOUT'],
    [{ name: 'TypeError', message: 'fetch failed', cause: { code: 'ECONNRESET' } }, 'PROVIDER_NETWORK_ERROR'],
    [{ message: 'ONESIGNAL_HTTP_401' }, 'ONESIGNAL_HTTP_401'],
    [{ message: 'ONESIGNAL_NO_ACTIVE_SUBSCRIPTIONS' }, 'NO_ACTIVE_SUBSCRIPTIONS'],
    [{ message: 'ONESIGNAL_INVALID_SUBSCRIPTIONS' }, 'INVALID_SUBSCRIPTIONS'],
    [{ message: 'ONESIGNAL_INVALID_RESPONSE' }, 'PROVIDER_INVALID_RESPONSE'],
    [{ code: 'P2021' }, 'DATABASE_ERROR'],
  ])('classifies delivery failures without exposing error details', (error, code) => {
    expect(deliveryFailureCode(error)).toBe(code);
  });
  it.each([['https://store.example/auth/google/callback', 'https://store.example/'], ['http://127.0.0.1:3000/auth/google/callback', undefined]])('uses a valid launch URL or the provider default (%s)', async (callback, expected) => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'accepted-message' }) });
    const service = createOneSignalService({ settings: { ONESIGNAL_APP_ID: '7f862239-6261-47e9-a54a-63f21437f14e', ONESIGNAL_REST_API_KEY: 'synthetic-long-server-key', GOOGLE_CALLBACK_URL: callback }, fetchImpl });
    await service.send({ subscriptionIds: ['synthetic-device'], eventType: 'ORDER_PLACED', payload: {} });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).url).toBe(expected);
  });
  it('saves only validated preferences for the authenticated customer', async () => {
    const repository = { savePreferences: vi.fn(), registerSubscription: vi.fn(), unregisterSubscription: vi.fn() };
    const app = express(); app.use(express.json());
    app.use((req, res, next) => { req.customer = { id: 'f4288e8d-77a7-416e-a7c8-f16ec906ab3a' }; req.headers.host = 'store.test'; next(); });
    app.use(createNotificationRoutes({ repository, enabled: true }));
    await request(app).post('/api/notifications/preferences').set('Host', 'store.test').set('Origin', 'http://store.test').send({ transactional: true, marketing: false }).expect(200);
    expect(repository.savePreferences).toHaveBeenCalledWith('f4288e8d-77a7-416e-a7c8-f16ec906ab3a', true, false);
    await request(app).post('/api/notifications/preferences').set('Host', 'store.test').set('Origin', 'http://store.test').send({ transactional: 'yes', marketing: true }).expect(400);
    expect(repository.savePreferences).toHaveBeenCalledTimes(1);
  });

  it('sends only to stored subscription IDs and never returns the REST key', async () => {
    const calls = [];
    const service = createOneSignalService({ settings: { ONESIGNAL_APP_ID: '7f862239-6261-47e9-a54a-63f21437f14e', ONESIGNAL_REST_API_KEY: 'server-secret-key-which-is-long-enough' },
      fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ id: 'provider-message-id' }) }; } });
    await expect(service.send({ subscriptionIds: ['subscription-id-123'], eventType: 'ORDER_PLACED', payload: { reference: 'AS-123' } })).resolves.toEqual({ skipped: false, messageId: 'provider-message-id' });
    expect(calls[0].url).toBe('https://api.onesignal.com/notifications');
    expect(calls[0].options.headers.Authorization).toBe('Key server-secret-key-which-is-long-enough');
    expect(JSON.parse(calls[0].options.body).include_subscription_ids).toEqual(['subscription-id-123']);
  });

  it('recognizes OneSignal success responses that contain no active subscribed devices', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ id: '', errors: ['All included players are not subscribed'] }) }));
    const service = createOneSignalService({ settings: { ONESIGNAL_APP_ID: '7f862239-6261-47e9-a54a-63f21437f14e', ONESIGNAL_REST_API_KEY: 'synthetic-provider-key-not-real' }, fetchImpl });
    await expect(service.send({ subscriptionIds: ['stale-subscription'], eventType: 'ORDER_PLACED', payload: {} }))
      .rejects.toMatchObject({ message: 'ONESIGNAL_NO_ACTIVE_SUBSCRIPTIONS', invalidSubscriptionIds: ['stale-subscription'] });
  });

  it('extracts only submitted IDs from OneSignal invalid-subscription errors', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({
      id: '', errors: { invalid_subscription_ids: ['stale-subscription', 'unrelated-subscription'] },
    }) }));
    const service = createOneSignalService({ settings: { ONESIGNAL_APP_ID: '7f862239-6261-47e9-a54a-63f21437f14e', ONESIGNAL_REST_API_KEY: 'synthetic-provider-key-not-real' }, fetchImpl });
    await expect(service.send({ subscriptionIds: ['stale-subscription'], eventType: 'ORDER_PLACED', payload: {} }))
      .rejects.toMatchObject({ message: 'ONESIGNAL_INVALID_SUBSCRIPTIONS', invalidSubscriptionIds: ['stale-subscription'] });
  });

  it('immediately dispatches a queued order-status notice and honors the default transactional preference', async () => {
    const orderId = 'a836d7d7-65f9-4c40-9bc4-0b76581e35cc';
    const job = { id: 'c2ce6f28-5d26-4a8d-a005-babacb314181', user_id: 'u1', order_id: orderId, reminder_id: null,
      event_type: 'ORDER_STATUS', payload: { reference: 'AS-123', status: 'CONFIRMED' }, attempts: 1 };
    const tx = {
      $queryRaw: vi.fn(async () => [job]),
      site_settings: { findUnique: vi.fn(async () => null) },
      users: { findFirst: vi.fn(async () => ({ id: 'u1' })) },
      push_subscribers: { findMany: vi.fn(async () => [{ onesignal_subscription_id: 'subscription-123' }]) },
      notification_attempts: { create: vi.fn() },
      notification_outbox: { update: vi.fn() },
    };
    const client = { ...tx, $transaction: vi.fn(async callback => callback(tx)) };
    const provider = { enabled: true, send: vi.fn(async () => ({ skipped: false, messageId: 'provider-message-id' })) };
    const worker = createNotificationWorker({ clientProvider: () => client, provider, logger: { error: vi.fn() } });

    await expect(worker.processOrderStatus(orderId)).resolves.toEqual({ processed: 1, skipped: false });

    const [query, parameter] = tx.$queryRaw.mock.calls[0];
    expect(query.join(' ')).toContain("event_type = 'ORDER_STATUS'");
    expect(parameter).toBe(orderId);
    expect(tx.users.findFirst).toHaveBeenCalledWith({ where: {
      id: 'u1', is_active: true, OR: [
        { notification_preferences: { is: { transactional_enabled: true } } },
        { notification_preferences: { is: null } },
      ],
    }, select: { id: true } });
    expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'ORDER_STATUS', deliveryKey: job.id }));
    expect(tx.notification_outbox.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SENT' }) }));
  });

  it('ends an undeliverable notification without retrying it as a provider failure', async () => {
    const job = { id: 'c2ce6f28-5d26-4a8d-a005-babacb314181', user_id: 'u1', order_id: null, reminder_id: null,
      event_type: 'ORDER_PLACED', payload: {}, attempts: 1 };
    const writes = { attempts: [], outbox: [] };
    const tx = {
      $queryRaw: vi.fn(async () => [job]),
      site_settings: { findUnique: vi.fn(async () => null) },
      users: { findFirst: vi.fn(async () => ({ id: 'u1' })) },
      push_subscribers: { findMany: vi.fn(async () => [{ onesignal_subscription_id: 'stale-subscription' }]) },
      notification_attempts: { create: vi.fn(async ({ data }) => writes.attempts.push(data)) },
      notification_outbox: { update: vi.fn(async ({ data }) => writes.outbox.push(data)) },
    };
    const client = { ...tx, $transaction: vi.fn(async callback => callback(tx)) };
    const provider = { enabled: true, send: vi.fn(async () => { throw new Error('ONESIGNAL_NO_ACTIVE_SUBSCRIPTIONS'); }) };
    const logger = { error: vi.fn() };
    const worker = createNotificationWorker({ clientProvider: () => client, provider, logger });

    await worker.processOne();

    expect(writes.attempts[0]).toMatchObject({ status: 'SKIPPED', error_code: 'NO_ACTIVE_SUBSCRIPTIONS' });
    expect(writes.outbox[0]).toMatchObject({ status: 'DEAD', last_error_code: 'NO_ACTIVE_SUBSCRIPTIONS' });
    expect(logger.error).toHaveBeenCalledWith({ event: 'notification_delivery_skipped', code: 'NO_ACTIVE_SUBSCRIPTIONS' });
  });

  it('removes only provider-rejected IDs and retries remaining subscriptions', async () => {
    const job = { id: 'c2ce6f28-5d26-4a8d-a005-babacb314181', user_id: 'u1', order_id: null, reminder_id: null,
      event_type: 'ORDER_PLACED', payload: {}, attempts: 1 };
    const writes = { attempts: [], outbox: [] };
    const tx = {
      $queryRaw: vi.fn(async () => [job]),
      site_settings: { findUnique: vi.fn(async () => null) },
      users: { findFirst: vi.fn(async () => ({ id: 'u1' })) },
      push_subscribers: {
        findMany: vi.fn(async () => [{ onesignal_subscription_id: 'stale-subscription' }, { onesignal_subscription_id: 'active-subscription' }]),
        deleteMany: vi.fn(),
      },
      notification_attempts: { create: vi.fn(async ({ data }) => writes.attempts.push(data)) },
      notification_outbox: { update: vi.fn(async ({ data }) => writes.outbox.push(data)) },
    };
    const client = { ...tx, $transaction: vi.fn(async callback => callback(tx)) };
    const provider = { enabled: true, send: vi.fn(async ({ subscriptionIds }) => {
      expect(subscriptionIds).toEqual(['stale-subscription', 'active-subscription']);
      const error = new Error('ONESIGNAL_INVALID_SUBSCRIPTIONS');
      error.invalidSubscriptionIds = ['stale-subscription'];
      throw error;
    }) };
    const logger = { error: vi.fn() };
    const worker = createNotificationWorker({ clientProvider: () => client, provider, logger });

    await worker.processOne();

    expect(tx.push_subscribers.deleteMany).toHaveBeenCalledWith({ where: {
      user_id: 'u1', onesignal_subscription_id: { in: ['stale-subscription'] },
    } });
    expect(writes.attempts[0]).toMatchObject({ status: 'FAILED', error_code: 'INVALID_SUBSCRIPTIONS' });
    expect(writes.outbox[0]).toMatchObject({ status: 'PENDING', last_error_code: 'INVALID_SUBSCRIPTIONS' });
    expect(logger.error).toHaveBeenCalledWith({ event: 'notification_delivery_failed', code: 'INVALID_SUBSCRIPTIONS' });
  });
});
