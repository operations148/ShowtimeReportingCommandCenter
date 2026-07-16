/**
 * Grants SUPER_ADMIN to one or more accounts, creating the auth user if needed.
 *
 *   node scripts/grant-super-admin.mjs <accounts.json>
 *
 * accounts.json (keep OUT of version control — it holds passwords):
 *   [{ "email": "a@b.com", "password": "…", "name": "Full Name" }]
 *
 * Idempotent: existing users have their password reset and role upgraded; new users are
 * created email-confirmed. Membership is upserted on (workspace_id, user_id), so re-running
 * never duplicates rows. Super admins see and manage every workspace, so which workspace
 * they are a member of only needs to exist — ws_showtime is used as the anchor.
 *
 * Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL in .env.local.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true });

const ANCHOR_WORKSPACE = 'ws_showtime';

const accountsPath = process.argv[2];
if (!accountsPath) {
  console.error('\nUsage: node scripts/grant-super-admin.mjs <accounts.json>\n');
  process.exit(1);
}
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DATABASE_URL) {
  console.error('\nMissing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / DATABASE_URL in .env.local.\n');
  process.exit(1);
}

const accounts = JSON.parse(readFileSync(accountsPath, 'utf8'));
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const db = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function findAuthUserId(email) {
  // auth.users is reachable over the direct pg connection; the admin API has no
  // get-by-email, and paging listUsers() is fragile at scale.
  const { rows } = await db.query('select id from auth.users where lower(email) = lower($1) limit 1', [email]);
  return rows[0]?.id ?? null;
}

async function run() {
  await db.connect();
  try {
    // Confirm the anchor workspace exists before granting anyone membership in it.
    const ws = await db.query('select id from public.workspaces where id = $1', [ANCHOR_WORKSPACE]);
    if (ws.rowCount === 0) throw new Error(`Anchor workspace ${ANCHOR_WORKSPACE} not found.`);

    for (const acct of accounts) {
      const email = String(acct.email).trim();
      const name = acct.name || email.split('@')[0];
      if (!email || !acct.password) { console.log(`  skip: ${email || '(no email)'} — email and password required`); continue; }

      let userId = await findAuthUserId(email);

      if (userId) {
        const { error } = await supa.auth.admin.updateUserById(userId, {
          password: acct.password,
          email_confirm: true,
          user_metadata: { name, active_workspace_id: ANCHOR_WORKSPACE }
        });
        if (error) throw new Error(`update ${email}: ${error.message}`);
        console.log(`  updated auth user  ${email}  (${userId})`);
      } else {
        const { data, error } = await supa.auth.admin.createUser({
          email,
          password: acct.password,
          email_confirm: true,
          user_metadata: { name, active_workspace_id: ANCHOR_WORKSPACE }
        });
        if (error) throw new Error(`create ${email}: ${error.message}`);
        userId = data.user.id;
        console.log(`  created auth user  ${email}  (${userId})`);
      }

      // Profile — onboarded so the account lands straight in the app, not the wizard.
      await db.query(
        `insert into public.profiles (id, name, onboarded) values ($1, $2, true)
         on conflict (id) do update set name = excluded.name, onboarded = true`,
        [userId, name]
      );

      // Membership — SUPER_ADMIN, upserted on the (workspace_id, user_id) unique key.
      await db.query(
        `insert into public.workspace_members (id, workspace_id, user_id, role, joined_at)
         values ($1, $2, $3, 'SUPER_ADMIN', now())
         on conflict (workspace_id, user_id) do update set role = 'SUPER_ADMIN'`,
        [`mem_sa_${userId.slice(0, 8)}`, ANCHOR_WORKSPACE, userId]
      );

      console.log(`  -> SUPER_ADMIN granted to ${email}\n`);
    }

    console.log('Done. These accounts can now sign in and manage access for every workspace.\n');
  } finally {
    await db.end();
  }
}

run().catch(err => { console.error('\nFAILED:', err.message, '\n'); process.exitCode = 1; });
