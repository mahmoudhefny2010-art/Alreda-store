const fs = require('node:fs/promises');
const path = require('node:path');
const filename = path.resolve(__dirname, '../../data/media/reconciliation.jsonl');
// Durable local reconciliation journal, not a substitute for PostgreSQL associations.
async function recordMediaEvent(event) {
  const safe = Object.fromEntries(['event', 'publicId', 'assetId', 'mediaId', 'code'].filter(key => event[key] !== undefined).map(key => [key, event[key]]));
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.appendFile(filename, JSON.stringify({ ...safe, at: new Date().toISOString() }) + '\n');
}
module.exports = { recordMediaEvent };
