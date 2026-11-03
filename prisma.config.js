require('dotenv').config({ quiet: true });
const { defineConfig } = require('prisma/config');
const { readDatabaseConfig } = require('./src/config/database');
const database = readDatabaseConfig({ ...process.env, DATABASE_REQUIRED: 'false' });
module.exports = defineConfig({ schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations' },
  // Generation/builds do not need production secrets. Only actual DB commands require a URL.
  ...(database.migrationUrl ? { datasource: { url: database.migrationUrl } } : {}),
});
