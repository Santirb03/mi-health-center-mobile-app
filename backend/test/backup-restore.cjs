// No external database argument, dotenv, Stripe connection or production backup.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const root = path.resolve(__dirname, '..');
const name = `mhc-backup-test-${randomUUID()}`;
const password = randomUUID();
const sourceName = 'mhc_backup_source';
const targetName = 'mhc_backup_restored';
const archive = '/tmp/mhc-recovery.dump';
let started = false;
let source;
let target;
let prisma;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024, ...options,
  });
  if (result.error || result.status !== 0) {
    // Never echo connection URLs or credentials in diagnostics.
    const detail = String(result.stderr || result.error?.message || 'Command failed').replaceAll(password, '[redacted]');
    throw new Error(detail);
  }
  return result.stdout.trim();
}
const docker = (...args) => run('docker', args);
const exec = (...args) => docker('exec', name, ...args);

function migrate(url, action) {
  const packagePath = require.resolve('prisma/package.json');
  const cli = path.resolve(path.dirname(packagePath), JSON.parse(readFileSync(packagePath, 'utf8')).bin.prisma);
  run(process.execPath, [cli, 'migrate', action, '--config', 'test/backup-prisma.config.ts'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: url, BACKUP_RESTORE_TEST_ISOLATED: '1' },
  });
}

async function snapshot(client) {
  const tables = (await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`)).rows;
  const rows = {};
  for (const { tablename } of tables) {
    const quoted = '"' + tablename.replaceAll('"', '""') + '"';
    rows[tablename] = (await client.query(`SELECT to_jsonb(t) AS value FROM public.${quoted} t ORDER BY id`)).rows;
  }
  const constraints = (await client.query(`
    SELECT c.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
    ORDER BY c.relname, con.conname`)).rows;
  const indexes = (await client.query(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname`)).rows;
  const enums = (await client.query(`SELECT t.typname, e.enumlabel, e.enumsortorder
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'
    ORDER BY t.typname, e.enumsortorder`)).rows;
  return { rows, constraints, indexes, enums };
}

async function main() {
  assert.equal(process.argv.length, 2, 'This test accepts no database or file arguments');
  docker('info', '--format', '{{.ServerVersion}}');
  docker('run', '--detach', '--rm', '--name', name,
    '--tmpfs', '/var/lib/postgresql/data', '--publish', '127.0.0.1::5432',
    '--env', 'POSTGRES_USER=postgres', '--env', `POSTGRES_PASSWORD=${password}`,
    '--env', `POSTGRES_DB=${sourceName}`, 'postgres:16');
  started = true;
  const port = docker('port', name, '5432/tcp').split(':').pop();
  const sourceUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/${sourceName}`;
  const targetUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/${targetName}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = new Client({ connectionString: sourceUrl, connectionTimeoutMillis: 1000 });
    try { await candidate.connect(); source = candidate; break; }
    catch { await candidate.end().catch(() => {}); await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  assert.ok(source, 'Disposable PostgreSQL did not become ready');
  console.log('Applying repository migrations to disposable source database.');
  migrate(sourceUrl, 'deploy');
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: sourceUrl }) });
  const user = await prisma.user.create({ data: {
    email: 'backup-doctor@example.invalid', passwordHash: 'synthetic-not-a-login-hash',
    doctorProfile: { create: { firstName: 'Doctora', lastName: 'Prueba Álvarez' } },
  }, include: { doctorProfile: true } });
  await prisma.user.create({ data: {
    email: 'backup-admin@example.invalid', passwordHash: 'synthetic-not-a-login-hash', role: 'ADMIN',
  } });
  const doctorId = user.doctorProfile.id;
  const room = await prisma.room.create({ data: { name: 'Consultorio ficticio', pricePerHour: '350.50' } });
  const startTime = new Date('2035-01-10T14:00:00.000Z');
  const endTime = new Date('2035-01-10T15:00:00.000Z');
  const reservation = await prisma.reservation.create({ data: {
    doctorId, roomId: room.id, startTime, endTime, status: 'CONFIRMED', totalPrice: '350.50',
    payment: { create: { amount: '350.50', status: 'PAID', provider: 'stripe', transactionId: 'pi_synthetic_backup' } },
  } });
  await prisma.reservation.create({ data: {
    doctorId, roomId: room.id, startTime: endTime, endTime: new Date('2035-01-10T16:00:00Z'),
    totalPrice: '350.50', expiresAt: new Date('2035-01-01T00:08:00Z'),
  } });
  await prisma.roomBlock.create({ data: {
    roomId: room.id, startTime: new Date('2035-01-11T14:00:00Z'), endTime: new Date('2035-01-11T15:00:00Z'), reason: 'Mantenimiento ficticio',
  } });
  const patient = await prisma.patient.create({ data: { doctorId, firstName: 'Paciente', lastName: 'Ficticio' } });
  await prisma.appointment.create({ data: { doctorId, patientId: patient.id, roomId: room.id, startTime, endTime } });
  await prisma.stripeWebhookEvent.create({ data: { id: 'evt_synthetic_backup', type: 'payment_intent.succeeded' } });
  const expected = await snapshot(source);
  assert.ok(expected.rows._prisma_migrations.length > 0);
  assert.ok(expected.constraints.length > 0 && expected.indexes.length > 0);
  for (const [table, rows] of Object.entries(expected.rows)) {
    assert.ok(rows.length > 0, `Add a synthetic fixture for new table ${table}`);
  }
  console.log('Creating custom-format backup with pg_dump 16.');
  exec('pg_dump', '-U', 'postgres', '-d', sourceName, '--format=custom', '--no-acl', '--file', archive);
  const checksum = exec('sha256sum', archive).split(' ')[0];
  assert.match(checksum, /^[a-f0-9]{64}$/);
  assert.ok(exec('pg_restore', '--list', archive).includes('_prisma_migrations'));

  // A write AFTER the backup must not appear in the restored snapshot.
  await prisma.user.create({ data: {
    email: 'after-backup@example.invalid', passwordHash: 'synthetic-not-a-login-hash',
  } });
  exec('createdb', '-U', 'postgres', '--template=template0', targetName);
  target = new Client({ connectionString: targetUrl });
  await target.connect();
  assert.equal((await target.query(`SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'public'`)).rows[0].count, 0);
  console.log('Restoring into a separate empty database.');
  exec('pg_restore', '-U', 'postgres', '-d', targetName, '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction', archive);
  assert.equal(exec('sha256sum', archive).split(' ')[0], checksum);
  assert.deepEqual(await snapshot(target), expected, 'Restored data/schema differ from backup source');
  migrate(targetUrl, 'status');
  await assert.rejects(target.query('UPDATE reservations SET "roomId" = $1 WHERE id = $2', ['missing-room', reservation.id]), { code: '23503' });
  await assert.rejects(target.query('UPDATE users SET email = $1 WHERE id = $2', ['backup-admin@example.invalid', user.id]), { code: '23505' });
  assert.deepEqual(await snapshot(target), expected);
  const rowCount = Object.values(expected.rows).reduce((sum, rows) => sum + rows.length, 0);
  console.log(`Backup/restore passed: ${Object.keys(expected.rows).length} tables, ${rowCount} rows, migrations, indexes, enums, foreign keys and uniqueness verified.`);
  console.log('The post-backup user was not restored: later registrations require a final migration sync.');
}

main().catch((error) => {
  // Assertions contain only synthetic data, but keep output compact and secret-free.
  console.error(String(error.message).replaceAll(password, '[redacted]').slice(0, 3000));
  process.exitCode = 1;
}).finally(async () => {
  await prisma?.$disconnect().catch(() => {});
  await source?.end().catch(() => {});
  await target?.end().catch(() => {});
  if (started) {
    try { docker('stop', '--time', '1', name); console.log('Disposable container and backup removed.'); }
    catch { console.error(`Cleanup failed; remove only test container ${name}.`); process.exitCode = 1; }
  }
});
