import React from 'react';
import { Clock, X } from 'lucide-react';
import { trialNoticeThreshold, type Entitlement } from '../entitlements';

interface TrialNoticeBannerProps {
  entitlement: Entitlement | null;
  onDismiss?: () => void;
}

/**
 * Countdown notice for an organisation on trial. Renders only at the 7 / 3 / 1 day marks,
 * escalating in tone as the deadline nears.
 *
 * Presentational only. The authoritative access decision is made server-side in
 * requireAuth(); this banner reports it and must never be the thing that gates anything.
 */
export default function TrialNoticeBanner({ entitlement, onDismiss }: TrialNoticeBannerProps) {
  if (!entitlement) return null;

  const threshold = trialNoticeThreshold(entitlement);
  if (threshold === null) return null;

  const days = entitlement.trialDaysRemaining ?? 0;

  // Escalates as the deadline approaches: informational at 7, warning at 3, urgent at 1.
  const tone = threshold === 1
    ? { bg: 'bg-rose-50', border: 'border-rose-200', icon: 'text-rose-600', head: 'text-rose-900', body: 'text-rose-700', btn: 'text-rose-800 hover:text-rose-900 hover:bg-rose-100' }
    : threshold === 3
      ? { bg: 'bg-amber-50', border: 'border-amber-200', icon: 'text-amber-600', head: 'text-amber-900', body: 'text-amber-700', btn: 'text-amber-800 hover:text-amber-900 hover:bg-amber-100' }
      : { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'text-blue-600', head: 'text-blue-900', body: 'text-blue-700', btn: 'text-blue-800 hover:text-blue-900 hover:bg-blue-100' };

  const label = days === 1 ? 'Your trial ends tomorrow' : `Your trial ends in ${days} days`;

  return (
    <div className={`flex items-center gap-3 ${tone.bg} border ${tone.border} rounded-xl px-4 py-2.5 no-print`}>
      <Clock className={`w-4 h-4 ${tone.icon} shrink-0`} />
      <div className="flex-1 min-w-0">
        <span className={`text-xs font-bold ${tone.head}`}>{label}</span>
        <span className={`text-[11px] ${tone.body} font-semibold ml-1.5 hidden sm:inline`}>
          — full access is a one-time purchase, not a subscription. Contact your administrator to activate.
        </span>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss trial notice"
          className={`shrink-0 p-1 rounded-lg ${tone.btn} transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-slate-300 focus-visible:outline-none`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
