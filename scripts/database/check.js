require('dotenv').config({ quiet: true });
const { inspectDatabase } = require('../../src/repositories/database.repository');
const { disconnectDatabase } = require('../../src/config/prisma');
const { safeDatabaseCode } = require('../../src/services/database.service');
async function check() {
  try { console.info(JSON.stringify(await inspectDatabase())); }
  catch (error) { console.error(JSON.stringify({ connected: false, code: safeDatabaseCode(error) })); process.exitCode = 1; }
  finally { await disconnectDatabase(); }
}
check();
