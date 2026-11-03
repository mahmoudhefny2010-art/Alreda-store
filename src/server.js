require('dotenv').config({ quiet: true });
const { readEnvironment } = require('./config/environment');
const { createApp } = require('./app');
const { createServer } = require('node:http');
const { connectDatabase, safeDatabaseCode } = require('./services/database.service');
const { disconnectDatabase } = require('./config/prisma');
const { createNotificationWorker } = require('./services/notification-worker.service');
const { createCloudinaryCleanupWorker } = require('./services/cloudinary-cleanup-worker.service');

const environment = readEnvironment();
const server = createServer(createApp({ environment: environment.NODE_ENV }));
let stopNotificationWorker = null;
let stopCloudinaryCleanupWorker = null;
server.once('listening', () => {
  console.info(`Alreda Store available at http://${environment.HOST}:${environment.PORT}`);
  stopNotificationWorker = createNotificationWorker().start();
  stopCloudinaryCleanupWorker = createCloudinaryCleanupWorker().start();
});
server.on('error', async error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Server failed to start: port ${environment.PORT} is already in use. Stop the other server or set PORT to an available port in .env, then restart npm run dev.`);
  } else if (error.code === 'EACCES' || error.code === 'EPERM') {
    console.error('Server failed to start: permission denied for the configured host or port. Choose an available unprivileged PORT in .env and check local network restrictions.');
  } else if (error.code === 'EADDRNOTAVAIL' || error.code === 'ENOTFOUND') {
    console.error('Server failed to start: HOST is unavailable. For local development, set HOST=127.0.0.1 in .env.');
  } else {
    console.error('Server failed to start. Check HOST and PORT in .env and local network restrictions.');
  }
  process.exitCode = 1;
  await disconnectDatabase().catch(() => {});
});
connectDatabase().then(() => server.listen(environment.PORT, environment.HOST)).catch(async error => {
  console.error(JSON.stringify({ event: 'database_startup_failed', code: safeDatabaseCode(error) }));
  process.exitCode = 1;
  await disconnectDatabase().catch(() => {});
});
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopNotificationWorker?.();
  stopCloudinaryCleanupWorker?.();
  server.close(async () => { await disconnectDatabase().catch(() => {}); process.exitCode = 0; });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
