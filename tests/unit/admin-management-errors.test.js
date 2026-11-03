const { z } = require('zod');
const { adminErrorCode } = require('../../src/routes/admin-management.routes');

describe('admin management error codes', () => {
  it('identifies invalid form data without exposing validation details', () => {
    expect(adminErrorCode(new z.ZodError([]))).toBe('INVALID_INPUT');
  });

  it('points campaign validation errors to the missing Arabic title', () => {
    expect(adminErrorCode(new z.ZodError([{ code: 'too_small', path: ['nameAr'], message: 'required' }]), '/admin/promotions')).toBe('DISCOUNT_ARABIC_NAME_REQUIRED');
  });

  it('turns duplicate records into an actionable safe code', () => {
    expect(adminErrorCode({ code: 'P2002', message: 'duplicate value' })).toBe('DUPLICATE_VALUE');
  });

  it('recognizes temporary database connection failures', () => {
    expect(adminErrorCode({ code: 'P1001', message: 'private database host details' })).toBe('DATABASE_UNAVAILABLE');
  });

  it('identifies missing database tables or columns', () => {
    expect(adminErrorCode({ code: 'P2022', message: 'internal column details' })).toBe('DATABASE_SCHEMA_OUTDATED');
  });

  it('preserves safe authorization error codes for actionable feedback', () => {
    expect(adminErrorCode({ message: 'ADMIN_REQUIRED' })).toBe('ADMIN_REQUIRED');
  });

  it('does not expose arbitrary database or provider messages', () => {
    expect(adminErrorCode({ message: 'password=secret; internal details' })).toBe('ADMIN_OPERATION_FAILED');
  });
});
