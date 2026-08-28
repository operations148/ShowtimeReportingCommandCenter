/**
 * Pure-logic tests for the Operations Status Template planner.
 *
 * No database, no network, no credentials: planStatusTemplate() is a pure function, so every
 * safety guarantee the apply route depends on is pinned here directly rather than inferred
 * from an integration run. Run with:  npx tsx scripts/test-status-template.ts
 */

import {
  OPERATIONS_STATUS_TEMPLATE, planStatusTemplate, findStatusTemplate,
  STATUS_TEMPLATES, ExistingStatus
} from '../src/tasks/statusTemplates.js';

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) { passed++; return; }
  failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected) ||
    JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const st = (over: Partial<ExistingStatus> & { id: string; name: string }): ExistingStatus => ({
  category: 'todo', color: null, position: 1000, archived_at: null, ...over
});

// ── The template itself ────────────────────────────────────────────────────────────────
const T = OPERATIONS_STATUS_TEMPLATE;

eq('template has exactly seven entries', T.entries.length, 7);
eq('template labels are in the required order',
  T.entries.map(e => e.name),
  ['TO DO', 'IN PROGRESS', 'WAITING', 'REVIEW', 'DONE', 'BLOCKED', 'TO SCHEDULE']);
check('every entry uses an existing category',
  T.entries.every(e => ['todo', 'in_progress', 'done'].includes(e.category)));
check('every entry has a 6-digit hex colour',
  T.entries.every(e => /^#[0-9A-F]{6}$/i.test(e.color)));
eq('exactly one entry is the done category',
  T.entries.filter(e => e.category === 'done').map(e => e.name), ['DONE']);
check('colours are distinct', new Set(T.entries.map(e => e.color)).size === 7);
eq('findStatusTemplate resolves by key', findStatusTemplate('operations')?.key, 'operations');
eq('findStatusTemplate rejects an unknown key', findStatusTemplate('nope'), null);
eq('only the operations template is published', STATUS_TEMPLATES.length, 1);

// ── Empty Space: everything is created ─────────────────────────────────────────────────
{
  const plan = planStatusTemplate([], T);
  eq('empty Space creates all seven', plan.createCount, 7);
  eq('empty Space reuses nothing', plan.reuseCount, 0);
  eq('empty Space keeps nothing', plan.keepCount, 0);
  check('empty Space is not a no-op', plan.noop === false);
  eq('created positions are evenly spaced',
    plan.items.map(i => i.position), [1000, 2000, 3000, 4000, 5000, 6000, 7000]);
  check('no item on an empty Space carries a status id',
    plan.items.every(i => i.statusId === undefined));
}

// ── Partial overlap: only the missing ones are created ─────────────────────────────────
{
  const existing = [
    st({ id: 'a', name: 'To Do', category: 'todo', position: 1000 }),
    st({ id: 'b', name: 'In Progress', category: 'in_progress', position: 2000 }),
    st({ id: 'c', name: 'Done', category: 'done', position: 3000 })
  ];
  const plan = planStatusTemplate(existing, T);
  eq('three matching statuses are reused', plan.reuseCount, 3);
  eq('the other four are created', plan.createCount, 4);
  eq('nothing is kept as an extra', plan.keepCount, 0);
  eq('reused ids are preserved exactly',
    plan.items.filter(i => i.action === 'reuse').map(i => i.statusId), ['a', 'b', 'c']);
  eq('DONE reuses the existing done status id',
    plan.items.find(i => i.name === 'DONE')?.statusId, 'c');
  check('no plan item ever asks for a delete or archive',
    plan.items.every(i => ['reuse', 'create', 'keep'].includes(i.action)));
}

// ── Case- and whitespace-insensitive matching ──────────────────────────────────────────
{
  const existing = [
    st({ id: 'a', name: 'to do' }),
    st({ id: 'b', name: '  In   Progress  ' }),
    st({ id: 'c', name: 'to schedule' })
  ];
  const plan = planStatusTemplate(existing, T);
  eq('lowercase name matches', plan.items.find(i => i.name === 'TO DO')?.action, 'reuse');
  eq('irregular whitespace matches',
    plan.items.find(i => i.name === 'IN PROGRESS')?.statusId, 'b');
  eq('multi-word lowercase matches',
    plan.items.find(i => i.name === 'TO SCHEDULE')?.statusId, 'c');
  eq('only the four genuinely absent are created', plan.createCount, 4);
}

// ── Extra statuses are kept, never deleted — including ones holding tasks ──────────────
{
  const existing = [
    st({ id: 'a', name: 'TO DO' }),
    st({ id: 'x', name: 'Awaiting Parts', position: 5000 }),
    st({ id: 'y', name: 'Cancelled', position: 6000 })
  ];
  const counts = new Map([['x', 12], ['y', 0]]);
  const plan = planStatusTemplate(existing, T, counts);

  const kept = plan.items.filter(i => i.action === 'keep');
  eq('both extras are kept', kept.length, 2);
  eq('a populated extra is still only kept', kept.find(k => k.statusId === 'x')?.action, 'keep');
  eq('its task count is surfaced for the operator',
    kept.find(k => k.statusId === 'x')?.taskCount, 12);
  check('the populated extra explains it is never deleted',
    /never deleted or archived/.test(kept.find(k => k.statusId === 'x')!.note));
  eq('an empty extra is kept too', kept.find(k => k.statusId === 'y')?.action, 'keep');
  check('kept extras sort after the seven template positions',
    kept.every(k => k.position > 7000));
  check('no keep item is ever renamed to a template label',
    kept.map(k => k.name).sort().join(',') === 'Awaiting Parts,Cancelled');
}

// ── Archived statuses are reused and restored, not duplicated ──────────────────────────
{
  const existing = [st({ id: 'r', name: 'REVIEW', archived_at: '2026-01-01T00:00:00.000Z' })];
  const plan = planStatusTemplate(existing, T);
  const review = plan.items.find(i => i.name === 'REVIEW')!;
  eq('an archived match is reused, not re-created', review.action, 'reuse');
  eq('and keeps its id', review.statusId, 'r');
  check('the note says it will be restored', /restores it/.test(review.note));
  eq('so REVIEW is not among the created', plan.createCount, 6);
  check('no duplicate REVIEW is planned',
    plan.items.filter(i => i.name === 'REVIEW').length === 1);
}

// ── Idempotence: applying twice changes nothing the second time ────────────────────────
{
  const applied: ExistingStatus[] = T.entries.map((e, i) =>
    st({ id: `id-${i}`, name: e.name, category: e.category, color: e.color, position: (i + 1) * 1000 }));
  const plan = planStatusTemplate(applied, T);
  eq('a fully-applied Space creates nothing', plan.createCount, 0);
  eq('and reuses all seven', plan.reuseCount, 7);
  check('and reports itself as a no-op', plan.noop === true);
  eq('every id survives untouched',
    plan.items.map(i => i.statusId), applied.map(a => a.id));
}

// ── A matching set in the WRONG order is a real change, not a no-op ────────────────────
{
  const scrambled: ExistingStatus[] = T.entries.map((e, i) =>
    st({ id: `id-${i}`, name: e.name, position: (7 - i) * 1000 }));
  const plan = planStatusTemplate(scrambled, T);
  eq('nothing needs creating', plan.createCount, 0);
  check('but re-ordering means it is not a no-op', plan.noop === false);
  eq('positions are rewritten to template order',
    plan.items.map(i => i.position), [1000, 2000, 3000, 4000, 5000, 6000, 7000]);
}

// ── Determinism with duplicate names in the data ───────────────────────────────────────
{
  const dupes = [st({ id: 'first', name: 'DONE' }), st({ id: 'second', name: 'done' })];
  const a = planStatusTemplate(dupes, T);
  const b = planStatusTemplate(dupes, T);
  eq('the earlier duplicate is the one reused',
    a.items.find(i => i.name === 'DONE')?.statusId, 'first');
  eq('the later duplicate is kept, not deleted',
    a.items.find(i => i.statusId === 'second')?.action, 'keep');
  eq('and the plan is deterministic', JSON.stringify(a), JSON.stringify(b));
}

// ── The planner never mutates its inputs ───────────────────────────────────────────────
{
  const existing = [st({ id: 'a', name: 'TO DO', position: 9999 })];
  const before = JSON.stringify(existing);
  planStatusTemplate(existing, T);
  eq('input rows are untouched by planning', JSON.stringify(existing), before);
}

console.log(`\nStatus template planner: ${passed} assertion(s) passed, ${failures.length} failed.`);
if (failures.length) {
  for (const f of failures) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
