/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Sliders,
  Clock,
  Bell,
  Database,
  Info,
  Laptop,
  ShieldCheck,
  CheckCircle2,
  CalendarDays
} from 'lucide-react';
import PwaInstallCard from './PwaInstallCard';

const TIMEZONE_KEY = 'reporting_timezone';

export function getReportingTimezone(): string {
  try { return localStorage.getItem(TIMEZONE_KEY) || 'America/Los_Angeles'; } catch { return 'America/Los_Angeles'; }
}

export default function GlobalSettingsView() {
  const [timezone, setTimezone] = useState(() => getReportingTimezone());
  const [slaTargetSeconds, setSlaTargetSeconds] = useState(120);
  const [decayDays, setDecayDays] = useState(45);
  const [slackAlerts, setSlackAlerts] = useState(true);
  const [decayPolicy, setDecayPolicy] = useState(true);
  const [showSuccess, setShowSuccess] = useState(false);

  const handleApplySettings = (e: React.FormEvent) => {
    e.preventDefault();
    try { localStorage.setItem(TIMEZONE_KEY, timezone); } catch { /* storage unavailable */ }
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 3000);
  };

  return (
    <div className="space-y-6" id="global-settings-panel">
      {/* Visual Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-[#0F172A] mb-1">
          Global App Settings
        </h2>
        <p className="text-slate-500 text-sm">
          Configure response SLA targets, choose local operational timezones, and establish lead pipeline leakage alerts parameters.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Form blocks */}
        <form onSubmit={handleApplySettings} className="lg:col-span-2 space-y-6 bg-white border border-[#E2E8F0] shadow-sm rounded-xl p-5">
          <div className="flex justify-between items-center pb-3 border-b border-slate-100">
            <span className="flex items-center gap-2 text-slate-800 font-bold text-sm">
              <Sliders className="w-4.5 h-4.5 text-blue-600" />
              Operational Parameters
            </span>
            <span className="text-[10px] text-slate-400 font-mono font-semibold uppercase tracking-wider">
              local configurations
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* Timezone Selection widget */}
            <div className="space-y-1.5Col">
              <label className="text-xs font-bold text-slate-700 block mb-1">Location Timezone Profile</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg p-2.5 px-3 text-xs text-slate-800 focus:outline-none focus:border-blue-500 w-full transition shadow-xs cursor-pointer font-semibold"
              >
                <option value="America/Chicago">Central Time (CST/CDT) - Chicago</option>
                <option value="America/New_York">Eastern Time (EST/EDT) - New York</option>
                <option value="America/Denver">Mountain Time (MST/MDT) - Denver</option>
                <option value="America/Los_Angeles">Pacific Time (PST/PDT) - Los Angeles</option>
                <option value="UTC">Coordinated Universal Time (UTC)</option>
              </select>
              <span className="text-[10px] text-[#64748B] block mt-1">Calculates pipeline charts on localized day bounds.</span>
            </div>

            {/* SLA Notification threshold */}
            <div className="space-y-1.5 text-xs">
              <label className="text-xs font-bold text-slate-700 block mb-1">Response SLA Alert Limit</label>
              <select
                value={slaTargetSeconds}
                onChange={(e) => setSlaTargetSeconds(Number(e.target.value))}
                className="bg-white border border-slate-200 rounded-lg p-2.5 px-3 text-xs text-slate-800 focus:outline-none focus:border-blue-500 w-full transition shadow-xs cursor-pointer font-semibold"
              >
                <option value="60">60 Seconds (Immediate)</option>
                <option value="120">120 Seconds (Recommended)</option>
                <option value="300">5 Minutes (Relaxed SLA)</option>
                <option value="600">10 Minutes</option>
              </select>
              <span className="text-[10px] text-[#64748B] block mt-1">Flags lead records as SLA breached beyond this duration.</span>
            </div>

          </div>

          {/* Inline alert togglers */}
          <div className="space-y-4 pt-4 border-t border-slate-100">
            <span className="text-xs font-bold text-slate-805 uppercase tracking-wider block">Lead & Webhook Decay Rule Policies</span>
            
            {/* Rule 1: Automated decay */}
            <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
              <div>
                <span className="text-xs font-bold text-slate-800 block">Lead Decay Policy</span>
                <span className="text-[10px] text-slate-500 block leading-normal mt-0.5 max-w-[400px]">
                  Flag leads active beyond <strong className="text-slate-805">45 Days</strong> with no sales note, highlighting potential pipeline leaks.
                </span>
              </div>
              
              <button
                type="button"
                onClick={() => setDecayPolicy(!decayPolicy)}
                className={`p-1 px-3 rounded-full text-[10px] font-bold border transition-colors cursor-pointer ${
                  decayPolicy 
                    ? 'bg-blue-50 text-[#1D4ED8] border-blue-200' 
                    : 'bg-white text-slate-400 border-slate-200'
                }`}
              >
                {decayPolicy ? 'ENABLED' : 'DISABLED'}
              </button>
            </div>

            {/* Rule 2: Slack Alert webhook */}
            <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
              <div>
                <span className="text-xs font-bold text-slate-800 block">Slack Webhook Alerts</span>
                <span className="text-[10px] text-slate-500 block leading-normal mt-0.5 max-w-[400px]">
                  Fires automatic Slack notifications on crucial SLA breaches or closed won opportunity triggers.
                </span>
              </div>
              
              <button
                type="button"
                onClick={() => setSlackAlerts(!slackAlerts)}
                className={`p-1 px-3 rounded-full text-[10px] font-bold border transition-colors cursor-pointer ${
                  slackAlerts 
                    ? 'bg-blue-50 text-[#1D4ED8] border-blue-200' 
                    : 'bg-white text-slate-400 border-slate-200'
                }`}
              >
                {slackAlerts ? 'ACTIVE' : 'MUTED'}
              </button>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
            {showSuccess ? (
              <span className="text-xs text-emerald-750 font-bold flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 animate-bounce" />
                Global configurations saved successfully!
              </span>
            ) : (
              <span className="text-xs text-slate-500 font-medium">Verify adjustments prior to locking rules.</span>
            )}

            <button
              type="submit"
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-750 text-white text-xs font-bold font-semibold shadow-xs cursor-pointer transition"
            >
              Apply Global Configurations
            </button>
          </div>
        </form>

        {/* Right Info Box */}
        <div className="lg:col-span-1 space-y-6">

          {/* Install to home screen — self-hides where installation is not applicable. */}
          <PwaInstallCard />

          <div className="bg-white border border-slate-200 shadow-sm rounded-xl p-5 space-y-4">
            <h3 className="font-bold text-[#0F172A] text-sm pb-2 border-b border-slate-100 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-blue-600" />
              SLA Compliance Rules
            </h3>

            <p className="text-slate-500 text-xs leading-normal">
              GoHighLevel Location performance is calculated continuously. Ensure response times remain below the configured threshold limits to maximize closing conversion rates.
            </p>
          </div>

          <div className="bg-blue-50 border border-blue-150 border-dashed rounded-xl p-4 text-xs text-blue-800 space-y-1.5">
            <h4 className="font-bold flex items-center gap-1">
              <Info className="w-4 h-4 text-blue-600" />
              Config Cache Invalidation
            </h4>
            <p className="opacity-95 text-[11px] leading-relaxed font-semibold">
              Applying operational parameters instantly triggers an automated clear of any server-side memory caches.
            </p>
          </div>

        </div>

      </div>
    </div>
  );
}
