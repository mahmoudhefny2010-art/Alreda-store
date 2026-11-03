const { getPrismaClient, getDatabaseTransport } = require('../config/prisma');
async function probeDatabase(client = getPrismaClient()) {
  const rows = await client.$queryRaw`SELECT 1::int AS connected`;
  if (rows[0]?.connected !== 1) throw new Error('DATABASE_PROBE_FAILED');
  return true;
}
async function inspectDatabase(client = getPrismaClient()) {
  return client.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const version = await tx.$queryRaw`SELECT current_setting('server_version_num')::int AS version`;
    const encryption = await tx.$queryRaw`SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()`;
    const tables = await tx.$queryRaw`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`;
    const history = await tx.$queryRaw`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`;
    const legacy = await tx.$queryRaw`SELECT to_regclass('public.knex_migrations') IS NOT NULL AS present`;
    let legacyMigrationCount = null;
    if (legacy[0].present) {
      const rows = await tx.$queryRaw`SELECT count(*)::int AS count FROM public.knex_migrations`;
      legacyMigrationCount = rows[0].count;
    }
    let migrations = { applied: 0, incomplete: 0 };
    if (history[0].present) {
      const rows = await tx.$queryRaw`SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied, count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS incomplete FROM public._prisma_migrations`;
      migrations = rows[0];
    }
    return { connected: true, postgresVersion: version[0].version, clientTransport: getDatabaseTransport(client),
      postgresBackendTls: encryption[0]?.ssl === true, publicTableCount: tables[0].count,
      hasPrismaMigrationHistory: history[0].present, legacyKnexMigrationCount: legacyMigrationCount, migrations };
  }, { timeout: 20000 });
}
module.exports = { probeDatabase, inspectDatabase };
