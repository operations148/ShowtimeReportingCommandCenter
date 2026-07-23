import React, { useState } from 'react';
import { Smartphone, Download, CheckCircle2, Share, PlusSquare, MonitorSmartphone } from 'lucide-react';
import { usePwaInstall } from '../hooks/usePwaInstall';

/**
 * Install-the-app card for Settings. Renders a state-appropriate surface:
 *  - installable  -> a working Install button (native prompt)
 *  - ios-manual   -> Share → Add to Home Screen instructions
 *  - installed    -> a confirmation, no action
 *  - in-iframe    -> a note that installation happens from the standalone URL
 *  - unsupported  -> hidden, so no dead button is shown
 */
export default function PwaInstallCard() {
  const { status, promptInstall } = usePwaInstall();
  const [result, setResult] = useState<string | null>(null);

  // Nothing useful to offer — don't render a card that can't do anything.
  if (status === 'unsupported') return null;

  const handleInstall = async () => {
    const outcome = await promptInstall();
    if (outcome === 'accepted') setResult('Installing — check your home screen or app list.');
    else if (outcome === 'dismissed') setResult('Installation dismissed. You can install any time from here.');
    else setResult('Install prompt is not available right now.');
  };

  return (
    <div className="bg-white border border-slate-200 shadow-sm rounded-xl p-5 space-y-3">
      <h3 className="font-bold text-[#0F172A] text-sm pb-2 border-b border-slate-100 flex items-center gap-1.5">
        <Smartphone className="w-4 h-4 text-blue-600" />
        Install DashPro
      </h3>

      {status === 'installed' && (
        <div className="flex items-start gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3 font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span>DashPro is installed and running as an app. You're all set.</span>
        </div>
      )}

      {status === 'installable' && (
        <>
          <p className="text-slate-500 text-xs leading-relaxed">
            Add DashPro to your device for a full-screen app, faster launches, and an offline snapshot of your latest report.
          </p>
          <button
            onClick={handleInstall}
            className="w-full flex items-center justify-center gap-1.5 p-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Install App
          </button>
          {result && <p className="text-[11px] text-slate-500 font-medium">{result}</p>}
        </>
      )}

      {status === 'ios-manual' && (
        <>
          <p className="text-slate-500 text-xs leading-relaxed">
            On iPhone and iPad, add DashPro to your home screen from Safari:
          </p>
          <ol className="space-y-2 text-xs text-slate-600">
            <li className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 font-black text-[10px] flex items-center justify-center shrink-0">1</span>
              Tap the <Share className="w-3.5 h-3.5 inline text-blue-600" /> <b>Share</b> button in Safari's toolbar.
            </li>
            <li className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 font-black text-[10px] flex items-center justify-center shrink-0">2</span>
              Choose <PlusSquare className="w-3.5 h-3.5 inline text-blue-600" /> <b>Add to Home Screen</b>.
            </li>
            <li className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 font-black text-[10px] flex items-center justify-center shrink-0">3</span>
              Tap <b>Add</b> — DashPro appears with your other apps.
            </li>
          </ol>
        </>
      )}

      {status === 'in-iframe' && (
        <div className="flex items-start gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
          <MonitorSmartphone className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <span>
            You're viewing DashPro embedded in another app. To install it, open the dashboard in its own
            browser tab first, then use Install from Settings there.
          </span>
        </div>
      )}
    </div>
  );
}
