import { defineConfig } from 'prisma/config';

// Deliberately does not load dotenv: only the disposable runner supplies this URL.
const url = new URL(process.env.DATABASE_URL ?? '');
if (process.env.BACKUP_RESTORE_TEST_ISOLATED !== '1'
    || url.hostname !== '127.0.0.1'
    || !['/mhc_backup_source', '/mhc_backup_restored'].includes(url.pathname)) {
  throw new Error('Backup migration config requires the isolated runner');
}

export default defineConfig({
  schema: '../prisma/schema.prisma',
  migrations: { path: '../prisma/migrations' },
  datasource: { url: url.toString() },
});
