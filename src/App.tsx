/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Building2,
  LayoutDashboard,
  BarChart3,
  Users2,
  TrendingUp,
  DollarSign,
  Receipt,
  SlidersHorizontal,
  AlertCircle,
  Clock,
  Sparkles,
  ExternalLink,
  ChevronRight,
  Database,
  CalendarDays,
  Smartphone,
  RefreshCw,
  Sliders,
  Shield,
  CreditCard,
  Building,
  PowerOff,
  Menu,
  Plug,
  CheckSquare,
  X
} from 'lucide-react';

import { 
  DashboardMetrics, 
  OwnerPerformanceMetric, 
  MarketingMetric, 
  GHLAppConfig, 
  GHLContact, 
  GHLOpportunity 
} from './types';

import ReportingCommandCenter from './components/ReportingCommandCenter';
import Settings from './components/Settings';
import GlobalSettingsView from './components/GlobalSettingsView';
import AdminView from './components/AdminView';
import BillingView from './components/BillingView';
import SaaSAuthLayer from './components/SaaSAuthLayer';
import TrialNoticeBanner from './components/TrialNoticeBanner';
import IntegrationsCenterView from './components/IntegrationsCenterView';
import ClientTrialsView from './components/ClientTrialsView';
import TaskManagementView from './components/tasks/TaskManagementView';
import { isTaskManagementUiEnabled } from './tasks/featureFlag';
import { UserRole } from './types';

// Fallbacks if server fails/loads
const initialMetrics: DashboardMetrics = {
  totalLeads: 0,
  leadsDelta: 0,
  pipelineValue: 0,
  pipelineDelta: 0,
  closedWonRevenue: 0,
  revenueDelta: 0,
  appointmentShowRate: 0,
  showRateDelta: 0,
  trends: { leads: [], pipeline: [], revenue: [], appointments: [] }
};

function AppCockpit({ user, activeWorkspace, role, workspaces, token, logout, triggerRefresh, switchWorkspace, entitlement }: any) {
  // Dismissal is per-session by design: it must reappear on the next visit as the deadline
  // nears. Persisting it would let a user permanently silence the last warning before lockout.
  const [trialNoticeDismissed, setTrialNoticeDismissed] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'opportunity-dashboard' | 'sales-dashboard' | 'appointment-dashboard' | 'marketing-dashboard' | 'estimates-dashboard' | 'ghl-settings' | 'integrations' | 'settings' | 'admin' | 'client-trials' | 'task-management' | 'billing'>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = (tab: typeof activeTab) => { setActiveTab(tab); setSidebarOpen(false); };
  
  // Dashboard states
  const [metrics, setMetrics] = useState<DashboardMetrics>(initialMetrics);
  const [contacts, setContacts] = useState<GHLContact[]>([]);
  const [opportunities, setOpportunities] = useState<GHLOpportunity[]>([]);
  
  // Performance and attribution states
  const [performanceData, setPerformanceData] = useState<OwnerPerformanceMetric[]>([]);
  const [marketingData, setMarketingData] = useState<MarketingMetric[]>([]);
  
  // GHL integration configuration 
  const [config, setConfig] = useState<GHLAppConfig>({
    dataSourceMode: 'MOCK',
    apiKey: '',
    locationId: '',
    webhookUrl: '',
    apiConnectedSince: null,
    cacheTtlMinutes: 15,
    rateLimitStatus: { remaining: 100, limit: 100 }
  });
  const [webhookLogs, setWebhookLogs] = useState<any[]>([]);

  // Async load states
  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState<string | null>(null);
  const [isFetchingSub, setIsFetchingSub] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  // Time tracker for visual clock
  const [currentTime, setCurrentTime] = useState(new Date().toISOString());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toISOString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchAllReportingData = async (silently = false) => {
    if (!silently) setLoading(true);
    setErrorState(null);
    setIsFetchingSub(true);

    try {
      const headers = { 'x-auth-token': token };
      
      // 1. Fetch KPI metrics (total leads, pipeline value, won revenue)
      const metricsRes = await fetch('/api/ghl/metrics', { headers });
      if (!metricsRes.ok) throw new Error(`Server metrics route returned status: ${metricsRes.status}`);
      const metricsPayload = await metricsRes.json();
      
      if (metricsPayload.status === 'success') {
        setMetrics(metricsPayload.data);
      }

      // 2. Fetch Owner performance metrics grouped by GHL assignee
      const perfRes = await fetch('/api/ghl/owner-performance', { headers });
      if (perfRes.ok) {
        const perfPayload = await perfRes.json();
        if (perfPayload.status === 'success') {
          setPerformanceData(perfPayload.data);
        }
      }

      // 3. Fetch Marketing Attribution metrics grouped by UTM source
      const marketingRes = await fetch('/api/ghl/marketing-performance', { headers });
      if (marketingRes.ok) {
        const markPayload = await marketingRes.json();
        if (markPayload.status === 'success') {
          setMarketingData(markPayload.data);
        }
      }

      // 4. Fetch the GHL Gateway Config and Webhook streams
      const configRes = await fetch('/api/ghl/config', { headers });
      if (configRes.ok) {
        const configPayload = await configRes.json();
        if (configPayload.status === 'success') {
          setConfig(configPayload.data);
          setWebhookLogs(configPayload.webhookLogs || []);
        }
      }

      // Seed direct opportunities details for main drilldown logs Table
      const mockImports = await import('./mockData');
      setContacts(mockImports.mockContacts);
      setOpportunities(mockImports.mockOpportunities);

    } catch (err: any) {
      console.error('Error querying SaaS metrics:', err);
      setErrorState(`Failed to communicate with fullstack reporting server: ${err.message}. Ensure your background environment is active.`);
    } finally {
      setLoading(false);
      setIsFetchingSub(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchAllReportingData();
    }
  }, [token, activeWorkspace?.id]);

  // Update backend GHL tokens & source modes
  const handleSaveConfig = async (updatedFields: Partial<GHLAppConfig>): Promise<boolean> => {
    setIsSavingConfig(true);
    try {
      const response = await fetch('/api/ghl/config', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-auth-token': token
        },
        body: JSON.stringify(updatedFields)
      });
      if (!response.ok) throw new Error('Failed to update GoHighLevel token configuration');
      
      const payload = await response.json();
      if (payload.status === 'success') {
        setConfig(payload.data);
        // Refresh reporting stats to apply the mock/live toggle instantly
        await fetchAllReportingData(true);
        return true;
      }
      return false;
    } catch (err: any) {
      console.error(err);
      alert(`Integration save failed: ${err.message}`);
      return false;
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Webhook integration sandbox simulation trigger
  const handleTriggerMockWebhook = async (event: string) => {
    try {
      let mockPayload = {};
      const generatedId = `web_evt_${Math.floor(Math.random() * 900) + 100}`;
      
      if (event === 'contact.create') {
        mockPayload = {
          type: 'contact.create',
          id: generatedId,
          contactName: 'James Miller',
          email: 'james.m@showtimepools.com',
          phone: '512-555-9011',
          source: 'Google Local Service Ads'
        };
      } else if (event === 'opportunity.update') {
        mockPayload = {
          type: 'opportunity.update',
          id: generatedId,
          oppName: 'Robert Vance - Commercial Spa Upgrade',
          status: 'won',
          value: 12500,
          assignedTo: 'usr_002',
          source: 'Facebook Ads'
        };
      } else {
        mockPayload = {
          type: 'appointment.show',
          id: generatedId,
          title: 'Consultation - Amanda Ross',
          appointmentStatus: 'showed',
          userId: 'usr_003'
        };
      }

      // POST to simulated local webhook endpoint
      const response = await fetch('/api/ghl/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockPayload)
      });

      if (response.ok) {
        // Fetch updated config logs list and metrics immediately
        await fetchAllReportingData(true);
      }
    } catch (err) {
      console.error('Webhook trigger simulation errored:', err);
    }
  };

  return (
    <div className="h-screen bg-[#f1f5f9] text-slate-900 flex antialiased font-sans">

      {/* Mobile overlay backdrop */}
      <div
        className={`fixed inset-0 bg-black/60 z-20 md:hidden transition-opacity duration-200 ${sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      {/* 1. SIDEBAR NAVIGATION */}
      <aside
        id="control-center-sidebar"
        className={`fixed md:sticky md:top-0 inset-y-0 left-0 z-30 md:z-auto h-screen w-64 bg-[#0a1424] text-white border-r border-[#1e2a3b] shrink-0 flex flex-col justify-between transition-transform duration-200 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        
        {/* Upper Sidebar Items */}
        <div className="p-5 space-y-6">
          {/* Main Title Badge with personalized user context branding */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-black text-sm text-white shadow-md shadow-blue-500/20 shrink-0">
              ST
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xs font-black tracking-wider text-white uppercase leading-none">
                HighLevel Command
              </h1>
              <span className="text-[9px] uppercase font-bold text-slate-400 tracking-widest block mt-1">
                SOLUTIONS SUITE
              </span>
            </div>
            <button
              className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition cursor-pointer shrink-0"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close menu"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Current Connected Location Account */}
          <div className="p-3 bg-[#0e192c] rounded-xl border border-[#1e2a3b] space-y-2">
            <div>
              <span className="text-[9px] uppercase tracking-wider text-slate-400 font-black block">Active Workspace</span>
              <span className="text-white text-xs font-black block mt-0.5 select-all">
                {activeWorkspace ? activeWorkspace.name : 'Showtime Pool Mechanics'}
              </span>
            </div>

            {workspaces.length > 1 && (
              <div className="pt-2 border-t border-slate-800/80 space-y-1">
                <label className="text-[8px] uppercase font-black text-slate-500 tracking-wider block">Switch Organization</label>
                <select
                  value={activeWorkspace?.id || ''}
                  onChange={(e) => switchWorkspace(e.target.value)}
                  className="w-full bg-[#0a1424] text-white border border-slate-800 text-[10px] p-1 px-1.5 rounded outline-none font-bold cursor-pointer hover:border-slate-700 transition"
                >
                  {workspaces.map((ws: any) => (
                    <option key={ws.id} value={ws.id}>{ws.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Nav list */}
          <div className="space-y-1" id="sidebar-navigation-items">
            
            {/* Nav Section Label */}
            <span className="text-[9px] text-slate-500 uppercase tracking-widest block font-extrabold mb-2 pt-2">PRIMARY ANALYTICS</span>

            {/* General Dashboard */}
            <button
              onClick={() => navigate('dashboard')}
              id="nav-btn-dashboard"
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all text-left cursor-pointer ${
                activeTab === 'dashboard'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:bg-[#111c2e] hover:text-white'
              }`}
            >
              <LayoutDashboard className="w-4 h-4 shrink-0 text-blue-500" />
              General Dashboard
            </button>

            {/* Opportunity Dashboard */}
            <button
              onClick={() => navigate('opportunity-dashboard')}
              id="nav-btn-opportunity"
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all text-left cursor-pointer ${
                activeTab === 'opportunity-dashboard'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:bg-[#111c2e] hover:text-white'
              }`}
            >
              <TrendingUp className="w-4 h-4 shrink-0 text-blue-500" />
              Opportunity Dashboard
            </button>

            {/* Sales Dashboard */}
            <button
              onClick={() => navigate('sales-dashboard')}
              id="nav-btn-sales"
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all text-left cursor-pointer ${
                activeTab === 'sales-dashboard'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:bg-[#111c2e] hover:text-white'
              }`}
            >
              <DollarSign className="w-4 h-4 shrink-0 text-blue-500" />
              Sales Dashboard
            </button>

            {/* Appointment Dashboard */}
            <button
              onClick={() => navigate('appointment-dashboard')}
              id="nav-btn-appointment"
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all text-left cursor-pointer ${
                activeTab === 'appointment-dashboard'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:bg-[#111c2e] hover:text-white'
              }`}
            >
              <CalendarDays className="w-4 h-4 shrink-0 text-blue-500" />
              Appointment Dashboard
            </button>

            {/* Marketing Dashboard */}
            <button
              onClick={() => navigate('marketing-dashboard')}
              id="nav-btn-marketing"
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all text-left cursor-pointer ${
                activeTab === 'marketing-dashboard'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:bg-[#111c2e] hover:text-white'
              }`}
            >
              <BarChart3 className="w-4 h-4 shrink-0 text-blue-500" />
              Marketing Dashboard
            </button>

            {/* Estimates & Invoices */}
            <button
              onClick={() => navigate('estimates-dashboard')}
              id="nav-btn-estimates"
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all text-left cursor-pointer ${
                activeTab === 'estimates-dashboard'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:bg-[#111c2e] hover:text-white'
              }`}
            >
              <Receipt className="w-4 h-4 shrink-0 text-blue-500" />
              Estimates &amp; Invoices
            </button>

            {/* Config Section Label */}
            <span className="text-[9px] text-slate-500 uppercase tracking-widest block font-extrabold pt-4 mb-2">INTEGRATIONS & LAUNCH</span>
            
            {/* GHL V2 API Settings Link */}
            <button
              onClick={() => navigate('ghl-settings')}
              id="nav-btn-ghl-setup"
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all text-left cursor-pointer ${
                activeTab === 'ghl-settings'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:bg-[#111c2e] hover:text-white'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4 shrink-0 text-blue-500" />
              GHL V2 API Settings
            </button>

            {/* Integrations Center Link */}
            <button
              onClick={() => navigate('integrations')}
              id="nav-btn-integrations"
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all text-left cursor-pointer ${
                activeTab === 'integrations'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:bg-[#111c2e] hover:text-white'
              }`}
            >
              <Plug className="w-4 h-4 shrink-0 text-blue-500" />
              Integrations
            </button>

            {/* Settings Link */}
            <button
              onClick={() => navigate('settings')}
              id="nav-btn-settings"
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all text-left cursor-pointer ${
                activeTab === 'settings'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:bg-[#111c2e] hover:text-white'
              }`}
            >
              <Sliders className="w-4 h-4 shrink-0 text-blue-500" />
              Settings
            </button>

            {/* System Admin Section Label */}
            <span className="text-[9px] text-slate-500 uppercase tracking-widest block font-extrabold pt-4 mb-2">SYSTEM ADMIN</span>

            {/* Admin Link */}
            <button
              onClick={() => navigate('admin')}
              id="nav-btn-admin"
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all text-left cursor-pointer ${
                activeTab === 'admin'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:bg-[#111c2e] hover:text-white'
              }`}
            >
              <Shield className="w-4 h-4 shrink-0 text-blue-500" />
              Admin
            </button>

            {/* Client Trials Link */}
            <button
              onClick={() => navigate('client-trials')}
              id="nav-btn-client-trials"
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all text-left cursor-pointer ${
                activeTab === 'client-trials'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:bg-[#111c2e] hover:text-white'
              }`}
            >
              <Users2 className="w-4 h-4 shrink-0 text-blue-500" />
              Client Trials
            </button>

            {/* Task Management — hidden unless the client flag is explicitly enabled.
                The API is protected separately by the server-side flag. */}
            {isTaskManagementUiEnabled() && (
              <button
                onClick={() => navigate('task-management')}
                id="nav-btn-task-management"
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all text-left cursor-pointer ${
                  activeTab === 'task-management'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:bg-[#111c2e] hover:text-white'
                }`}
              >
                <CheckSquare className="w-4 h-4 shrink-0 text-blue-500" />
                Task Management
              </button>
            )}

            {/* Billing Link */}
            <button
              onClick={() => navigate('billing')}
              id="nav-btn-billing"
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all text-left cursor-pointer ${
                activeTab === 'billing'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:bg-[#111c2e] hover:text-white'
              }`}
            >
              <CreditCard className="w-4 h-4 shrink-0 text-blue-500" />
              Billing
            </button>
          </div>
        </div>

        {/* Lower Sidebar details / Dev Clock and Server states */}
        <div className="p-5 border-t border-[#1e2a3b] space-y-4">
          <div className="space-y-1 bg-slate-900/45 p-3 rounded-lg border border-slate-800/40">
            <div className="flex items-center gap-1.5 text-[9px] text-slate-400 font-bold uppercase tracking-wider">
              <Clock className="w-3.5 h-3.5 text-blue-400" />
              <span>Diagnostic System Time</span>
            </div>
            <span className="font-mono text-white text-[11px] block text-left">
              {new Date(currentTime).toLocaleTimeString(undefined, { hour12: false })} UTC
            </span>
            <span className="text-[9px] text-slate-400 block truncate font-mono mt-0.5">
              {new Date(currentTime).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>

          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 p-2 bg-rose-950/40 border border-rose-900/80 text-rose-300 hover:bg-rose-900/50 rounded-lg text-xs font-bold transition cursor-pointer"
          >
            <PowerOff className="w-3.5 h-3.5 text-rose-500" />
            Terminate Session
          </button>
        </div>
      </aside>

      {/* 2. MAIN HUB CANVAS */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden" id="main-content-hub">
        
        {/* Global Hub Header bar */}
        <header className="bg-white border-b border-slate-200 px-4 md:px-8 py-4 flex flex-row items-center justify-between gap-3 shrink-0 shadow-xs">
          {/* Hamburger — mobile only */}
          <button
            className="md:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition cursor-pointer shrink-0"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
            <h1 className="text-[#0F172A] font-extrabold text-sm tracking-tight pr-2">
              HighLevel Command Suite
            </h1>
            
            {/* Live Indicator capsule */}
            <div className={`p-1 px-2.5 rounded-full text-[9px] font-mono font-bold uppercase flex items-center gap-1.5 ${
              config.dataSourceMode === 'LIVE' 
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-250'
                : 'bg-amber-50 text-amber-700 border border-amber-250'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${config.dataSourceMode === 'LIVE' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              {config.dataSourceMode === 'LIVE' ? 'LIVE GHL ACTIVE' : 'MOCK PREVIEW'}
            </div>
          </div>

          {/* Quick Details or user contextual email representation */}
          <div className="flex items-center gap-3.5 text-xs text-slate-650">
            <div className="text-right hidden sm:block">
              <span className="text-[11px] block font-extrabold text-slate-905 flex items-center gap-1 w-full justify-end">
                {user ? user.name : 'Showtime Team Root'}
                {role && (
                  <span className="bg-blue-600 text-[8px] font-black tracking-widest text-white px-1.5 py-0.5 rounded uppercase leading-none shrink-0 font-sans">
                    {role.replace('WORKSPACE_', '')}
                  </span>
                )}
              </span>
              <span className="text-[9px] font-mono text-slate-400 block truncate max-w-[200px]" title={user?.email || 'operations@showtimepoolmechanics.com'}>
                {user ? user.email : 'operations@showtimepoolmechanics.com'}
              </span>
            </div>
            
            <div className="w-8 h-8 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center text-blue-700 font-extrabold text-xs uppercase font-sans">
              {user ? user.name.slice(0, 2) : 'ST'}
            </div>
          </div>
        </header>

        {/* Dynamic content rendering with responsive inner wrapper */}
        <div className="flex-1 p-3 pb-16 sm:p-6 sm:pb-12 overflow-y-auto w-full mx-auto" id="dynamic-reporting-scroller">

          {/* Trial countdown. Self-hides outside the 7/3/1-day marks and for licensed
              workspaces, so it costs nothing to render unconditionally. */}
          {!trialNoticeDismissed && (
            <div className="mb-4">
              <TrialNoticeBanner
                entitlement={entitlement}
                onDismiss={() => setTrialNoticeDismissed(true)}
              />
            </div>
          )}
          
          {/* Main notification Banner for empty/offline setup error fallback */}
          {errorState && (
            <div className="mb-6 p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-600 mt-0.5" />
              <div className="space-y-1">
                <h4 className="font-bold text-sm">Dashboard Connection Warning</h4>
                <p className="text-xs leading-relaxed opacity-95">{errorState}</p>
                <button 
                  onClick={() => fetchAllReportingData()} 
                  className="mt-2 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white px-2.5 py-1 rounded cursor-pointer transition-colors"
                >
                  Retry Sync Connection
                </button>
              </div>
            </div>
          )}

          {/* LOADING SHELL STATE */}
          {loading ? (
            <div className="py-24 text-center space-y-4" id="dashboard-loading-stage">
              <RefreshCw className="w-10 h-10 text-blue-650 animate-spin mx-auto" />
              <div>
                <h3 className="font-black text-slate-900 text-base">Assembling HighLevel Datasets...</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto font-medium">
                  Computing contact pipelines and marketing ROI attribution values from server environment memory.
                </p>
              </div>
            </div>
          ) : (
            <div className="animate-fade-in transition duration-300">
              
              {/* COMPONENT ROUTER TAB CONTEXTUALS */}
              {activeTab === 'dashboard' && (
                <ReportingCommandCenter
                  dataSourceMode={config.dataSourceMode}
                  onSyncMetrics={() => fetchAllReportingData(true)}
                  isSyncing={isFetchingSub}
                  token={token}
                  user={user}
                  activeWorkspace={activeWorkspace}
                  role={role}
                />
              )}

              {activeTab === 'opportunity-dashboard' && (
                <ReportingCommandCenter
                  dataSourceMode={config.dataSourceMode}
                  onSyncMetrics={() => fetchAllReportingData(true)}
                  isSyncing={isFetchingSub}
                  forcedView="opportunity"
                  token={token}
                  user={user}
                  activeWorkspace={activeWorkspace}
                  role={role}
                />
              )}

              {activeTab === 'sales-dashboard' && (
                <ReportingCommandCenter
                  dataSourceMode={config.dataSourceMode}
                  onSyncMetrics={() => fetchAllReportingData(true)}
                  isSyncing={isFetchingSub}
                  forcedView="sales"
                  token={token}
                  user={user}
                  activeWorkspace={activeWorkspace}
                  role={role}
                />
              )}

              {activeTab === 'appointment-dashboard' && (
                <ReportingCommandCenter
                  dataSourceMode={config.dataSourceMode}
                  onSyncMetrics={() => fetchAllReportingData(true)}
                  isSyncing={isFetchingSub}
                  forcedView="appointment"
                  token={token}
                  user={user}
                  activeWorkspace={activeWorkspace}
                  role={role}
                />
              )}

              {activeTab === 'marketing-dashboard' && (
                <ReportingCommandCenter
                  dataSourceMode={config.dataSourceMode}
                  onSyncMetrics={() => fetchAllReportingData(true)}
                  isSyncing={isFetchingSub}
                  forcedView="marketing"
                  token={token}
                  user={user}
                  activeWorkspace={activeWorkspace}
                  role={role}
                />
              )}

              {activeTab === 'estimates-dashboard' && (
                <ReportingCommandCenter
                  dataSourceMode={config.dataSourceMode}
                  onSyncMetrics={() => fetchAllReportingData(true)}
                  isSyncing={isFetchingSub}
                  forcedView="estimates"
                  token={token}
                  user={user}
                  activeWorkspace={activeWorkspace}
                  role={role}
                />
              )}

              {activeTab === 'ghl-settings' && (
                <Settings
                  config={config}
                  webhookLogs={webhookLogs}
                  isSaving={isSavingConfig}
                  onSaveConfig={handleSaveConfig}
                  onTriggerMockWebhook={handleTriggerMockWebhook}
                  onRefresh={() => fetchAllReportingData(true)}
                  role={role}
                  token={token}
                />
              )}

              {activeTab === 'integrations' && (
                <IntegrationsCenterView
                  sessionToken={token}
                  onNavigate={(t) => navigate(t as typeof activeTab)}
                />
              )}

              {activeTab === 'settings' && (
                <GlobalSettingsView />
              )}

              {activeTab === 'admin' && (
                <AdminView 
                  dataSourceMode={config.dataSourceMode} 
                  onSyncMetrics={() => fetchAllReportingData(true)} 
                  isSyncing={isFetchingSub} 
                  activeRole={role}
                  sessionToken={token}
                />
              )}

              {activeTab === 'client-trials' && (
                <ClientTrialsView
                  activeRole={role}
                  sessionToken={token}
                />
              )}

              {activeTab === 'task-management' && isTaskManagementUiEnabled() && (
                <TaskManagementView token={token} role={role} />
              )}

              {activeTab === 'billing' && (
                <BillingView />
              )}

            </div>
          )}

        </div>
      </main>

    </div>
  );
}

export default function App() {
  return (
    <SaaSAuthLayer>
      {({ user, activeWorkspace, role, workspaces, token, logout, triggerRefresh, switchWorkspace, entitlement }) => (
        <AppCockpit
          user={user}
          activeWorkspace={activeWorkspace}
          role={role}
          workspaces={workspaces}
          token={token}
          logout={logout}
          triggerRefresh={triggerRefresh}
          switchWorkspace={switchWorkspace}
          entitlement={entitlement}
        />
      )}
    </SaaSAuthLayer>
  );
}
