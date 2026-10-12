// Only disposable PostgreSQL: never reads dotenv or connects to the application's DB.
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { verifyAppointmentConstraints } = require('./appointment-constraints.cjs');
const name = `mhc-appointment-probe-${randomUUID()}`;
const password = randomUUID();
let started = false;
let client;
function docker(...args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 120000 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr);
  return result.stdout.trim();
}
async function main() {
  docker('info', '--format', '{{.ServerVersion}}');
  docker('run', '--detach', '--rm', '--name', name, '--tmpfs', '/var/lib/postgresql/data',
    '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_USER=postgres',
    '--env', `POSTGRES_PASSWORD=${password}`, '--env', 'POSTGRES_DB=mhc_appointment_probe', 'postgres:16');
  started = true;
  const port = docker('port', name, '5432/tcp').split(':').pop();
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/mhc_appointment_probe`;
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = new Client({ connectionString: url, connectionTimeoutMillis: 1000 });
    try { await candidate.connect(); client = candidate; break; }
    catch { await candidate.end().catch(() => {}); await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  if (!client) throw new Error('Disposable database not ready');
  const packagePath = require.resolve('prisma/package.json');
  const cli = path.resolve(path.dirname(packagePath), JSON.parse(readFileSync(packagePath, 'utf8')).bin.prisma);
  const env = { ...process.env, DATABASE_URL: url };
  for (const args of [['migrate', 'deploy'], ['migrate', 'deploy']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { env, stdio: 'inherit', timeout: 120000 });
    if (result.error || result.status !== 0) throw new Error('Migration failed');
    console.log('CATALOG VERIFIED', JSON.stringify(await verifyAppointmentConstraints(client)));
  }
  const diff = spawnSync(process.execPath, [cli, 'migrate', 'diff', '--from-config-datasource',
    '--to-schema', 'prisma/schema.prisma', '--script', '--exit-code'], { env, encoding: 'utf8', timeout: 120000 });
  console.log('PRISMA MIGRATE DIFF:', (diff.stdout || '') + (diff.stderr || ''));
  if (diff.error || diff.status !== 0) throw new Error('STOP: migration drift detected');
  console.log('Appointment migration probe passed: empty database, repeated deploy and no Prisma drift.');
  const { PrismaClient } = require('@prisma/client');
  const { PrismaPg } = require('@prisma/adapter-pg');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const user = await prisma.user.create({ data: { email: 'probe@example.invalid', passwordHash: 'synthetic',
      doctorProfile: { create: { firstName: 'Synthetic', lastName: 'Doctor' } } }, include: { doctorProfile: true } });
    const patient = await prisma.patient.create({ data: { doctorId: user.doctorProfile.id, firstName: 'Synthetic', lastName: 'Patient' } });
    const data = { doctorId: user.doctorProfile.id, patientId: patient.id,
      startTime: new Date('2090-01-01T15:00:00Z'), endTime: new Date('2090-01-01T16:00:00Z') };
    await prisma.appointment.create({ data });
    try { await prisma.appointment.create({ data }); throw new Error('EXCLUDE did not reject duplicate'); }
    catch (error) {
      if (error.meta?.driverAdapterError?.cause?.originalCode !== '23P01') throw error;
      console.log('REAL EXCLUDE ERROR', JSON.stringify(error, (key, value) =>
        !key || ['name', 'code', 'meta', 'modelName', 'driverAdapterError', 'cause', 'kind', 'originalCode', 'constraint'].includes(key) ? value : undefined));
    }
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  await client?.end();
  if (started) docker('stop', name);
});
