/**
 * Input validation for the Task Management module.
 *
 * Every value that reaches the database passes through here first. Bounds mirror the CHECK
 * constraints in migrations 0006/0007 so a bad request fails as a clean 422 rather than as a
 * database constraint violation surfaced as a 500.
 */

import { invalid } from './http.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './config.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const;
export const STATUS_CATEGORIES = ['todo', 'in_progress', 'done'] as const;

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw invalid(`${field} must be a valid identifier.`);
  }
  return value;
}

export function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireUuid(value, field);
}

export function requireString(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') throw invalid(`${field} is required.`);
  const trimmed = value.trim();
  if (trimmed.length < min) throw invalid(`${field} must be at least ${min} character(s).`);
  if (trimmed.length > max) throw invalid(`${field} must be at most ${max} characters.`);
  return trimmed;
}

export function optionalString(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw invalid(`${field} must be text.`);
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > max) throw invalid(`${field} must be at most ${max} characters.`);
  return trimmed;
}

export function requireEnum<T extends readonly string[]>(
  value: unknown, field: string, allowed: T
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value as any)) {
    throw invalid(`${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T[number];
}

export function optionalEnum<T extends readonly string[]>(
  value: unknown, field: string, allowed: T
): T[number] | null {
  if (value === undefined || value === null || value === '') return null;
  return requireEnum(value, field, allowed);
}

/** Accepts an ISO-8601 date/datetime. Returns a normalised UTC ISO string. */
export function optionalTimestamp(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw invalid(`${field} must be an ISO-8601 timestamp.`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw invalid(`${field} must be a valid ISO-8601 timestamp.`);
  return new Date(ms).toISOString();
}

export function optionalNonNegativeInt(value: unknown, field: string, max: number): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) {
    throw invalid(`${field} must be a whole number between 0 and ${max}.`);
  }
  return n;
}

/**
 * Optimistic concurrency token. PATCH routes require it so two editors cannot silently
 * overwrite each other; a mismatch becomes 409 rather than a lost update.
 */
export function requireVersion(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw invalid('A valid `version` is required for updates. Reload the record and retry.');
  }
  return n;
}

/** Bounded pagination — a caller cannot request an unbounded page. */
export function parsePagination(query: any): { page: number; pageSize: number; offset: number } {
  const rawPage = Number(query?.page ?? 1);
  const rawSize = Number(query?.pageSize ?? DEFAULT_PAGE_SIZE);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize = Number.isInteger(rawSize) && rawSize > 0
    ? Math.min(rawSize, MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

const SORTABLE = ['position', 'due_date', 'updated_at', 'created_at', 'priority', 'title'] as const;

export function parseSort(query: any): { column: string; ascending: boolean } {
  const raw = String(query?.sort ?? 'position');
  const desc = raw.startsWith('-');
  const column = desc ? raw.slice(1) : raw;
  if (!SORTABLE.includes(column as any)) {
    throw invalid(`sort must be one of: ${SORTABLE.join(', ')} (optionally prefixed with '-').`);
  }
  return { column, ascending: !desc };
}

/**
 * Rejects a browser-supplied workspace id outright rather than ignoring it silently.
 * The workspace always comes from req.workspace.id; a caller sending one is either confused
 * or probing, and both deserve a clear 422 rather than surprising behaviour.
 */
export function rejectClientWorkspaceId(body: any, query: any): void {
  const present = (o: any) =>
    o && typeof o === 'object' &&
    ('workspace_id' in o || 'workspaceId' in o);
  if (present(body) || present(query)) {
    throw invalid('workspace_id is derived from your session and must not be supplied.');
  }
}
