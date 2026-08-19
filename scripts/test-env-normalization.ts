/**
 * Tests normalizeEnvValue() against every corruption pattern documented in this project's
 * incident history. Run: npx tsx scripts/test-env-normalization.ts
 *
 * Pure function, no network, no database — these assert the exact defect (BOM-prefixed
 * SUPABASE_URL, commit f39a00f) can never again reach fetch() as an invalid URL undetected.
 */

import { normalizeEnvValue } from '../src/supabase.js';

let passed = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; } else { failures.push(`${name}\n      expected: ${e}\n      actual:   ${a}`); }
}

// Generic fixture on purpose — no real project reference belongs in a committed test.
const CLEAN_URL = 'https://example-project-ref.supabase.co';
const CLEAN_KEY = 'FAKE-SERVICE-KEY-not-a-real-credential';
const BOM = '﻿';

// --- the actual historical defect -------------------------------------------------------
check('BOM-prefixed URL (commit f39a00f defect) is stripped',
  normalizeEnvValue(BOM + CLEAN_URL), CLEAN_URL);

// --- whitespace ---------------------------------------------------------------------------
check('leading whitespace trimmed', normalizeEnvValue('  ' + CLEAN_URL), CLEAN_URL);
check('trailing whitespace trimmed', normalizeEnvValue(CLEAN_URL + '  '), CLEAN_URL);
check('leading+trailing whitespace trimmed', normalizeEnvValue('  ' + CLEAN_URL + '\n'), CLEAN_URL);

// --- wrapping quotes ------------------------------------------------------------------------
check('double-quote wrapped value unwrapped', normalizeEnvValue(`"${CLEAN_URL}"`), CLEAN_URL);
check('single-quote wrapped value unwrapped', normalizeEnvValue(`'${CLEAN_URL}'`), CLEAN_URL);

// --- compound corruption: quotes wrapping a BOM'd value ------------------------------------
check('quotes wrapping a BOM-prefixed value: both removed',
  normalizeEnvValue(`"${BOM}${CLEAN_URL}"`), CLEAN_URL);
check('BOM outside quotes, quotes inside: still fully clean',
  normalizeEnvValue(`${BOM}"${CLEAN_URL}"`), CLEAN_URL);

// --- edge cases -----------------------------------------------------------------------------
check('empty string stays empty', normalizeEnvValue(''), '');
check('undefined stays empty', normalizeEnvValue(undefined), '');
check('whitespace-only becomes empty', normalizeEnvValue('   '), '');
check('unmatched quote is NOT stripped (would corrupt a value containing a real quote)',
  normalizeEnvValue(`"${CLEAN_URL}`), `"${CLEAN_URL}`);
check('service-role key format is untouched by normalization', normalizeEnvValue(CLEAN_KEY), CLEAN_KEY);
check('BOM-prefixed key is stripped', normalizeEnvValue(BOM + CLEAN_KEY), CLEAN_KEY);

// --- URL-specific behaviour, exercised via the same helpers supabase.ts uses ---------------
check('trailing slash on URL is a normalize() question, not this function’s',
  normalizeEnvValue(CLEAN_URL + '/'), CLEAN_URL + '/'); // stripTrailingSlash is a separate, composed step

let urlParseOk = true;
try { new URL(normalizeEnvValue(BOM + '  ' + CLEAN_URL + '  ')); } catch { urlParseOk = false; }
check('fully corrupted URL (BOM + whitespace) parses cleanly after normalization', urlParseOk, true);

let invalidUrlRejected = false;
try { new URL(normalizeEnvValue('not-a-url')); } catch { invalidUrlRejected = true; }
check('genuinely invalid URL still fails URL parsing (normalization does not fabricate validity)',
  invalidUrlRejected, true);

console.log('');
if (failures.length === 0) {
  console.log(`  All ${passed} env-normalization assertions passed.\n`);
} else {
  console.log(`  ${passed} passed, ${failures.length} FAILED:\n`);
  failures.forEach(f => console.log(`  x ${f}\n`));
  process.exitCode = 1;
}
