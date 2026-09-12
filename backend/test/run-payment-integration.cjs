// Always creates its own disposable database; never reads the application's .env.
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const name = `mhc-payment-tests-${randomUUID()}`;
const password = randomUUID();
let started = false;

function docker(args) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 120000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      result.error?.message || result.stderr || 'Docker command failed',
    );
  }
  return result.stdout.trim();
}

async function main() {
  docker(['info', '--format', '{{.ServerVersion}}']);
  docker([
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '--publish',
    '127.0.0.1::5432',
    '--env',
    'POSTGRES_USER=postgres',
    '--env',
    `POSTGRES_PASSWORD=${password}`,
    '--env',
    'POSTGRES_DB=mhc_payment_test',
    'postgres:16',
  ]);
  started = true;
  const port = docker(['port', name, '5432/tcp']).split(':').pop();
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/mhc_payment_test`;
  let client;
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = new Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 1000,
    });
    try {
      await candidate.connect();
      client = candidate;
      break;
    } catch {
      await candidate.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  if (!client) throw new Error('Disposable PostgreSQL did not become ready');
  try {
    const migrations = path.join(root, 'prisma', 'migrations');
    for (const entry of readdirSync(migrations, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))) {
      await client.query(
        readFileSync(
          path.join(migrations, entry.name, 'migration.sql'),
          'utf8',
        ),
      );
    }
  } finally {
    await client.end();
  }
  console.log(
    'Running payment regressions against disposable PostgreSQL 16 (Stripe mocked).',
  );
  const result = spawnSync(
    process.execPath,
    [
      require.resolve('jest/bin/jest'),
      '--config',
      'test/jest-payment-integration.json',
      '--runInBand',
      '--no-cache',
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        PAYMENT_INTEGRATION_ISOLATED: '1',
      },
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    if (started) {
      try {
        docker(['stop', '--time', '1', name]);
      } catch (error) {
        console.error(
          `Could not stop test container ${name}: ${error.message}`,
        );
        process.exitCode = 1;
      }
    }
  });
