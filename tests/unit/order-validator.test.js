const { parseOrder } = require('../../src/validators/order.validator');

const validOrder = phone => ({
  customer: { name: 'سارة علي', email: 'buyer@example.invalid', phone },
  shipping: { country: 'EG', city: 'Cairo', address: 'Synthetic test address' },
  items: [{ productId: '4d38b991-5517-4e50-aa5a-8a469039c4ab', quantity: 1, unitPriceEgp: 100 }],
  expectedTotalEgp: 125,
  paymentMethod: 'CASH_ON_DELIVERY',
});

describe('checkout customer validation', () => {
  it.each([
    ['01012345678', '+201012345678'],
    ['+20 10-1234-5678', '+201012345678'],
    ['٠١٠١٢٣٤٥٦٧٨', '+201012345678'],
    ['201112345678', '+201112345678'],
  ])('normalizes Egyptian mobile number %s', (phone, normalized) => {
    expect(parseOrder(validOrder(phone)).customer.phone).toBe(normalized);
  });

  it.each(['0101234567', '02012345678', '+15550100100', 'abcdefghijk', ''])('rejects invalid Egyptian mobile number %s', phone => {
    expect(() => parseOrder(validOrder(phone))).toThrow('INVALID_ORDER');
  });

  it('rejects blank or too-short customer names after trimming', () => {
    expect(() => parseOrder({ ...validOrder('01012345678'), customer: { ...validOrder('01012345678').customer, name: '  ' } })).toThrow('INVALID_ORDER');
    expect(() => parseOrder({ ...validOrder('01012345678'), customer: { ...validOrder('01012345678').customer, name: ' A ' } })).toThrow('INVALID_ORDER');
  });
});
