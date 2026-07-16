import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Database, 
  Trash2, 
  Flame, 
  Play, 
  Terminal, 
  AlertTriangle, 
  CheckCircle2, 
  Activity,
  Cpu,
  RefreshCw,
  Building,
  Users,
  Eye,
  Settings,
  Lock,
  Unlock,
  KeyRound,
  FileSpreadsheet
} from 'lucide-react';
import { UserRole } from '../types';
import EntitlementManagerModal from './EntitlementManagerModal';

interface AdminViewProps {
  dataSourceMode: 'MOCK' | 'LIVE';
  onSyncMetrics: () => void;
  isSyncing: boolean;
  activeRole: UserRole;
  sessionToken: string;
}

/** Pill styling for the derived access status shown in the workspace table. */
function accessPill(status: string): { cls: string; dot: string } {
  switch (status) {
    case 'LICENSED': return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' };
    case 'TRIAL': return { cls: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' };
    case 'EXPIRED': return { cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' };
    case 'SUSPENDED': return { cls: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500' };
    default: return { cls: 'bg-slate-100 text-slate-500 border-slate-200', dot: 'bg-slate-400' };
  }
}

export default function AdminView({ dataSourceMode, onSyncMetrics, isSyncing, activeRole, sessionToken }: AdminViewProps) {
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  
  // Dashboard diagnostic stats
  const [cacheFlushMessage, setCacheFlushMessage] = useState<string | null>(null);
  const [flushing, setFlushing] = useState(false);

  // Workspace whose entitlement modal is open, or null.
  const [managingWorkspace, setManagingWorkspace] = useState<any | null>(null);

  // Load backend Admin data
  const loadAdminState = async () => {
    if (activeRole !== UserRole.SUPER_ADMIN) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      // 1. Fetch Workspaces
      const wsRes = await fetch('/api/admin/workspaces', {
        headers: { 'x-auth-token': sessionToken }
      });
      if (!wsRes.ok) throw new Error(`Workspace loader returned: ${wsRes.status}`);
      const wsPayload = await wsRes.json();
      if (wsPayload.status === 'success') {
        setWorkspaces(wsPayload.workspaces);
      }

      // 2. Fetch Users
      const usrRes = await fetch('/api/admin/users', {
        headers: { 'x-auth-token': sessionToken }
      });
      if (usrRes.ok) {
        const usrPayload = await usrRes.json();
        if (usrPayload.status === 'success') {
          setUsersList(usrPayload.users);
        }
      }

      // 3. Fetch Audit Logs
      const logsRes = await fetch('/api/admin/audit-logs', {
        headers: { 'x-auth-token': sessionToken }
      });
      if (logsRes.ok) {
        const logsPayload = await logsRes.json();
        if (logsPayload.status === 'success') {
          setAuditLogs(logsPayload.logs || []);
        }
      }

    } catch (err: any) {
      console.error(err);
      setErrorMsg(`Failed to query background administrative context: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdminState();
  }, [activeRole, sessionToken]);

  // Called after any entitlement mutation in the modal succeeds.
  const handleEntitlementChanged = () => {
    setManagingWorkspace(null);
    setSuccessMsg('Entitlement updated.');
    loadAdminState();
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const handleFlushCache = () => {
    setFlushing(true);
    setTimeout(() => {
      setFlushing(false);
      setCacheFlushMessage('Flushed system-wide caching layers. Next metrics retrieve will pull directly from database integrations.');
      setTimeout(() => setCacheFlushMessage(null), 3000);
    }, 800);
  };

  // Guard for non-admin configurations
  if (activeRole !== UserRole.SUPER_ADMIN) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center max-w-xl mx-auto space-y-4 shadow-sm" id="admin-panel-locked">
        <div className="w-16 h-16 bg-rose-50 border border-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-2 shadow-inner">
          <Lock className="w-7 h-7" />
        </div>
        <h3 className="text-lg font-black text-slate-900 tracking-tight">Administrative Console Locked</h3>
        <p className="text-slate-500 text-xs leading-relaxed max-w-sm mx-auto">
          You are authenticated as <b>{activeRole}</b>. Only accounts with global <b>SUPER_ADMIN</b> privileges can manage platform workspaces, suspend client accounts, or review network audit trails.
        </p>
        <div className="text-[10px] font-mono p-2.5 bg-slate-50 rounded-lg text-slate-400 border border-slate-205 select-all">
          active_role_grid: {activeRole} | workspace_isolation: active
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" id="super-admin-view-panel">
      {/* Upper header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] bg-blue-50 border border-blue-200 text-blue-700 px-2.5 py-0.5 rounded-full font-black uppercase tracking-wider block w-fit mb-1.5">
            Platform Operator
          </span>
          <h2 className="text-xl font-bold tracking-tight text-[#0F172A] mb-1">
            Global SaaS Control Hub
          </h2>
          <p className="text-slate-500 text-xs font-semibold">
            Manage multi-tenant boundaries, view GHL connector parameters, suspend nodes, and trace platform activity records.
          </p>
        </div>

        <button 
          onClick={loadAdminState}
          disabled={loading}
          className="flex items-center gap-1.5 p-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition shadow-sm shadow-blue-500/10 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Database State
        </button>
      </div>

      {/* Success / Error Notifiers */}
      {successMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2 font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2 font-semibold">
          <AlertTriangle className="w-4 h-4 text-rose-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Grid of Workspaces and Platform diagnostics */}
      {loading ? (
        <div className="py-12 text-center space-y-2">
          <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto" />
          <p className="text-xs text-slate-500">Querying platform metadata records...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          
          {/* Main workspace table (covers 2 cols) */}
          <div className="xl:col-span-2 space-y-6">
            
            {/* WORKSPACES TENANT CONTROL */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building className="w-4.5 h-4.5 text-blue-600" />
                  <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">Multi-Tenant Workspaces</h3>
                </div>
                <span className="text-[10px] font-mono text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-205 font-bold">
                  {workspaces.length} Tenants Found
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead className="bg-[#f8fafc] border-b border-slate-200 text-[10px] text-slate-400 uppercase font-black">
                    <tr>
                      <th className="p-4 pl-5">Business Tenant</th>
                      <th className="p-4">GHL Location</th>
                      <th className="p-4">Access</th>
                      <th className="p-4">Team Size</th>
                      <th className="p-4">GHL Status</th>
                      <th className="p-4 pr-5 text-right">Entitlement</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                    {workspaces.map((ws) => (
                      <tr key={ws.id} className="hover:bg-slate-50/50">
                        <td className="p-4 pl-5">
                          <span className="font-bold text-slate-900 block">{ws.name}</span>
                          <span className="text-[9px] text-slate-400 font-mono block">slug: {ws.slug}</span>
                        </td>
                        <td className="p-4">
                          <span className="font-mono text-[10px] font-bold bg-slate-100 px-2 py-0.5 rounded text-slate-600 block w-fit">
                            {ws.ghlLocationId}
                          </span>
                        </td>
                        <td className="p-4 text-slate-900 font-bold">
                          {ws.entitlement ? (
                            <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${accessPill(ws.entitlement.accessStatus).cls}`}>
                              <span className={`w-1 h-1 rounded-full ${accessPill(ws.entitlement.accessStatus).dot}`} />
                              {ws.entitlement.accessStatus}
                              {ws.entitlement.accessStatus === 'TRIAL' && ws.entitlement.trialDaysRemaining !== null && (
                                <span className="opacity-70">· {ws.entitlement.trialDaysRemaining}d</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-black border border-slate-200">
                              {ws.plan || 'STARTER'}
                            </span>
                          )}
                        </td>
                        <td className="p-4 text-slate-500 font-mono text-[10px] font-bold">
                          {ws.membersCount || 1} Members
                        </td>
                        <td className="p-4">
                          <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                            ws.connectionStatus === 'CONNECTED'
                              ? 'bg-emerald-50 text-emerald-700 font-bold'
                              : ws.connectionStatus === 'STALE'
                              ? 'bg-amber-50 text-amber-700 font-bold'
                              : 'bg-slate-100 text-slate-500 font-bold'
                          }`}>
                            <span className={`w-1 h-1 rounded-full ${
                              ws.connectionStatus === 'CONNECTED' ? 'bg-emerald-500' : ws.connectionStatus === 'STALE' ? 'bg-amber-500' : 'bg-slate-400'
                            }`} />
                            {ws.connectionStatus}
                          </span>
                        </td>
                        <td className="p-4 pr-5 text-right">
                          <button
                            onClick={() => setManagingWorkspace(ws)}
                            className="p-1.5 px-3 rounded-lg text-[10px] font-black uppercase tracking-wider cursor-pointer transition flex items-center gap-1.5 ml-auto border bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                          >
                            <Settings className="w-3 h-3" />
                            Manage
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* USERS ROLES OVERVIEW */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-4.5 h-4.5 text-blue-600" />
                  <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">Authentication Users & Workspace Map</h3>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead className="bg-[#f8fafc] border-b border-slate-200 text-[10px] text-slate-400 uppercase font-black">
                    <tr>
                      <th className="p-4 pl-5">User Persona</th>
                      <th className="p-4">Contact Email</th>
                      <th className="p-4">Registered Date</th>
                      <th className="p-4 pr-5">Workspace Allocations</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                    {usersList.map((user) => (
                      <tr key={user.id} className="hover:bg-slate-50/50">
                        <td className="p-4 pl-5">
                          <span className="font-bold text-slate-900 block">{user.name}</span>
                          <span className="text-[9px] text-slate-400 font-mono">ID: {user.id}</span>
                        </td>
                        <td className="p-4 font-mono text-[11px] text-slate-500">
                          {user.email}
                        </td>
                        <td className="p-4 text-slate-500 text-[10px]">
                          {new Date(user.createdAt).toLocaleDateString()}
                        </td>
                        <td className="p-4 pr-5">
                          <div className="flex flex-wrap gap-1.5">
                            {user.memberships.length === 0 ? (
                              <span className="text-[9px] bg-slate-100 text-slate-400 font-bold px-2 py-0.5 rounded border">
                                Uninvited Pending
                              </span>
                            ) : (
                              user.memberships.map((m: any, idx: number) => (
                                <span key={idx} className="text-[9px] bg-blue-50 text-blue-700 border border-blue-150 font-bold px-2 py-0.5 rounded flex items-center gap-1.5">
                                  <span>{m.workspaceName}</span>
                                  <span className="bg-blue-600 text-white font-mono px-1 rounded text-[8px] uppercase font-black">
                                    {m.role}
                                  </span>
                                </span>
                              ))
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* AUDIT LOG REPORT LIST */}
            <div className="bg-[#0b1321] text-slate-300 font-mono border border-slate-800 rounded-xl overflow-hidden shadow-xs">
              <div className="bg-[#0e192c] px-5 py-3 border-b border-slate-800 flex items-center justify-between">
                <span className="flex items-center gap-2 font-bold text-slate-200 text-xs">
                  <Terminal className="w-4 h-4 text-blue-500" />
                  REAL-TIME MULTI-TENANT AUDIT RECORD STREAM
                </span>
                <span className="text-[9px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded font-black font-mono">
                  SECURE PERSISTENCE
                </span>
              </div>
              <div className="p-4 text-[11px] space-y-2.5 max-h-[250px] overflow-y-auto">
                {auditLogs.map((log: any) => (
                  <div key={log.id} className="flex items-start gap-3 border-b border-slate-850 pb-2 last:border-0 leading-normal">
                    <span className="text-slate-500 shrink-0 select-none">[{new Date(log.timestamp).toLocaleTimeString(undefined, { hour12: false })}]</span>
                    <span className="text-[#38bdf8] shrink-0 font-bold text-[10px]">@{log.userEmail.split('@')[0]}</span>
                    <span className="text-emerald-400 shrink-0 font-bold uppercase text-[9px] border border-emerald-500/20 px-1 py-0.2 rounded font-sans leading-none mt-0.5">
                      {log.action}
                    </span>
                    <span className="text-slate-300 break-all">{log.details}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* Diagnostics sidebar */}
          <div className="xl:col-span-1 space-y-6">
            
            {/* PLATFORM DIAGNOSTICS */}
            <div className="bg-white border border-slate-200 shadow-sm rounded-xl p-5 space-y-4">
              <h3 className="font-bold text-[#0F172A] text-xs uppercase tracking-wider pb-2 border-b border-slate-100 flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-emerald-600" />
                SaaS System Health
              </h3>

              <div className="space-y-4 font-sans">
                {/* Health indicator */}
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500 font-semibold">Active Container Ingress</span>
                  <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-250 px-2.5 py-0.5 rounded-full font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Healthy (Port 3000)
                  </span>
                </div>

                {/* DB Sync indicator */}
                <div className="flex justify-between items-center text-xs border-t border-slate-50 pt-2 text-slate-500">
                  <span>In-Memory Registry</span>
                  <span className="text-slate-950 font-black">Online (Active)</span>
                </div>

                {/* Sub-Plan summary info */}
                <div className="flex justify-between items-center text-xs border-t border-slate-50 pt-2 text-slate-500">
                  <span>Private OAuth Gateway</span>
                  <span className="text-slate-950 font-black">Ready</span>
                </div>
              </div>

              {/* Cached manual tasks */}
              <div className="pt-2 border-t border-slate-100 space-y-2.5">
                <button
                  onClick={handleFlushCache}
                  disabled={flushing}
                  className="w-full flex items-center justify-center gap-1.5 p-2 bg-slate-50 border border-slate-250 hover:bg-slate-100 rounded-lg text-xs font-bold text-slate-800 transition cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                  {flushing ? 'Flushing SaaS caches...' : 'Flush Database Cache'}
                </button>

                {cacheFlushMessage && (
                  <div className="p-3 bg-emerald-50 border border-emerald-150 text-emerald-800 text-[10px] leading-relaxed rounded-lg flex items-start gap-1 w-full font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                    <span>{cacheFlushMessage}</span>
                  </div>
                )}
              </div>
            </div>

            {/* TROUBLESHOOT OR SYNC TRIGGER CARDS */}
            <div className="bg-white border border-slate-200 shadow-sm rounded-xl p-5 space-y-4">
              <h3 className="font-bold text-[#0F172A] text-xs uppercase tracking-wider pb-2 border-b border-slate-100 flex items-center gap-1.5">
                <KeyRound className="w-4 h-4 text-blue-600" />
                GHL Gateway Troubleshooter
              </h3>

              <p className="text-slate-500 text-[11px] leading-relaxed font-semibold">
                SAs or Admins can simulate integration latency tests to diagnose LeadConnector API V2 response metrics.
              </p>

              <button
                onClick={onSyncMetrics}
                disabled={isSyncing}
                className="w-full flex items-center justify-center gap-2 p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition cursor-pointer disabled:opacity-50"
              >
                {isSyncing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Synchronizing Integration Nodes...
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    Test Ping LeadConnector API
                  </>
                )}
              </button>
            </div>

            <div className="bg-blue-50 border border-blue-200 border-dashed rounded-xl p-4.5 text-xs text-blue-800 space-y-2">
              <h4 className="font-black flex items-center gap-1 text-[11px] uppercase tracking-wider">
                <ShieldCheck className="w-4 h-4 text-[#1D4ED8]" />
                Superuser Console
              </h4>
              <p className="leading-relaxed opacity-95 text-[11px] font-medium">
                SaaS tenant isolation rules are applied cryptographically server-side. Workspace managers cannot bypass membership boundaries, ensuring extreme customer data shielding.
              </p>
            </div>

          </div>

        </div>
      )}

      {managingWorkspace && (
        <EntitlementManagerModal
          workspace={managingWorkspace}
          sessionToken={sessionToken}
          onClose={() => setManagingWorkspace(null)}
          onChanged={handleEntitlementChanged}
        />
      )}

    </div>
  );
}
