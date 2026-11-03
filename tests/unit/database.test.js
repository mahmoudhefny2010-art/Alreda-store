const { readDatabaseConfig } = require('../../src/config/database');
const { readEnvironment } = require('../../src/config/environment');
const { probeDatabase, inspectDatabase } = require('../../src/repositories/database.repository');
const { safeDatabaseCode } = require('../../src/services/database.service');
const source = { DATABASE_URL: 'postgresql://test_user:synthetic-password@example-pooler.neon.tech/test_db?sslmode=require',
  DIRECT_URL: 'postgresql://test_user:synthetic-password@example.neon.tech/test_db?sslmode=require' };
describe('database configuration and repository safety', () => {
  it('keeps credentials out of errors and public environment objects', () => {
    expect(readDatabaseConfig({}).enabled).toBe(false);
    expect(() => readDatabaseConfig({ DATABASE_URL: 'secret-invalid-value' })).toThrow('DATABASE_URL');
    try { readDatabaseConfig({ DATABASE_URL: 'secret-invalid-value' }); } catch (error) { expect(error.message).not.toContain('secret-invalid-value'); }
    const publicEnvironment = readEnvironment({ ...source, NODE_ENV: 'production' });
    expect(publicEnvironment.HOST).toBe('0.0.0.0'); expect(JSON.stringify(publicEnvironment)).not.toContain('synthetic-password');
    expect(() => readDatabaseConfig({ NODE_ENV: 'production' })).toThrow('DATABASE_URL');
  });
  it('enforces verified TLS and bounded pool settings without rewriting the source URL', () => {
    const config = readDatabaseConfig(source);
    expect(new URL(config.url).searchParams.get('sslmode')).toBe('verify-full');
    expect(config.migrationUrl).toContain('example.neon.tech');
    expect(config.poolMax).toBe(5); expect(config.connectTimeoutMs).toBe(15000);
    expect(source.DATABASE_URL).toContain('sslmode=require');
    expect(() => readDatabaseConfig({ ...source, DATABASE_POOL_MAX: '0' })).toThrow('DATABASE_POOL_MAX');
    expect(() => readDatabaseConfig({ ...source, DATABASE_URL: source.DATABASE_URL.replace('require', 'disable') })).toThrow('DATABASE_URL');
  });
  it('rejects a direct migration URL aimed at another database or endpoint', () => {
    expect(() => readDatabaseConfig({ ...source, DIRECT_URL: source.DIRECT_URL.replace('/test_db', '/other_db') })).toThrow('DIRECT_URL');
    expect(() => readDatabaseConfig({ ...source, DIRECT_URL: source.DIRECT_URL.replace('example.neon', 'foreign.neon') })).toThrow('DIRECT_URL');
  });
  it('probes only SELECT 1 using a tagged parameterized query', async () => {
    const client = { $queryRaw: vi.fn(async () => [{ connected: 1 }]) };
    await expect(probeDatabase(client)).resolves.toBe(true);
    expect(client.$queryRaw.mock.calls[0][0].join('')).toBe('SELECT 1::int AS connected');
  });
  it('inspects metadata inside a read-only transaction without touching user rows', async () => {
    const queries = [];
    const tx = { $executeRaw: async strings => { queries.push(strings.join('')); }, $queryRaw: async strings => {
      const sql = strings.join(''); queries.push(sql);
      if (sql.includes('server_version_num')) return [{ version: 180006 }];
      if (sql.includes('information_schema')) return [{ count: 19 }];
      return [{ present: false }];
    } };
    const client = { $transaction: async callback => callback(tx) };
    expect(await inspectDatabase(client)).toMatchObject({ connected: true, publicTableCount: 19, hasPrismaMigrationHistory: false });
    expect(queries[0]).toBe('SET TRANSACTION READ ONLY');
    expect(queries.every(query => /^(SELECT|SET TRANSACTION READ ONLY)/.test(query))).toBe(true);
    expect(queries.some(query => /FROM (users|orders|products)\b/i.test(query))).toBe(false);
  });
  it('reports only allowlisted error codes rather than provider messages', () => {
    expect(safeDatabaseCode({ code: 'P1001', message: source.DATABASE_URL })).toBe('P1001');
    expect(safeDatabaseCode(new Error(source.DATABASE_URL))).toBe('DATABASE_CONNECTION_FAILED');
    expect(safeDatabaseCode({ code: source.DATABASE_URL })).toBe('DATABASE_CONNECTION_FAILED');
  });
});
