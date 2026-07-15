/**
 * Applies SQL migrations in supabase/migrations/ in filename order.
 *
 *   node scripts/migrate.mjs            # apply pending migrations
 *   node scripts/migrate.mjs --status   # list applied/pending, change nothing
 *
 * Each file runs once, inside a transaction, and is recorded in schema_migrations.
 * A failing migration rolls back and aborts the run, so a partial file is never
 * recorded as applied.
 *
 * Requires DATABASE_URL in .env.local (the IPv4 Session Pooler URI — the direct
 * db.<ref>.supabase.co host is IPv6-only and unreachable from many networks).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('\nDATABASE_URL is not set in .env.local.\n');
  process.exit(1);
}

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'supabase/migrations');
const statusOnly = process.argv.includes('--status');

const client = new pg.Client({
  connectionString: DATABASE_URL,
  // Supabase terminates TLS at the pooler with a cert this client won't chain to.
  ssl: { rejectUnauthorized: false }
});

function sha256(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

async function main() {
  await client.connect();

  await client.query(`
    create table if not exists public.schema_migrations (
      name        text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    );
  `);

  const { rows: appliedRows } = await client.query(
    'select name, checksum from public.schema_migrations'
  );
  const applied = new Map(appliedRows.map(r => [r.name, r.checksum]));

  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  if (files.length === 0) {
    console.log('No migration files found.');
    return;
  }

  const pending = [];
  console.log('');
  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const sum = sha256(sql);
    if (applied.has(file)) {
      // A changed checksum means an already-applied file was edited. Editing
      // applied migrations silently desyncs environments — add a new file instead.
      const drift = applied.get(file) !== sum;
      console.log(`  [applied] ${file}${drift ? `  ** CHECKSUM DRIFT (db=${applied.get(file)} file=${sum}) **` : ''}`);
    } else {
      console.log(`  [pending] ${file}`);
      pending.push({ file, sql, sum });
    }
  }
  console.log('');

  if (statusOnly) {
    console.log(`${applied.size} applied, ${pending.length} pending. No changes made.\n`);
    return;
  }
  if (pending.length === 0) {
    console.log('Nothing to apply — database is up to date.\n');
    return;
  }

  for (const { file, sql, sum } of pending) {
    process.stdout.write(`Applying ${file} ... `);
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query(
        'insert into public.schema_migrations (name, checksum) values ($1, $2)',
        [file, sum]
      );
      await client.query('commit');
      console.log('ok');
    } catch (err) {
      await client.query('rollback');
      console.log('FAILED (rolled back)');
      console.error(`\n${err.message}\n`);
      process.exitCode = 1;
      return;
    }
  }
  console.log('\nAll pending migrations applied.\n');
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => client.end());
