const { createWhatsAppOrderService } = require('../../src/services/whatsapp-order.service');
const { createAdminOrdersController } = require('../../src/controllers/admin/orders.controller');

const settings = {
  WHATSAPP_BUSINESS_PHONE_NUMBER_ID: '123456789012345',
  WHATSAPP_ACCESS_TOKEN: 'synthetic-access-token',
  WHATSAPP_ORDER_RECIPIENT: '+201012345678',
};
const order = {
  status: 'CONFIRMED',
  order_number: 'AS-SYNTHETIC-123',
  customer_name: 'Synthetic Customer',
  customer_phone: '+201012345678',
  address_snapshot: JSON.stringify({ address: '5 Test Street', city: 'Cairo', country: 'EG' }),
  total_egp: 1050,
  order_items: [{ product_name: 'Synthetic Product', quantity: 2 }],
};

describe('WhatsApp Cloud API order notifications', () => {
  it('sends an approved template to the configured store recipient with order details', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ messages: [{ id: 'wamid.synthetic' }] }) }));
    const service = createWhatsAppOrderService({ settings, fetchImpl });
    await expect(service.sendOrder(order)).resolves.toEqual({ status: 'sent', messageId: 'wamid.synthetic' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://graph.facebook.com/v23.0/123456789012345/messages',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer synthetic-access-token' }) }),
    );
    const payload = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(payload.to).toBe('201012345678');
    expect(payload.template.components[0].parameters.map(parameter => parameter.text)).toEqual([
      'AS-SYNTHETIC-123', 'Synthetic Customer', '+201012345678', '5 Test Street, Cairo, EG',
      'Synthetic Product x 2', '1050',
    ]);
  });

  it('does not send when configuration is absent or the order is not confirmed', async () => {
    const fetchImpl = vi.fn();
    const disabled = createWhatsAppOrderService({ settings: {}, fetchImpl });
    await expect(disabled.sendOrder(order)).resolves.toEqual({ status: 'not_configured' });
    const service = createWhatsAppOrderService({ settings, fetchImpl });
    await expect(service.sendOrder({ ...order, status: 'PLACED' })).resolves.toEqual({ status: 'not_confirmed' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects partial credentials and reports provider failures without leaking response content', async () => {
    expect(() => createWhatsAppOrderService({ settings: { ...settings, WHATSAPP_ACCESS_TOKEN: '' } })).toThrow('Incomplete WhatsApp order notification configuration');
    const service = createWhatsAppOrderService({ settings, fetchImpl: async () => ({ ok: false, status: 401 }) });
    await expect(service.sendOrder(order)).rejects.toThrow('WHATSAPP_HTTP_401');
  });

  it('automatically attempts delivery only for a newly confirmed order and exposes failure for retry', async () => {
    const orderId = 'c2ce6f28-5d26-4a8d-a005-babacb314181';
    const repository = { updateStatus: vi.fn(async () => ({ changed: true })) };
    const dispatchConfirmedOrder = vi.fn(async () => { throw new Error('WHATSAPP_HTTP_503'); });
    const logger = { error: vi.fn() };
    const controller = createAdminOrdersController(repository, { dispatchConfirmedOrder, logger });
    const res = { locals: { orderUserId: 'admin-id' }, redirect: vi.fn() };
    await controller.updateStatus({ params: { id: orderId }, body: { status: 'CONFIRMED' } }, res);
    expect(dispatchConfirmedOrder).toHaveBeenCalledWith(orderId);
    expect(logger.error).toHaveBeenCalledWith({ event: 'whatsapp_order_notification_failed', code: 'WHATSAPP_HTTP_503' });
    expect(res.redirect).toHaveBeenCalledWith(303, `/admin/orders/${orderId}?whatsapp=failed`);

    repository.updateStatus.mockResolvedValue({ changed: false });
    dispatchConfirmedOrder.mockClear();
    await controller.updateStatus({ params: { id: orderId }, body: { status: 'CONFIRMED' } }, res);
    expect(dispatchConfirmedOrder).not.toHaveBeenCalled();
  });
});
