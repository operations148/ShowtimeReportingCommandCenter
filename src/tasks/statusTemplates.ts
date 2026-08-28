/**
 * Reusable status templates.
 *
 * This module is deliberately dependency-free and shared by BOTH the server router and the
 * browser bundle, so the labels, categories, colours and order can never drift between the
 * dry-run the operator reads and the mutation the server performs. It contains no secrets and
 * no I/O — only constants and one pure planning function.
 *
 * Applying a template is ALWAYS an explicit, manager-initiated operation. Nothing here is
 * invoked during Space creation, bootstrap, or any migration: an existing Space keeps exactly
 * the statuses it has until somebody deliberately applies a template to it.
 */

export type StatusCategory = 'todo' | 'in_progress' | 'done';

export interface StatusTemplateEntry {
  name: string;
  category: StatusCategory;
  /** 6-digit hex, matching the CHECK constraint on task_statuses.color. */
  color: string;
}

export interface StatusTemplate {
  key: string;
  label: string;
  description: string;
  entries: StatusTemplateEntry[];
}

/**
 * The Showtime operational template.
 *
 * Category mapping notes — the three categories are the existing data model and are NOT
 * extended to match these seven labels (a wider enum would be a breaking schema change for
 * every consumer, and the categories exist to answer "is this work open?", not to name it):
 *   * WAITING, REVIEW and BLOCKED are all `in_progress` — the work is open and owned, it is
 *     simply not advancing. Filing them under `todo` would misreport them as unstarted, and
 *     under `done` would misreport them as finished.
 *   * TO SCHEDULE is `todo` — accepted but not yet started.
 * Only DONE is `done`, which is what drives the "collapsed by default" behaviour in the
 * grouped List view.
 */
export const OPERATIONS_STATUS_TEMPLATE: StatusTemplate = {
  key: 'operations',
  label: 'Operations Status Template',
  description:
    'The seven-stage Showtime operational workflow: To Do, In Progress, Waiting, Review, Done, Blocked, To Schedule.',
  entries: [
    { name: 'TO DO', category: 'todo', color: '#94A3B8' },
    { name: 'IN PROGRESS', category: 'in_progress', color: '#2563EB' },
    { name: 'WAITING', category: 'in_progress', color: '#D97706' },
    { name: 'REVIEW', category: 'in_progress', color: '#7C3AED' },
    { name: 'DONE', category: 'done', color: '#059669' },
    { name: 'BLOCKED', category: 'in_progress', color: '#DC2626' },
    { name: 'TO SCHEDULE', category: 'todo', color: '#0891B2' }
  ]
};

export const STATUS_TEMPLATES: StatusTemplate[] = [OPERATIONS_STATUS_TEMPLATE];

export function findStatusTemplate(key: unknown): StatusTemplate | null {
  return STATUS_TEMPLATES.find(t => t.key === key) ?? null;
}

/** Spacing between generated positions, matching the convention used elsewhere in the module. */
export const TEMPLATE_POSITION_STEP = 1000;

/** The shape this planner needs from an existing status row. */
export interface ExistingStatus {
  id: string;
  name: string;
  category: string;
  color: string | null;
  position: number;
  archived_at?: string | null;
}

export type PlanAction = 'reuse' | 'create' | 'keep';

export interface StatusTemplatePlanItem {
  action: PlanAction;
  /** The template label for reuse/create; the existing status's own name for keep. */
  name: string;
  category: string;
  color: string | null;
  /** Present for reuse/keep — the existing row this item refers to. Never null for those. */
  statusId?: string;
  /** The position this item will hold after apply. */
  position: number;
  /** Only meaningful for `keep`: how many tasks currently sit in this status. */
  taskCount?: number;
  /** Human-readable justification, shown verbatim in the dry-run. */
  note: string;
}

export interface StatusTemplatePlan {
  templateKey: string;
  templateLabel: string;
  items: StatusTemplatePlanItem[];
  createCount: number;
  reuseCount: number;
  keepCount: number;
  /** True when applying would change nothing at all. */
  noop: boolean;
}

/** Case- and whitespace-insensitive match, so "To Do" and "TO DO" are the SAME status. */
function normaliseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Computes exactly what applying `template` to `existing` would do — the dry-run.
 *
 * Guarantees, which the apply path relies on and the tests pin:
 *   * Nothing is ever deleted or archived. A status that is not part of the template is
 *     reported as `keep` and left untouched, whether or not it holds tasks. That makes
 *     "never delete a status containing tasks" true by construction rather than by a check
 *     that could be got wrong.
 *   * A template entry matching an existing status by name (case-insensitively) is `reuse`:
 *     the SAME status id survives, so every task already pointing at it keeps its status_id
 *     and no task is ever re-pointed, re-categorised or touched at all.
 *   * Only genuinely absent entries are `create`.
 *   * Archived statuses are matched too, and reuse un-archives rather than creating a
 *     duplicate — otherwise applying a template to a Space where someone had archived
 *     "REVIEW" would silently produce a second "REVIEW".
 *
 * `taskCountByStatus` is optional and only decorates `keep` items so the operator can see
 * what the extras hold before deciding. It never changes the plan.
 */
export function planStatusTemplate(
  existing: ExistingStatus[],
  template: StatusTemplate,
  taskCountByStatus: Map<string, number> = new Map()
): StatusTemplatePlan {
  const byName = new Map<string, ExistingStatus>();
  for (const s of existing) {
    // First writer wins, so a duplicate name in the data cannot make the plan
    // non-deterministic; the earlier row (by the caller's ordering) is the one reused.
    const k = normaliseName(s.name);
    if (!byName.has(k)) byName.set(k, s);
  }

  const items: StatusTemplatePlanItem[] = [];
  const claimed = new Set<string>();

  template.entries.forEach((entry, i) => {
    const match = byName.get(normaliseName(entry.name));
    const position = (i + 1) * TEMPLATE_POSITION_STEP;
    if (match) {
      claimed.add(match.id);
      items.push({
        action: 'reuse',
        name: entry.name,
        category: match.category,
        color: match.color,
        statusId: match.id,
        position,
        note: match.archived_at
          ? `Reuses the existing archived “${match.name}” status and restores it. Its id is preserved, so tasks already in it are untouched.`
          : `Reuses the existing “${match.name}” status. Its id is preserved, so tasks already in it are untouched.`
      });
    } else {
      items.push({
        action: 'create',
        name: entry.name,
        category: entry.category,
        color: entry.color,
        position,
        note: 'Not present in this Space — will be created.'
      });
    }
  });

  // Everything the template did not claim is kept, ordered after the template block so the
  // seven template statuses read in their required order at the top of the Space.
  let extraPosition = (template.entries.length + 1) * TEMPLATE_POSITION_STEP;
  for (const s of existing) {
    if (claimed.has(s.id)) continue;
    const count = taskCountByStatus.get(s.id) ?? 0;
    items.push({
      action: 'keep',
      name: s.name,
      category: s.category,
      color: s.color,
      statusId: s.id,
      position: extraPosition,
      taskCount: count,
      note: count > 0
        ? `Not part of the template. Left exactly as it is — it holds ${count} task${count === 1 ? '' : 's'} and is never deleted or archived by this operation.`
        : 'Not part of the template. Left exactly as it is — nothing is ever deleted by this operation.'
    });
    extraPosition += TEMPLATE_POSITION_STEP;
  }

  const createCount = items.filter(i => i.action === 'create').length;
  const reuseCount = items.filter(i => i.action === 'reuse').length;
  const keepCount = items.filter(i => i.action === 'keep').length;

  // A reuse that also has to move position, restore, or recategorise is still a change; only
  // a plan that creates nothing AND leaves every existing row exactly where it is is a no-op.
  const positionsAlreadyCorrect = items.every(i => {
    if (i.action === 'create') return false;
    const row = existing.find(s => s.id === i.statusId);
    return !!row && row.position === i.position && !row.archived_at;
  });

  return {
    templateKey: template.key,
    templateLabel: template.label,
    items,
    createCount,
    reuseCount,
    keepCount,
    noop: createCount === 0 && positionsAlreadyCorrect
  };
}
