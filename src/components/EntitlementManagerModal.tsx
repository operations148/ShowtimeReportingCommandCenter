import React, { useState } from 'react';
import {
  X, ShieldCheck, Clock, Ban, RotateCcw, Lock, Unlock, AlertTriangle, CheckCircle2, KeyRound
} from 'lucide-react';

/**
 * Super-admin entitlement console for one workspace.
 *
 * Every mutation here is server-authorised and audit-logged; this component only presents
 * the actions the workspace's current state permits and calls the corresponding endpoint.
 * The available actions are deliberately state-dependent so an operator cannot, e.g., extend
 * the trial of a licensed org or revoke a licence that was never granted — the server also
 * refuses those, but hiding them is clearer than surfacing a 409.
 */

interface WorkspaceRow {
  id: string;
  name: string;
  suspended: boolean;
  entitlement: {
    accessStatus: string;
    trialStatus: string;
    licenseStatus: string;
    hasAccess: boolean;
    trialDaysRemaining: number | null;
    trialEndsAt: string | null;
  };
  licenseReference?: string | null;
  suspensionReason?: string | null;
}

interface Props {
  workspace: WorkspaceRow;
  sessionToken: string;
  onClose: () => void;
  onChanged: () => void;
}

type Busy = null | 'activate' | 'extend' | 'revoke' | 'restore' | 'suspend' | 'unsuspend';

export default function EntitlementManagerModal({ workspace, sessionToken, onClose, onChanged }: Props) {
  const ent = workspace.entitlement;
  const isLicensed = ent.licenseStatus === 'LICENSED';
  const isRevoked = ent.licenseStatus === 'REVOKED';
  const hasTrial = ent.trialEndsAt !== null;

  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  // Action inputs
  const [licenseRef, setLicenseRef] = useState('');
  const [extendDays, setExtendDays] = useState('14');
  const [extendReason, setExtendReason] = useState('');
  const [revokeReason, setRevokeReason] = useState('');
  const [suspendReason, setSuspendReason] = useState('');

  async function call(action: Busy, path: string, body: Record<string, unknown>) {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': sessionToken },
        body: JSON.stringify({ workspaceId: workspace.id, ...body })
      });
      const payload = await res.json();
      if (!res.ok || payload.status !== 'success') {
        throw new Error(payload.error || `Request failed (HTTP ${res.status})`);
      }
      onChanged(); // parent refreshes and closes
    } catch (e: any) {
      setError(e.message);
      setBusy(null);
    }
  }

  const accessTone =
    ent.accessStatus === 'LICENSED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : ent.accessStatus === 'TRIAL' ? 'bg-blue-50 text-blue-700 border-blue-200'
    : ent.accessStatus === 'SUSPENDED' ? 'bg-rose-50 text-rose-700 border-rose-200'
    : 'bg-amber-50 text-amber-700 border-amber-200';

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#0b1424] text-white p-5 rounded-t-2xl flex items-start justify-between sticky top-0">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-blue-400 shrink-0" />
            <div>
              <h2 className="text-sm font-black uppercase tracking-tight">Entitlement Controls</h2>
              <p className="text-[11px] text-slate-400 font-semibold">{workspace.name}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white transition-colors cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Current state */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full border ${accessTone}`}>
              {ent.accessStatus}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-600">
              Trial: {ent.trialStatus}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-600">
              Licence: {ent.licenseStatus}
            </span>
            {ent.trialDaysRemaining !== null && hasTrial && !isLicensed && (
              <span className="text-[10px] font-bold text-slate-500">
                {ent.trialDaysRemaining > 0 ? `${ent.trialDaysRemaining} day(s) left` : 'trial elapsed'}
              </span>
            )}
          </div>

          {workspace.licenseReference && (
            <p className="text-[11px] text-slate-500 font-mono bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              ref: {workspace.licenseReference}
            </p>
          )}

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-start gap-2 font-semibold">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* ---- Activate perpetual licence (when not already licensed) ---- */}
          {!isLicensed && (
            <section className="space-y-2 border border-emerald-200 bg-emerald-50/40 rounded-xl p-4">
              <h3 className="text-xs font-black text-emerald-900 uppercase tracking-wider flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5" /> Activate perpetual licence
              </h3>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Confirm the external purchase, then grant permanent access. One-time — nothing to renew.
              </p>
              <input
                type="text"
                value={licenseRef}
                onChange={(e) => setLicenseRef(e.target.value)}
                placeholder="Purchase / invoice reference (optional)"
                className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 font-semibold"
              />
              <button
                onClick={() => call('activate', '/api/admin/entitlement/activate-license', { reference: licenseRef })}
                disabled={busy !== null}
                className="w-full flex items-center justify-center gap-1.5 p-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                {busy === 'activate' ? 'Activating…' : 'Activate Permanent Access'}
              </button>
            </section>
          )}

          {/* ---- Extend trial (only meaningful for a trialling org) ---- */}
          {!isLicensed && !isRevoked && hasTrial && (
            <section className="space-y-2 border border-blue-200 bg-blue-50/40 rounded-xl p-4">
              <h3 className="text-xs font-black text-blue-900 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> Extend trial
              </h3>
              <div className="flex gap-2">
                <input
                  type="number" min={1} max={365} value={extendDays}
                  onChange={(e) => setExtendDays(e.target.value)}
                  className="w-20 text-xs p-2.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-semibold"
                />
                <input
                  type="text" value={extendReason}
                  onChange={(e) => setExtendReason(e.target.value)}
                  placeholder="Reason (optional)"
                  className="flex-1 text-xs p-2.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-semibold"
                />
              </div>
              <button
                onClick={() => call('extend', '/api/admin/entitlement/extend-trial', { days: Number(extendDays), reason: extendReason })}
                disabled={busy !== null}
                className="w-full flex items-center justify-center gap-1.5 p-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
              >
                <Clock className="w-3.5 h-3.5" />
                {busy === 'extend' ? 'Extending…' : `Extend by ${extendDays || '0'} day(s)`}
              </button>
            </section>
          )}

          {/* ---- Revoke licence (only when licensed) ---- */}
          {isLicensed && (
            <section className="space-y-2 border border-rose-200 bg-rose-50/40 rounded-xl p-4">
              <h3 className="text-xs font-black text-rose-900 uppercase tracking-wider flex items-center gap-1.5">
                <Ban className="w-3.5 h-3.5" /> Revoke licence
              </h3>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Withdraws permanent access. A reason is required and recorded.
              </p>
              <input
                type="text" value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="Reason (required)"
                className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 font-semibold"
              />
              <button
                onClick={() => call('revoke', '/api/admin/entitlement/revoke-license', { reason: revokeReason })}
                disabled={busy !== null || !revokeReason.trim()}
                className="w-full flex items-center justify-center gap-1.5 p-2.5 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
              >
                <Ban className="w-3.5 h-3.5" />
                {busy === 'revoke' ? 'Revoking…' : 'Revoke Licence'}
              </button>
            </section>
          )}

          {/* ---- Restore a revoked licence ---- */}
          {isRevoked && (
            <section className="space-y-2 border border-emerald-200 bg-emerald-50/40 rounded-xl p-4">
              <h3 className="text-xs font-black text-emerald-900 uppercase tracking-wider flex items-center gap-1.5">
                <RotateCcw className="w-3.5 h-3.5" /> Restore licence
              </h3>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Reinstates the previously granted licence, keeping its original provenance.
              </p>
              <button
                onClick={() => call('restore', '/api/admin/entitlement/restore-license', {})}
                disabled={busy !== null}
                className="w-full flex items-center justify-center gap-1.5 p-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {busy === 'restore' ? 'Restoring…' : 'Restore Licence'}
              </button>
            </section>
          )}

          {/* ---- Suspend / restore (operator override, independent of licence) ---- */}
          <section className="space-y-2 border border-slate-200 bg-slate-50/60 rounded-xl p-4">
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              {workspace.suspended ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
              {workspace.suspended ? 'Restore access' : 'Suspend workspace'}
            </h3>
            {workspace.suspended ? (
              <>
                {workspace.suspensionReason && (
                  <p className="text-[11px] text-slate-500">Suspended: {workspace.suspensionReason}</p>
                )}
                <button
                  onClick={() => call('unsuspend', '/api/admin/suspend', { suspend: false })}
                  disabled={busy !== null}
                  className="w-full flex items-center justify-center gap-1.5 p-2.5 bg-slate-700 hover:bg-slate-800 active:bg-slate-900 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  {busy === 'unsuspend' ? 'Restoring…' : 'Restore Access'}
                </button>
              </>
            ) : (
              <>
                <input
                  type="text" value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  placeholder="Reason (optional)"
                  className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-400 font-semibold"
                />
                <button
                  onClick={() => call('suspend', '/api/admin/suspend', { suspend: true, reason: suspendReason })}
                  disabled={busy !== null}
                  className="w-full flex items-center justify-center gap-1.5 p-2.5 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 border border-slate-300 text-slate-800 rounded-lg text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Lock className="w-3.5 h-3.5" />
                  {busy === 'suspend' ? 'Suspending…' : 'Suspend Workspace'}
                </button>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
