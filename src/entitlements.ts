/**
 * Trial and perpetual-licence entitlement model.
 *
 *     14-day free trial  ->  one-time purchase (settled externally)  ->  permanent licence
 *
 * There is no recurring billing in this model: no subscriptions, renewals, proration or
 * dunning. A super admin converts an organisation to a perpetual licence after payment is
 * confirmed out of band.
 *
 * Everything here is a pure function of stored facts plus a clock. Nothing is read from a
 * stored status column, because the time-dependent states (EXPIRING_SOON, EXPIRED) would go
 * stale the instant now() crossed trial_ends_at and would need a cron to stay truthful.
 * Deriving on read is always correct and needs no scheduler.
 *
 * This module is intentionally dependency-free so it can be unit tested against a fixed
 * clock. Callers pass `now` explicitly rather than it reaching for Date.now() internally.
 */

export const TRIAL_DURATION_DAYS = 14;

/** Days remaining at which the trial starts reporting EXPIRING_SOON. */
export const EXPIRING_SOON_THRESHOLD_DAYS = 3;

/** Remaining-day marks that raise a notice. Ordered high to low. */
export const TRIAL_NOTICE_DAYS = [7, 3, 1] as const;

export type TrialStatus =
  | 'NOT_STARTED'
  | 'ACTIVE'
  | 'EXPIRING_SOON'
  | 'EXPIRED'
  | 'CONVERTED'
  | 'ADMIN_EXTENDED';

export type LicenseStatus = 'NONE' | 'LICENSED' | 'REVOKED';

export type AccessStatus =
  /** Inside a live trial. Full access. */
  | 'TRIAL'
  /** Perpetual licence. Full access, never expires. */
  | 'LICENSED'
  /** Trial elapsed without purchase. Locked out pending activation. */
  | 'EXPIRED'
  /** Never started a trial and holds no licence. */
  | 'NOT_STARTED'
  /** Administratively suspended, or licence revoked. Overrides everything else. */
  | 'SUSPENDED';

/** The stored entitlement facts for one workspace. Mirrors the columns added in 0004. */
export interface EntitlementFacts {
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  trialUsed: boolean;
  trialExtensionCount: number;
  licenseStatus: LicenseStatus;
  licensedAt: string | null;
  suspended: boolean;
}

export interface Entitlement {
  accessStatus: AccessStatus;
  trialStatus: TrialStatus;
  licenseStatus: LicenseStatus;
  /** True when the workspace may use the product right now. The single gate answer. */
  hasAccess: boolean;
  /** Whole days until the trial ends. Negative once elapsed. Null when no trial window. */
  trialDaysRemaining: number | null;
  trialEndsAt: string | null;
  /** Human-readable reason access is denied. Null when hasAccess is true. */
  denialReason: string | null;
}

const MS_PER_DAY = 86_400_000;

/**
 * Whole days from `now` until `endsAt`, rounded up: any part of a day still counts as a day
 * of access. At 0.5 days remaining a user has access "today", so this returns 1, not 0.
 * Zero or below therefore means genuinely elapsed.
 */
export function daysRemaining(endsAt: string, now: number): number {
  return Math.ceil((new Date(endsAt).getTime() - now) / MS_PER_DAY);
}

export function deriveTrialStatus(facts: EntitlementFacts, now: number): TrialStatus {
  // A purchased licence ends the trial's story regardless of dates. Checked first so a
  // converted org never reports EXPIRED just because its old trial window elapsed.
  if (facts.licenseStatus === 'LICENSED') return 'CONVERTED';

  if (!facts.trialStartedAt || !facts.trialEndsAt) return 'NOT_STARTED';

  const remaining = daysRemaining(facts.trialEndsAt, now);
  if (remaining <= 0) return 'EXPIRED';

  // Extension is reported in preference to ACTIVE so the console shows an operator
  // intervened. It does not change access — an extended trial is still a live trial.
  if (facts.trialExtensionCount > 0) return 'ADMIN_EXTENDED';

  if (remaining <= EXPIRING_SOON_THRESHOLD_DAYS) return 'EXPIRING_SOON';
  return 'ACTIVE';
}

/**
 * The authoritative access decision. Server-side only — never trust a client for this.
 */
export function deriveEntitlement(facts: EntitlementFacts, now: number = Date.now()): Entitlement {
  const trialStatus = deriveTrialStatus(facts, now);
  const trialDaysRemaining = facts.trialEndsAt ? daysRemaining(facts.trialEndsAt, now) : null;

  const base = {
    trialStatus,
    licenseStatus: facts.licenseStatus,
    trialDaysRemaining,
    trialEndsAt: facts.trialEndsAt
  };

  // Suspension is an operator override and outranks any licence or live trial.
  if (facts.suspended) {
    return {
      ...base,
      accessStatus: 'SUSPENDED',
      hasAccess: false,
      denialReason: 'This workspace has been suspended. Contact your administrator.'
    };
  }

  // A revoked licence is a deliberate withdrawal of access. It must not fall through to the
  // trial branch below, or revoking a licence from an org with an unexpired trial window
  // would silently hand access back.
  if (facts.licenseStatus === 'REVOKED') {
    return {
      ...base,
      accessStatus: 'SUSPENDED',
      hasAccess: false,
      denialReason: 'This workspace\'s licence has been revoked. Contact your administrator.'
    };
  }

  if (facts.licenseStatus === 'LICENSED') {
    return { ...base, accessStatus: 'LICENSED', hasAccess: true, denialReason: null };
  }

  if (trialStatus === 'NOT_STARTED') {
    return {
      ...base,
      accessStatus: 'NOT_STARTED',
      hasAccess: false,
      denialReason: 'No active trial or licence for this workspace.'
    };
  }

  if (trialStatus === 'EXPIRED') {
    return {
      ...base,
      accessStatus: 'EXPIRED',
      hasAccess: false,
      denialReason: `Your ${TRIAL_DURATION_DAYS}-day trial has ended. Contact your administrator to activate full access.`
    };
  }

  // ACTIVE, EXPIRING_SOON, ADMIN_EXTENDED all still permit access.
  return { ...base, accessStatus: 'TRIAL', hasAccess: true, denialReason: null };
}

/** The trial window for an organisation starting its trial at `now`. */
export function newTrialWindow(now: number = Date.now()): { trialStartedAt: string; trialEndsAt: string } {
  return {
    trialStartedAt: new Date(now).toISOString(),
    trialEndsAt: new Date(now + TRIAL_DURATION_DAYS * MS_PER_DAY).toISOString()
  };
}

/**
 * The notice to surface, or null. Returns the lowest threshold the remaining days have
 * reached, so a 2-day-remaining trial raises the 3-day notice rather than the 7-day one.
 */
export function trialNoticeThreshold(ent: Entitlement): number | null {
  if (ent.accessStatus !== 'TRIAL' || ent.trialDaysRemaining === null) return null;
  const hit = TRIAL_NOTICE_DAYS.filter(d => ent.trialDaysRemaining! <= d);
  return hit.length ? Math.min(...hit) : null;
}
