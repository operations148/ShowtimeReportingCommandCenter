# Future Subscriptions — Deferred Work

**Status: recurring billing is out of scope and disabled. Do not enable it in this phase.**

The active commercial model is:

```
14-day free trial  ->  one-time full purchase  ->  permanent licensed access
```

Payment is settled **outside the platform**. An authorised super admin converts an
organisation from trial to a perpetual licence after confirming the purchase. There are no
renewals, so there is nothing to bill on a cycle.

This document records the recurring-subscription code that already exists in the repository,
why it is inert, and what would be required to activate it later. It is kept deliberately —
per scope, this scaffolding is **isolated, not deleted**.

---

## What the access model actually reads

As of migration `0004_workspace_entitlements.sql`, access is decided **solely** from columns
on `workspaces`, derived at request time by `src/entitlements.ts`:

| Column | Meaning |
| --- | --- |
| `trial_started_at`, `trial_ends_at` | The trial window |
| `trial_used` | Enforces one normal trial per organisation |
| `trial_extension_count`, `trial_extended_at`, `trial_extended_by` | Super-admin extensions |
| `license_status` | `NONE` / `LICENSED` / `REVOKED` |
| `licensed_at`, `licensed_by_user_id`, `license_reference` | Perpetual licence provenance |
| `suspended`, `suspended_at`, `suspension_reason` | Operator override |

`src/entitlements.ts` is the only authority on whether a workspace has access. Nothing in the
list below participates in that decision.

---

## The dormant recurring-billing scaffolding

### 1. `subscriptions` table

Shaped around recurring plans and still written to at onboarding:

```
workspace_id       text      not null
plan               text      not null  default 'STARTER'
status             text      not null  default 'TRIALING'
amount             integer   not null  default 0
next_billing_date  timestamptz
```

**Current behaviour.** `POST /api/auth/onboarding` inserts a row here with
`status: 'TRIALING'` and `next_billing_date` set 14 days out. `GET /api/workspaces/settings`
and `GET /api/admin/workspaces` read it for **display only**.

**Why it must not gate access.** It was never an enforcement mechanism — no code path has ever
read it to allow or deny anything. Before `0004`, an expired trial conferred unrestricted
access indefinitely because the only check in `requireAuth()` was `workspace.suspended`. The
live tenant `ws_showtime` demonstrates the drift plainly: it carries
`plan: UNLIMITED, status: ACTIVE, amount: 297` with a `next_billing_date` of `2026-06-15`
that has been in the past for a month, with no effect on anything.

**Do not** reintroduce this table into an access decision. If a future phase enables
subscriptions, reconcile it against `workspaces.license_status` first — the two will disagree.

### 2. `src/components/BillingView.tsx`

A billing/plan UI reflecting the recurring model (tiers, amounts, billing dates). It renders
from the `subscriptions` row above. It is presentational and grants nothing.

### 3. Stripe environment placeholders

Present in `.env.example` only, and **not configured** on any deployment:

```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
```

There is no Stripe SDK dependency, no checkout flow, and no webhook handler. These names are
aspirational, not wiring.

> Note: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is a Next.js convention and this is a Vite app,
> so the prefix would do nothing here. If Stripe is ever added, a publishable key is safe to
> expose but must use Vite's `VITE_` prefix to reach the client. Secret keys must remain
> server-side and must never be given a client-exposed prefix.

### 4. Onboarding tier selector

`SaaSAuthLayer.tsx` presents Starter / Growth / Elite tiers with monthly prices during
onboarding. It is labelled "Mock checkout" in the UI and takes no payment. Under the current
model the selection is cosmetic — it does not affect entitlement.

---

## Explicitly out of scope

Per the current brief, none of the following may be implemented in this phase:

- Monthly or annual subscriptions
- Recurring Stripe billing
- Recurring invoices
- Subscription renewals
- Proration
- Monthly plan upgrades or downgrades
- Failed recurring-payment (dunning) workflows
- Subscription cancellation flows

---

## If recurring billing is revived later

Rough order of work. This is a sketch for scoping, not a design:

1. **Decide precedence.** `license_status` and a subscription status will conflict. One must
   win. A perpetual licence already sold cannot be invalidated by a lapsed subscription —
   grandfathering is a legal question before it is an engineering one.
2. **Reconcile the backfill.** Every workspace predating `0004` was granted a perpetual
   licence with `license_reference = 'BACKFILL_0004_PRE_ENTITLEMENT'` and
   `licensed_by_user_id = null`. Those orgs never purchased under a subscription model, and
   that null is how you identify them.
3. **Extend `deriveEntitlement()`** in `src/entitlements.ts` with a subscription branch. Keep
   it a pure function of stored facts and a clock — the current design has no scheduler and
   should not acquire one.
4. **Add the Stripe surface**: SDK, checkout session, customer portal, and a signed webhook
   handler. The webhook must be tenant-scoped; a webhook that trusts a `workspace_id` in its
   payload without verifying the signature is a cross-tenant escalation.
5. **Dunning and cancellation**, which are the genuinely hard parts — grace periods, partial
   access, and what happens to data on cancellation.

Until all of that is specified, the trial and perpetual-licence model in
`src/entitlements.ts` is the **only** access authority.
