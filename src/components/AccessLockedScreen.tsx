import React from 'react';
import { Lock, Clock, ShieldOff, LogOut, RefreshCw, Building2 } from 'lucide-react';
import type { Entitlement } from '../entitlements';

interface AccessLockedScreenProps {
  entitlement: Entitlement;
  workspaceName: string;
  onLogout: () => void;
  onRetry: () => void;
}

/**
 * Shown when the server reports a workspace has no access — an elapsed trial, a revoked
 * licence, or an organisation that never started a trial.
 *
 * This is deliberately a distinct state from "logged out". The user's credentials are
 * valid and their session is live; it is the workspace's entitlement that has lapsed.
 * Bouncing them to the login form would tell them their password was wrong, which is both
 * untrue and unactionable.
 */
export default function AccessLockedScreen({
  entitlement, workspaceName, onLogout, onRetry
}: AccessLockedScreenProps) {
  const isExpired = entitlement.accessStatus === 'EXPIRED';
  const isRevoked = entitlement.licenseStatus === 'REVOKED';

  const Icon = isExpired ? Clock : isRevoked ? ShieldOff : Lock;

  const heading = isExpired
    ? 'Your trial has ended'
    : isRevoked
      ? 'Access has been withdrawn'
      : 'No active trial or licence';

  const body = isExpired
    ? 'Your 14-day evaluation of the Reporting Command Center is complete. Your data and configuration are safe and will be exactly as you left them once full access is activated.'
    : isRevoked
      ? 'The licence for this workspace has been withdrawn. Your data has not been deleted.'
      : 'This workspace does not currently have an active trial or a licence.';

  return (
    <div className="min-h-screen bg-[#F1F5F9] text-slate-800 flex flex-col justify-between py-12 px-4 sm:px-6 font-sans">

      <div className="flex flex-col items-center justify-center shrink-0">
        <div className="flex items-center justify-center bg-[#0b1424] text-white p-3.5 rounded-2xl shadow-xl border border-slate-800">
          <Building2 className="w-7 h-7 text-blue-500" />
        </div>
        <h1 className="mt-4 text-xl font-black text-[#0b1424] uppercase tracking-tight">Showtime Command Suite</h1>
        <p className="text-xs text-slate-500 mt-1 font-semibold uppercase tracking-widest">Enterprise GHL V2 Reporting Portal</p>
      </div>

      <div className="my-8 sm:mx-auto sm:w-full sm:max-w-lg">
        <div className="bg-white border border-slate-200 py-8 px-6 sm:px-8 shadow-xl rounded-2xl space-y-6 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500" />

          <div className="flex flex-col items-center text-center space-y-3 pt-1">
            <div className="w-14 h-14 bg-amber-50 border border-amber-200 text-amber-600 rounded-full flex items-center justify-center">
              <Icon className="w-7 h-7" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">{heading}</h2>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{workspaceName}</p>
            </div>
          </div>

          <p className="text-xs text-slate-500 leading-relaxed text-center">{body}</p>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2.5">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">What happens next</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Full access is a <b className="text-slate-900">one-time purchase</b> — not a subscription. There is
              nothing to renew and no recurring charge. Once your purchase is confirmed, your administrator
              activates permanent access and everything here resumes immediately.
            </p>
            <p className="text-xs text-slate-600 leading-relaxed">
              Contact your account administrator to arrange activation.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <button
              onClick={onRetry}
              className="flex-1 flex items-center justify-center gap-1.5 p-2.5 bg-blue-600 hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none active:bg-blue-800 text-white rounded-xl text-xs font-bold transition-colors shadow-md cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Check again
            </button>
            <button
              onClick={onLogout}
              className="flex-1 flex items-center justify-center gap-1.5 p-2.5 bg-white hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:outline-none active:bg-slate-100 border border-slate-250 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </div>

          {entitlement.trialEndsAt && isExpired && (
            <p className="text-[10px] text-slate-400 text-center font-semibold">
              Trial ended {new Date(entitlement.trialEndsAt).toLocaleDateString('en-US', {
                month: 'long', day: 'numeric', year: 'numeric'
              })}
            </p>
          )}
        </div>
      </div>

      <span className="text-[10px] tracking-wide text-slate-400 text-center shrink-0 font-medium">
        Your data is retained in full. Nothing is deleted when a trial ends.
      </span>
    </div>
  );
}
