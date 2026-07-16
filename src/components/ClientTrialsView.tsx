import React, { useState, useEffect, useCallback } from 'react';
import {
  Users, RefreshCw, AlertTriangle, CheckCircle2, Clock, Mail, Settings, Filter,
  UserPlus, ShieldCheck
} from 'lucide-react';
import { UserRole } from '../types';
import EntitlementManagerModal from './EntitlementManagerModal';

/**
 * Client Trials console — a super-admin surface listing every client workspace, who created
 * it, and its live access state, with per-workspace management via EntitlementManagerModal.
 *
 * It reuses /api/admin/workspaces (which now carries the resolved creator and derived
 * entitlement), so there is one source of truth shared with the platform Admin view.
 */

interface ClientTrialsViewProps {
  activeRole: UserRole;
  sessionToken: string;
}

interface Creator { userId: string; name: string; email: string; joinedAt: string }
interface WorkspaceRow {
  id: string; name: string; slug: string; suspended: boolean;
  membersCount: number;
  createdAt: string;
  creator: Creator | null;
  licenseReference?: string | null;
  suspensionReason?: string | null;
  entitlement: {
    accessStatus: string; trialStatus: string; licenseStatus: string;
    hasAccess: boolean; trialDaysRemaining: number | null; trialEndsAt: string | null;
  };
}

type TabFilter = 'all' | 'trials' | 'licensed' | 'expired' | 'suspended';

export default function ClientTrialsView({ activeRole, sessionToken }: ClientTrialsViewProps) {
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [filter, setFilter] = useState<TabFilter>('all');
  const [managing, setManaging] = useState<WorkspaceRow | null>(null);

  const load = useCallback(async () => {
    if (activeRole !== UserRole.SUPER_ADMIN) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/admin/workspaces', { headers: { 'x-auth-token': sessionToken }, cache: 'no-store' });
      if (!res.ok) throw new Error(`Loader returned ${res.status}`);
      const p = await res.json();
      if (p.status === 'success') setWorkspaces(p.workspaces || []);
      else throw new Error(p.error || 'Failed to load workspaces.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [activeRole, sessionToken]);

  useEffect(() => { load(); }, [load]);

  const onChanged = () => {
    setManaging(null);
    setSuccess('Access updated.');
    load();
    setTimeout(() => setSuccess(null), 4000);
  };

  // Non-super-admin guard — same posture as the Admin console.
  if (activeRole !== UserRole.SUPER_ADMIN) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center max-w-xl mx-auto space-y-4 shadow-sm">
        <div className="w-16 h-16 bg-rose-50 border border-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto">
          <ShieldCheck className="w-7 h-7" />
        </div>
        <h3 className="text-lg font-black text-slate-900 tracking-tight">Client Trials — Restricted</h3>
        <p className="text-slate-500 text-xs leading-relaxed max-w-sm mx-auto">
          You are authenticated as <b>{activeRole}</b>. Only <b>SUPER_ADMIN</b> operators can review client
          trials and manage workspace access.
        </p>
      </div>
    );
  }

  const counts = {
    all: workspaces.length,
    trials: workspaces.filter(w => w.entitlement.accessStatus === 'TRIAL').length,
    licensed: workspaces.filter(w => w.entitlement.accessStatus === 'LICENSED').length,
    expired: workspaces.filter(w => w.entitlement.accessStatus === 'EXPIRED' || w.entitlement.accessStatus === 'NOT_STARTED').length,
    suspended: workspaces.filter(w => w.entitlement.accessStatus === 'SUSPENDED').length
  };

  const filtered = workspaces.filter(w => {
    switch (filter) {
      case 'trials': return w.entitlement.accessStatus === 'TRIAL';
      case 'licensed': return w.entitlement.accessStatus === 'LICENSED';
      case 'expired': return w.entitlement.accessStatus === 'EXPIRED' || w.entitlement.accessStatus === 'NOT_STARTED';
      case 'suspended': return w.entitlement.accessStatus === 'SUSPENDED';
      default: return true;
    }
  });

  const pill = (status: string) => {
    switch (status) {
      case 'LICENSED': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'TRIAL': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'EXPIRED': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'SUSPENDED': return 'bg-rose-50 text-rose-700 border-rose-200';
      default: return 'bg-slate-100 text-slate-500 border-slate-200';
    }
  };

  const tabs: { key: TabFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'trials', label: 'On Trial' },
    { key: 'licensed', label: 'Licensed' },
    { key: 'expired', label: 'Expired' },
    { key: 'suspended', label: 'Suspended' }
  ];

  return (
    <div className="space-y-6" id="client-trials-view">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] bg-blue-50 border border-blue-200 text-blue-700 px-2.5 py-0.5 rounded-full font-black uppercase tracking-wider block w-fit mb-1.5">
            Platform Operator
          </span>
          <h2 className="text-xl font-bold tracking-tight text-[#0F172A] mb-1">Client Trials & Access</h2>
          <p className="text-slate-500 text-xs font-semibold max-w-xl">
            Every client workspace, who created it, and its live access state. Convert a trial to a
            perpetual licence, extend, suspend, or restore — each action is recorded in the audit trail.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 p-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition shadow-sm cursor-pointer disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {success && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2 font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /><span>{success}</span>
        </div>
      )}
      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2 font-semibold">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" /><span>{error}</span>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-slate-400 mr-1" />
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer border ${
              filter === t.key
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {t.label}
            <span className={`ml-1.5 ${filter === t.key ? 'text-blue-100' : 'text-slate-400'}`}>{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center space-y-2">
          <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto" />
          <p className="text-xs text-slate-500">Loading client workspaces…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-bold text-slate-700">No workspaces in this view</p>
          <p className="text-xs text-slate-400 mt-1">Try a different filter.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-[#f8fafc] border-b border-slate-200 text-[10px] text-slate-400 uppercase font-black">
                <tr>
                  <th className="p-4 pl-5">Workspace</th>
                  <th className="p-4">Created by</th>
                  <th className="p-4">Created</th>
                  <th className="p-4">Access</th>
                  <th className="p-4">Trial</th>
                  <th className="p-4">Team</th>
                  <th className="p-4 pr-5 text-right">Manage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {filtered.map(ws => (
                  <tr key={ws.id} className="hover:bg-slate-50/50">
                    <td className="p-4 pl-5">
                      <span className="font-bold text-slate-900 block">{ws.name}</span>
                      <span className="text-[9px] text-slate-400 font-mono">slug: {ws.slug}</span>
                    </td>
                    <td className="p-4">
                      {ws.creator ? (
                        <div>
                          <span className="font-bold text-slate-800 flex items-center gap-1">
                            <UserPlus className="w-3 h-3 text-slate-400" /> {ws.creator.name}
                          </span>
                          {ws.creator.email && (
                            <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1 mt-0.5">
                              <Mail className="w-2.5 h-2.5" /> {ws.creator.email}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-400 italic">unknown</span>
                      )}
                    </td>
                    <td className="p-4 text-slate-500 text-[10px]">
                      {new Date(ws.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${pill(ws.entitlement.accessStatus)}`}>
                        {ws.entitlement.accessStatus}
                      </span>
                    </td>
                    <td className="p-4 text-[10px] text-slate-500 font-bold">
                      {ws.entitlement.accessStatus === 'TRIAL' && ws.entitlement.trialDaysRemaining !== null ? (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3 text-blue-500" />
                          {ws.entitlement.trialDaysRemaining}d left
                        </span>
                      ) : (
                        <span className="text-slate-300">{ws.entitlement.trialStatus}</span>
                      )}
                    </td>
                    <td className="p-4 text-slate-500 font-mono text-[10px] font-bold">{ws.membersCount}</td>
                    <td className="p-4 pr-5 text-right">
                      <button
                        onClick={() => setManaging(ws)}
                        className="p-1.5 px-3 rounded-lg text-[10px] font-black uppercase tracking-wider cursor-pointer transition flex items-center gap-1.5 ml-auto border bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                      >
                        <Settings className="w-3 h-3" /> Manage access
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {managing && (
        <EntitlementManagerModal
          workspace={managing as any}
          sessionToken={sessionToken}
          onClose={() => setManaging(null)}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}
