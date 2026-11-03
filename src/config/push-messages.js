const defaults = {
  ORDER_PLACED: { titleEn: 'Order received', titleAr: 'تم استلام الطلب', bodyEn: 'We received your order {reference}.', bodyAr: 'استلمنا طلبك {reference}.', url: '/' },
  ORDER_STATUS: { titleEn: 'Order update', titleAr: 'تحديث الطلب', bodyEn: 'Your order {reference}: {status}', bodyAr: 'حالة طلبك {reference}: {status}', url: '/' },
  ABANDONED_CART: { titleEn: 'Your cart is waiting', titleAr: 'سلتك في انتظارك', bodyEn: 'Your selected items are still in your cart. Continue shopping when you are ready.', bodyAr: 'منتجاتك ما زالت في السلة. أكمل التسوق في الوقت المناسب لك.', url: '/checkout' },
};
const statuses = { PLACED: ['Placed', 'تم الاستلام'], CONFIRMED: ['Confirmed', 'مؤكد'], PROCESSING: ['Processing', 'قيد التجهيز'], SHIPPED: ['Shipped', 'تم الشحن'], DELIVERED: ['Delivered', 'تم التوصيل'], CANCELLED: ['Cancelled', 'ملغي'] };
function renderMessage(eventType, payload = {}) {
  const { messageSchema } = require('../validators/store-settings.validator');
  const message = messageSchema.parse(payload.message || defaults[eventType]);
  const replace = (value, ar) => value.replaceAll('{reference}', String(payload.reference || '').slice(0, 80)).replaceAll('{status}', statuses[payload.status]?.[ar ? 1 : 0] || (ar ? 'تم التحديث' : 'Updated'));
  return { headings: { en: replace(message.titleEn, false), ar: replace(message.titleAr, true) },
    contents: { en: replace(message.bodyEn, false), ar: replace(message.bodyAr, true) }, url: message.url };
}
module.exports = { defaults, renderMessage };
