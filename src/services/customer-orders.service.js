const { z } = require('zod');
const { OrderError } = require('../validators/order.validator');
const words = {
  en: { title: 'My orders', current: 'Current orders', past: 'Past orders', empty: 'No orders yet.', view: 'View order', back: 'Back to my orders', previous: 'Previous', next: 'Next',
    PLACED: 'Order received', CONFIRMED: 'Order confirmed', PROCESSING: 'Preparing your order', SHIPPED: 'On the way', DELIVERED: 'Delivered', CANCELLED: 'Cancelled', review: 'Awaiting payment review',
    paid: 'Paid', unpaid: 'Unpaid', cash: 'Cash on delivery', items: 'Items', reference: 'Reference', payment: 'Payment', subtotal: 'Subtotal', shipping: 'Delivery', total: 'Total' },
  ar: { title: 'طلباتي', current: 'الطلبات الحالية', past: 'الطلبات السابقة', empty: 'لا توجد طلبات بعد.', view: 'عرض الطلب', back: 'العودة إلى طلباتي', previous: 'السابق', next: 'التالي',
    PLACED: 'تم استلام الطلب', CONFIRMED: 'تم تأكيد الطلب', PROCESSING: 'جارٍ تجهيز طلبك', SHIPPED: 'في الطريق إليك', DELIVERED: 'تم التوصيل', CANCELLED: 'تم الإلغاء', review: 'بانتظار مراجعة الدفع',
    paid: 'مدفوع', unpaid: 'غير مدفوع', cash: 'الدفع عند الاستلام', items: 'المنتجات', reference: 'رقم الطلب', payment: 'الدفع', subtotal: 'المجموع الفرعي', shipping: 'التوصيل', total: 'الإجمالي' },
};
function createCustomerOrdersService(repository) {
  const past = order => ['DELIVERED', 'CANCELLED'].includes(order.status);
  return {
    async list(userId, query) {
      const parsed = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) }).strict().safeParse(query);
      if (!parsed.success) throw new OrderError('INVALID_QUERY', 400);
      const rows = await repository.listCustomerOrders(userId, parsed.data.page);
      const orders = rows.slice(0, 20);
      return { page: parsed.data.page, hasNext: rows.length > 20, current: orders.filter(order => !past(order)), past: orders.filter(past) };
    },
    async detail(userId, rawId) {
      const id = z.uuid().safeParse(rawId);
      if (!id.success) throw new OrderError('ORDER_NOT_FOUND', 404);
      const order = await repository.getCustomerOrder(userId, id.data);
      if (!order) throw new OrderError('ORDER_NOT_FOUND', 404);
      return order;
    },
  };
}
function customerOrderPresentation(locale) {
  const copy = words[locale] || words.en;
  return { copy,
    orderStatus: order => order.status !== 'CANCELLED' && order.payment_method === 'INSTAPAY' && order.payment_status !== 'PAID' ? copy.review : copy[order.status] || copy.PLACED,
    orderMoney: value => new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(value),
    orderDate: value => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeZone: 'Africa/Cairo' }).format(value),
    orderPayment: order => order.payment_status === 'PAID' ? copy.paid : order.payment_method === 'CASH_ON_DELIVERY' ? copy.cash : copy.unpaid,
  };
}
module.exports = { createCustomerOrdersService, customerOrderPresentation };
