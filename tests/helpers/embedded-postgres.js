const net = require('node:net');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');

async function unusedPort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

function createEmbeddedPostgres(EmbeddedPostgres, options) {
  try {
    os.userInfo();
    return withSafeStop(new EmbeddedPostgres(options));
  } catch (error) {
    // Node's Windows user lookup can fail in restricted runners even though
    // embedded-postgres only needs uid=0 detection to select Unix ownership.
    if (error?.code !== 'ERR_SYSTEM_ERROR' || error?.syscall !== 'uv_os_get_passwd') throw error;
    const originalUserInfo = os.userInfo;
    os.userInfo = () => ({ uid: null, gid: null, username: 'test', homedir: os.tmpdir(), shell: '' });
    syncBuiltinESMExports();
    try { return withSafeStop(new EmbeddedPostgres(options)); }
    finally {
      os.userInfo = originalUserInfo;
      syncBuiltinESMExports();
    }
  }
}

function withSafeStop(cluster) {
  cluster.stop = () => new Promise(resolve => {
    const child = cluster.process;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      cluster.process = undefined;
      resolve();
      return;
    }
    let settled = false;
    let timer;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cluster.process = undefined;
      resolve();
    };
    child.once('exit', finish);
    child.once('close', finish);
    if (process.platform === 'win32' && child.pid) {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/F', '/T'], { windowsHide: true });
      killer.once('error', () => child.kill());
      killer.once('close', code => { if (code !== 0 && child.exitCode === null) child.kill(); });
    } else child.kill('SIGINT');
    timer = setTimeout(() => { if (child.exitCode === null) child.kill(); finish(); }, 10000);
    timer.unref();
  });
  return cluster;
}

module.exports = { createEmbeddedPostgres, unusedPort, withSafeStop };
