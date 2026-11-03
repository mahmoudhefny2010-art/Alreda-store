module.exports = function formatPrice(amount, locale = 'en') {
  if (!/^\d{1,9}\.\d{2}$/.test(amount)) throw new Error('Invalid preview price');
  const [whole, fraction] = amount.split('.');
  const formatted = `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
  if (locale !== 'ar') return `EGP ${formatted}`;
  return `${formatted.replace(/\d/g, digit => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]).replace(',', '٬').replace('.', '٫')} ج.م.`;
};
