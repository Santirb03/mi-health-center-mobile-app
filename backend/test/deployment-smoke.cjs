// Invoked exclusively by the disposable-database runner.
const { spawn, spawnSync } = require('node:child_process');
const { createServer } = require('node:net');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');

async function main() {
  assert.equal(process.env.DEPLOYMENT_TEST_ISOLATED, '1');
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/mhc_payment_test');
  const env = {
    ...process.env, NODE_ENV: 'production', E2E_INTEGRATION_ISOLATED: '1',
    JWT_SECRET: randomBytes(32).toString('hex'),
    STRIPE_SECRET_KEY: 'sk_test_unused', STRIPE_WEBHOOK_SECRET: 'whsec_unused',
    TRUST_PROXY_IPS: '',
  };
  const prismaPackage = require.resolve('prisma/package.json');
  const prisma = path.resolve(path.dirname(prismaPackage), JSON.parse(readFileSync(prismaPackage, 'utf8')).bin.prisma);
  for (const args of [['migrate', 'deploy'], ['migrate', 'deploy'], ['migrate', 'status']]) {
    const result = spawnSync(process.execPath, [prisma, ...args], { env, stdio: 'inherit', timeout: 60000 });
    if (result.error || result.status !== 0) throw new Error('Migration verification failed');
  }
  // Select an unused local port; this process owns only the child it starts.
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  env.PORT = String(socket.address().port);
  await new Promise((resolve) => socket.close(resolve));
  const start = JSON.parse(readFileSync('package.json', 'utf8')).scripts['start:prod'];
  assert.equal(start, 'node dist/src/main.js');
  const child = spawn(process.execPath, [start.slice(5)], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let diagnostics = '';
  child.stderr.on('data', (chunk) => { diagnostics = (diagnostics + chunk).slice(-4000); });
  let exited = false;
  child.once('exit', () => { exited = true; });
  const stopped = once(child, 'exit');
  try {
    let ready = false;
    for (let attempt = 0; attempt < 240; attempt++) {
      if (exited) {
        console.error(diagnostics.replaceAll(env.DATABASE_URL, '[database]').replaceAll(env.JWT_SECRET, '[secret]'));
        throw new Error('Compiled server exited before readiness');
      }
      try {
        const response = await fetch(`http://127.0.0.1:${env.PORT}/health/ready`, { signal: AbortSignal.timeout(1000) });
        if (response.status === 200) {
          assert.deepEqual(await response.json(), { status: 'ok', database: 'up' });
          ready = true;
          break;
        }
      } catch { /* Retry while the server starts. */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'Compiled server did not become ready');
    const live = await fetch(`http://127.0.0.1:${env.PORT}/health`, { signal: AbortSignal.timeout(2000) });
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: 'ok' });
    console.log('Deployment smoke passed: migrations twice, migration status, compiled server and health routes.');
  } finally {
    if (!exited) child.kill();
    await stopped;
  }
}
main().catch(() => { console.error('Deployment smoke failed; inspect migrations/build and retry.'); process.exitCode = 1; });
