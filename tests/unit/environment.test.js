const { readEnvironment } = require('../../src/config/environment');
describe('environment boundary', () => {
  it('provides local defaults', () => {
    expect(readEnvironment({})).toMatchObject({ NODE_ENV: 'development', HOST: '127.0.0.1', PORT: 666 });
  });
  it.each(['0', '65536', 'abc', '3.5'])('rejects invalid port %s', PORT => {
    expect(() => readEnvironment({ PORT })).toThrow('PORT');
  });
  it('does not expose invalid environment values', () => {
    expect(() => readEnvironment({ NODE_ENV: 'secret-value' })).toThrow('Invalid environment configuration: NODE_ENV');
  });
});
