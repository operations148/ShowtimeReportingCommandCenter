/**
 * Entitlement preflight. Run: npx tsx scripts/audit-entitlements.ts
 *
 * Prints the live access decision the requireAuth() gate would make for every workspace,
 * reading real rows and running the real derivation. Run this BEFORE deploying any change
 * to the gate or the entitlement schema — it is the difference between finding out here
 * and finding out from a locked-out client.
 *
 * Read-only. Exits non-zero if any workspace would currently be denied.
 */

import pg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';
import { deriveEntitlement } from '../src/entitlements.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true });

if (!process.env.DATABASE_URL) {
  console.error('\nDATABASE_URL is not set in .env.local.\n');
  process.exit(1);
}

async function main() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  try {
    const { rows } = await client.query(`
      select w.id, w.name, w.suspended, w.trial_started_at, w.trial_ends_at, w.trial_used,
             w.trial_extension_count, w.license_status, w.licensed_at, w.licensed_by_user_id,
             w.license_reference,
             (select count(*) from public.workspace_members m where m.workspace_id = w.id) as members
      from public.workspaces w
      order by w.id
    `);

    const denied: string[] = [];

    console.log(`\n  ${rows.length} workspace(s)\n`);
    for (const r of rows) {
      const ent = deriveEntitlement({
        trialStartedAt: r.trial_started_at?.toISOString() ?? null,
        trialEndsAt: r.trial_ends_at?.toISOString() ?? null,
        trialUsed: r.trial_used,
        trialExtensionCount: r.trial_extension_count,
        licenseStatus: r.license_status,
        licensedAt: r.licensed_at?.toISOString() ?? null,
        suspended: r.suspended
      });

      const mark = ent.hasAccess ? 'OK  ' : 'DENY';
      const days = ent.trialDaysRemaining === null ? '' : `  trial_days=${ent.trialDaysRemaining}`;
      const backfilled = r.license_reference === 'BACKFILL_0004_PRE_ENTITLEMENT' ? '  [grandfathered]' : '';

      console.log(`  ${mark}  ${String(r.id).padEnd(18)} ${String(r.name).padEnd(26)} access=${ent.accessStatus.padEnd(11)} trial=${ent.trialStatus.padEnd(14)} members=${r.members}${days}${backfilled}`);
      if (!ent.hasAccess) {
        denied.push(`${r.id} (${r.name}, ${r.members} members): ${ent.denialReason}`);
      }
    }

    if (denied.length) {
      console.log(`\n  ${denied.length} workspace(s) WOULD BE DENIED by the gate:\n`);
      denied.forEach(d => console.log(`    - ${d}`));
      console.log('');
      process.exitCode = 1;
    } else {
      console.log('\n  All workspaces currently have access. Gate is safe to deploy.\n');
    }
  } finally {
    await client.end();
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
