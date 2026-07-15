/**
 * Entitlement state machine tests. Run: npx tsx scripts/test-entitlements.ts
 *
 * Pure functions against a frozen clock — no database, no network. These assert the
 * commercial rules of the access model, so a failure here means someone can be billed
 * wrongly or locked out wrongly.
 */

import {
  deriveEntitlement,
  deriveTrialStatus,
  newTrialWindow,
  trialNoticeThreshold,
  TRIAL_DURATION_DAYS,
  type EntitlementFacts
} from '../src/entitlements.js';

const NOW = Date.parse('2026-07-16T12:00:00.000Z');
const DAY = 86_400_000;

let passed = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; } else { failures.push(`${name}\n      expected: ${e}\n      actual:   ${a}`); }
}

/** Facts for a workspace whose trial ends `daysFromNow` days out. */
function trialing(daysFromNow: number, over: Partial<EntitlementFacts> = {}): EntitlementFacts {
  return {
    trialStartedAt: new Date(NOW - (TRIAL_DURATION_DAYS - daysFromNow) * DAY).toISOString(),
    trialEndsAt: new Date(NOW + daysFromNow * DAY).toISOString(),
    trialUsed: true,
    trialExtensionCount: 0,
    licenseStatus: 'NONE',
    suspended: false,
    licensedAt: null,
    ...over
  };
}

const fresh: EntitlementFacts = {
  trialStartedAt: null, trialEndsAt: null, trialUsed: false, trialExtensionCount: 0,
  licenseStatus: 'NONE', licensedAt: null, suspended: false
};

// --- trial status derivation ------------------------------------------------
check('no trial, no licence -> NOT_STARTED', deriveTrialStatus(fresh, NOW), 'NOT_STARTED');
check('14 days left -> ACTIVE', deriveTrialStatus(trialing(14), NOW), 'ACTIVE');
check('4 days left -> ACTIVE', deriveTrialStatus(trialing(4), NOW), 'ACTIVE');
check('3 days left -> EXPIRING_SOON', deriveTrialStatus(trialing(3), NOW), 'EXPIRING_SOON');
check('1 day left -> EXPIRING_SOON', deriveTrialStatus(trialing(1), NOW), 'EXPIRING_SOON');
check('0 days left -> EXPIRED', deriveTrialStatus(trialing(0), NOW), 'EXPIRED');
check('elapsed -> EXPIRED', deriveTrialStatus(trialing(-1), NOW), 'EXPIRED');
check('extended trial -> ADMIN_EXTENDED', deriveTrialStatus(trialing(10, { trialExtensionCount: 1 }), NOW), 'ADMIN_EXTENDED');
check('licensed -> CONVERTED', deriveTrialStatus(trialing(5, { licenseStatus: 'LICENSED', licensedAt: new Date(NOW).toISOString() }), NOW), 'CONVERTED');

// A converted org whose old trial window has long elapsed must not report EXPIRED.
check('licensed after trial elapsed -> CONVERTED',
  deriveTrialStatus(trialing(-30, { licenseStatus: 'LICENSED', licensedAt: new Date(NOW).toISOString() }), NOW),
  'CONVERTED');

// --- access decisions -------------------------------------------------------
check('live trial has access', deriveEntitlement(trialing(5), NOW).hasAccess, true);
check('live trial access status', deriveEntitlement(trialing(5), NOW).accessStatus, 'TRIAL');
check('expiring soon still has access', deriveEntitlement(trialing(1), NOW).hasAccess, true);
check('expired trial denied', deriveEntitlement(trialing(0), NOW).hasAccess, false);
check('expired trial status', deriveEntitlement(trialing(-1), NOW).accessStatus, 'EXPIRED');
check('never started denied', deriveEntitlement(fresh, NOW).hasAccess, false);
check('never started status', deriveEntitlement(fresh, NOW).accessStatus, 'NOT_STARTED');

const licensed = trialing(-90, { licenseStatus: 'LICENSED', licensedAt: new Date(NOW).toISOString() });
check('perpetual licence has access long after trial', deriveEntitlement(licensed, NOW).hasAccess, true);
check('perpetual licence status', deriveEntitlement(licensed, NOW).accessStatus, 'LICENSED');
check('licence never expires (10 years on)', deriveEntitlement(licensed, NOW + 3650 * DAY).hasAccess, true);

// --- suspension and revocation outrank everything ---------------------------
check('suspension beats live trial', deriveEntitlement(trialing(5, { suspended: true }), NOW).hasAccess, false);
check('suspension beats licence',
  deriveEntitlement(trialing(-1, { licenseStatus: 'LICENSED', licensedAt: new Date(NOW).toISOString(), suspended: true }), NOW).accessStatus,
  'SUSPENDED');

// Regression: a revoked licence on an org with an unexpired trial window must stay denied.
// If REVOKED fell through to the trial branch, revocation would silently restore access.
check('revoked licence denied despite live trial window',
  deriveEntitlement(trialing(5, { licenseStatus: 'REVOKED' }), NOW).hasAccess, false);
check('revoked licence status', deriveEntitlement(trialing(5, { licenseStatus: 'REVOKED' }), NOW).accessStatus, 'SUSPENDED');

// --- trial window -----------------------------------------------------------
const win = newTrialWindow(NOW);
check('new trial spans exactly 14 days',
  (Date.parse(win.trialEndsAt) - Date.parse(win.trialStartedAt)) / DAY, TRIAL_DURATION_DAYS);
check('new trial is immediately ACTIVE',
  deriveEntitlement({ ...fresh, ...win, trialUsed: true }, NOW).accessStatus, 'TRIAL');
check('new trial reports 14 days remaining',
  deriveEntitlement({ ...fresh, ...win, trialUsed: true }, NOW).trialDaysRemaining, 14);

// --- notice thresholds ------------------------------------------------------
check('8 days -> no notice', trialNoticeThreshold(deriveEntitlement(trialing(8), NOW)), null);
check('7 days -> 7-day notice', trialNoticeThreshold(deriveEntitlement(trialing(7), NOW)), 7);
check('5 days -> still 7-day notice', trialNoticeThreshold(deriveEntitlement(trialing(5), NOW)), 7);
check('2 days -> 3-day notice', trialNoticeThreshold(deriveEntitlement(trialing(2), NOW)), 3);
check('1 day -> 1-day notice', trialNoticeThreshold(deriveEntitlement(trialing(1), NOW)), 1);
check('licensed org raises no trial notice', trialNoticeThreshold(deriveEntitlement(licensed, NOW)), null);

// --- report -----------------------------------------------------------------
console.log('');
if (failures.length === 0) {
  console.log(`  All ${passed} entitlement assertions passed.\n`);
} else {
  console.log(`  ${passed} passed, ${failures.length} FAILED:\n`);
  failures.forEach(f => console.log(`  x ${f}\n`));
  process.exitCode = 1;
}
