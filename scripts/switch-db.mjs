/**
 * Prisma wants the datasource provider as a literal, so switching between the
 * SQLite file used for local work and the Postgres server used in production
 * is a one-line edit. This does that edit and nothing else.
 *
 *   node scripts/switch-db.mjs postgresql
 *   node scripts/switch-db.mjs sqlite
 */
import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];
if (!['sqlite', 'postgresql'].includes(target)) {
  console.error('Укажи провайдер: sqlite | postgresql');
  process.exit(1);
}

const path = new URL('../prisma/schema.prisma', import.meta.url);
const source = readFileSync(path, 'utf8');
const next = source.replace(/provider = "(sqlite|postgresql)"\n(\s*)url/, `provider = "${target}"\n$2url`);

if (next === source) {
  console.log(`Уже ${target}, ничего не менял.`);
} else {
  writeFileSync(path, next);
  console.log(`Провайдер переключён на ${target}.`);
  console.log('Дальше: поправь DATABASE_URL в .env и выполни `npx prisma migrate deploy`.');
}
