const { z } = require('zod');
const { OrderError, deliveryLocationSchema } = require('../../validators/order.validator');
const { createAdminCsrfToken } = require('../../security/admin-csrf');
function present(order) {
  let shipping = null;
  try { const value = JSON.parse(order.address_snapshot); if (value && typeof value === 'object' && !Array.isArray(value)) shipping = value; } catch { /* Legacy snapshots are rendered as escaped text. */ }
  const nextStatuses = order.payment_method === 'INSTAPAY' && order.payment_status !== 'PAID' ? (order.status === 'CANCELLED' ? [] : ['CANCELLED']) : { PLACED: ['CONFIRMED', 'PROCESSING', 'CANCELLED'], CONFIRMED: ['PROCESSING', 'CANCELLED'], PROCESSING: ['SHIPPED', 'CANCELLED'], SHIPPED: ['DELIVERED'] }[order.status] || [];
  const parsedLocation = deliveryLocationSchema.safeParse(shipping?.location);
  const location = parsedLocation.success ? parsedLocation.data : null;
  return { ...order, shipping, nextStatuses, location, mapUrl: location ? `https://www.google.com/maps?q=${location.latitude},${location.longitude}` : null };
}
function createAdminOrdersController(repository, { csrfSecret = '' } = {}) {
  const presentation = locale => ({ copy: require('../../config/admin-orders-i18n')[locale] || require('../../config/admin-orders-i18n').en,
    orderMoney: value => new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(value),
    orderDate: value => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(value),
  });
  return {
    async index(req, res) {
      const query = z.object({ cursor: z.uuid().optional(), q: z.string().trim().max(100).default(''),
        status: z.enum(['', 'PLACED', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']).default(''),
        payment: z.enum(['', 'UNPAID', 'PAID', 'UNCONFIRMED']).default(''),
        method: z.enum(['', 'CASH_ON_DELIVERY', 'INSTAPAY', 'ONLINE', 'INSTAPAY_ON_DELIVERY', 'PAY_AT_CASHIER']).default(''),
      }).strict().safeParse(req.query);
      if (!query.success) throw new OrderError('INVALID_QUERY', 400);
      const { cursor, ...filters } = query.data;
      const rows = await repository.listAdminOrders(cursor, filters);
      const orders = rows.slice(0, 50).map(present);
      const nextCursor = rows.length > 50 ? orders.at(-1).id : null;
      const nextUrl = nextCursor ? `/admin/orders?${new URLSearchParams({ ...filters, cursor: nextCursor })}` : null;
      res.render('layouts/admin', { title: res.locals.dashboardText('ordersTitle'), contentView: '../admin/orders-list', orders, filters, ...presentation(res.locals.locale), nextUrl });
    },
    async detail(req, res) {
      const id = z.uuid().safeParse(req.params.id);
      if (!id.success) throw new OrderError('INVALID_ORDER_ID', 400);
      const order = await repository.getAdminOrder(id.data);
      if (!order) throw new OrderError('ORDER_NOT_FOUND', 404);
      res.render('layouts/admin', { title: res.locals.dashboardText('orderDetailsTitle'), contentView: '../admin/orders', orders: [present(order)], ...presentation(res.locals.locale), csrfToken: createAdminCsrfToken(req.customerSessionToken, csrfSecret), nextCursor: null });
    },
    async updateStatus(req, res) {
      const id = z.uuid().safeParse(req.params.id);
      const body = z.object({ status: z.enum(['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']), _csrf: z.string().optional() }).strict().safeParse(req.body);
      if (!id.success || !body.success) throw new OrderError('INVALID_STATUS', 400);
      await repository.updateStatus(id.data, body.data.status, res.locals.orderUserId);
      return res.redirect(303, `/admin/orders/${id.data}`);
    },
  };
}
module.exports = { createAdminOrdersController };
