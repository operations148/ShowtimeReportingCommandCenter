import React, { useState, useEffect } from 'react';
import {
  Building2,
  Lock,
  Unlock, 
  UserCheck, 
  ExternalLink, 
  RefreshCw, 
  AlertCircle,
  Building,
  KeyRound,
  Mail,
  ArrowRight,
  Plus,
  Compass,
  CheckCircle,
  HelpCircle,
  Users,
  CreditCard,
  FileCheck,
  PowerOff
} from 'lucide-react';
import { UserRole } from '../types';
import type { Entitlement } from '../entitlements';
import AccessLockedScreen from './AccessLockedScreen';

interface SaaSAuthLayerProps {
  children: (authContext: {
    user: any;
    activeWorkspace: any;
    role: UserRole;
    workspaces: any[];
    token: string;
    logout: () => void;
    triggerRefresh: () => void;
    switchWorkspace: (workspaceId: string) => Promise<void>;
    /** Server-derived access decision. Presentational use only — the gate is server-side. */
    entitlement: Entitlement | null;
  }) => React.ReactNode;
}

export default function SaaSAuthLayer({ children }: SaaSAuthLayerProps) {
  // Detect iframe context safely (cross-origin access can throw)
  const isInIframe = (() => { try { return window.self !== window.top; } catch { return true; } })();

  // GHL SSO state: true while waiting for postMessage response (blocks login flash)
  const [ghlSsoLoading, setGhlSsoLoading] = useState<boolean>(isInIframe);

  // Authentication & session state
  const [token, setToken] = useState<string>(() => localStorage.getItem('saas_token') || '');
  const [session, setSession] = useState<any>(null);
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Authentication page state navigation: 'login' | 'signup' | 'forgot' | 'onboarding' | 'app'
  const [page, setPage] = useState<'login' | 'signup' | 'forgot' | 'onboarding'>('login');

  // Login Form State — ?email= query param is display hint only, never used as auth
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Signup Form State
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupSuccess, setSignupSuccess] = useState(false);

  // Forgot Password state
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  // Onboarding Checklist States
  const [obCompanyName, setObCompanyName] = useState('');
  const [obMode, setObMode] = useState<'MOCK' | 'LIVE'>('MOCK');
  const [obApiKey, setObApiKey] = useState('');
  const [obInvites, setObInvites] = useState<string[]>(['']);
  const [obTier, setObTier] = useState<'starter' | 'growth' | 'enterprise'>('growth');
  const [onboardStep, setOnboardStep] = useState<1 | 2 | 3>(1);

  // Playground Identities for rapid evaluation
  const playgroundUsers = [
    { name: 'Alex Mercer (PLATFORM SUPERADMIN)', role: UserRole.SUPER_ADMIN, email: 'alex.admin@showtimepoolmechanics.com', token: 'token_super_admin' },
    { name: 'Marcus Sterling (WORKSPACE OWNER)', role: UserRole.WORKSPACE_OWNER, email: 'marcus.owner@showtimepoolmechanics.com', token: 'token_marcus' },
    { name: 'Sarah Chen (WORKSPACE ADMIN)', role: UserRole.ADMIN, email: 'sarah.chen@showtimepoolmechanics.com', token: 'token_sarah' },
    { name: 'Bobby Sales (SALES REPRESENTATIVE)', role: UserRole.SALES_REP, email: 'bobby.sales@showtimepoolmechanics.com', token: 'token_bobby' },
    { name: 'Rachel Read (READ ONLY REPORTING)', role: UserRole.READ_ONLY, email: 'rachel.read@showtimepoolmechanics.com', token: 'token_rachel' },
    { name: 'Vance Refrigeration (WORKSPACE B OWNER)', role: UserRole.WORKSPACE_OWNER, email: 'bob.vance@vancerefrigeration.com', token: 'token_bob' }
  ];

  // Load user session on startup
  const verifySession = async (activeToken: string) => {
    if (!activeToken) {
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/me', {
        headers: {
          'x-auth-token': activeToken
        }
      });

      if (response.ok) {
        const payload = await response.json();
        if (payload.status === 'success' && payload.session) {
          setSession(payload.session);
          setWorkspaces(payload.workspaces || []);
          if (payload.session.user && !payload.session.user.onboarded) {
            setPage('onboarding');
          }
        } else {
          // Server responded OK but explicitly rejected the token
          logout();
        }
      } else if (response.status === 401 || response.status === 403) {
        // Definitive auth rejection — token is invalid or revoked
        logout();
      }
      // 5xx / service errors are transient — do NOT logout.
      // The stored token may still be valid; let the user retry.
    } catch (err) {
      // Network error (fetch threw) — not an auth failure, keep stored token.
      console.warn('[verifySession] Network error, keeping session:', err);
    } finally {
      setLoading(false);
    }
  };

  // Wait for SSO to settle before verifying the session (prevents login-form flash)
  useEffect(() => {
    if (ghlSsoLoading) return;
    verifySession(token);
  }, [token, refreshTrigger, ghlSsoLoading]);

  // GHL Marketplace SSO — postMessage handshake (runs once on mount, iframe only)
  useEffect(() => {
    if (!isInIframe) return;

    let settled = false;
    const settle = () => { if (!settled) { settled = true; setGhlSsoLoading(false); } };
    const timeout = setTimeout(settle, 3000); // 3-second fallback to normal login

    const handler = async (event: MessageEvent) => {
      if (event.data?.message !== 'REQUEST_USER_DATA_RESPONSE') return;
      if (settled) return;
      clearTimeout(timeout);
      try {
        const res = await fetch('/api/ghl/sso', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ encryptedData: event.data.payload })
        });
        const data = await res.json();
        if (data.status === 'success' && data.token) {
          localStorage.setItem('saas_token', data.token);
          setToken(data.token);
        }
      } catch (err) {
        console.error('[GHL SSO]', err);
      } finally {
        settle();
      }
    };

    window.addEventListener('message', handler);
    window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*');

    return () => { window.removeEventListener('message', handler); clearTimeout(timeout); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const logout = () => {
    localStorage.removeItem('saas_token');
    setToken('');
    setSession(null);
    setWorkspaces([]);
    setPage('login');
  };

  const loginWithCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const payload = await response.json();
      if (response.ok && payload.status === 'success' && payload.session) {
        localStorage.setItem('saas_token', payload.session.token);
        setToken(payload.session.token);
        setSession(payload.session);
        setWorkspaces(payload.workspaces || []);
        
        if (payload.session.user && !payload.session.user.onboarded) {
          setPage('onboarding');
        } else {
          // Normal dashboard
        }
      } else {
        setAuthError(payload.error || 'Login rejected. Please check email criteria.');
      }
    } catch (err: any) {
      setAuthError(`Connection error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePlaygroundSign = async (userToken: string) => {
    setLoading(true);
    setAuthError(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ impersonateToken: userToken })
      });

      const payload = await response.json();
      if (response.ok && payload.status === 'success' && payload.session) {
        localStorage.setItem('saas_token', payload.session.token);
        setToken(payload.session.token);
        setSession(payload.session);
        setWorkspaces(payload.workspaces || []);
        
        if (payload.session.user && !payload.session.user.onboarded) {
          setPage('onboarding');
        } else {
          // Normal access
        }
      } else {
        setAuthError(payload.error || 'Impersonation failed.');
      }
    } catch (err: any) {
      setAuthError(`Impersonation error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setLoading(true);

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: signupName, email: signupEmail, password: signupPassword })
      });

      const payload = await response.json();
      if (response.ok && payload.status === 'success') {
        setSignupSuccess(true);
        // Switch to login pages with pre-filled details or login directly
        setTimeout(() => {
          localStorage.setItem('saas_token', payload.token);
          setToken(payload.token);
          setSignupSuccess(false);
          setPage('onboarding');
        }, 1500);
      } else {
        setAuthError(payload.error || 'Registration failed.');
      }
    } catch (err: any) {
      setAuthError(`Registration failure: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail) return;
    setForgotSent(true);
  };

  const switchWorkspace = async (workspaceId: string) => {
    try {
      const response = await fetch('/api/auth/switch-workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, workspaceId })
      });

      const payload = await response.json();
      if (response.ok && payload.status === 'success' && payload.session) {
        setSession(payload.session);
        setWorkspaces(payload.workspaces || []);
        setRefreshTrigger(p => p + 1);
      } else {
        alert(payload.error || 'Failed to switch tenant.');
      }
    } catch (err: any) {
      alert(`Switch workspace error: ${err.message}`);
    }
  };

  const handleCompleteOnboarding = async () => {
    setLoading(true);
    setAuthError(null);

    try {
      const response = await fetch('/api/auth/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          companyName: obCompanyName,
          ghlMode: obMode,
          apiKey: obApiKey
        })
      });

      const payload = await response.json();
      if (response.ok && payload.status === 'success' && payload.session) {
        setSession(payload.session);
        setWorkspaces(payload.workspaces || []);
        // Finished onboarding! Direct unlock
      } else {
        setAuthError(payload.error || 'Onboarding failed.');
      }
    } catch (err: any) {
      setAuthError(`Onboarding error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const triggerRefresh = () => {
    setRefreshTrigger(p => p + 1);
  };

  // GHL SSO handshake in progress — show connecting screen, never flash login form
  if (ghlSsoLoading) {
    return (
      <div className="min-h-screen bg-[#0b1424] flex flex-col items-center justify-center space-y-4">
        <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest">Connecting to GoHighLevel...</p>
      </div>
    );
  }

  // If loading session, show standard microspinner
  if (loading && !session) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center space-y-4">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
        <p className="text-xs text-slate-500 font-semibold uppercase tracking-widest">Initialising SaaS Core...</p>
      </div>
    );
  }

  // RENDER APP ONCE LOGGED IN & ONBOARDED
  if (session && session.user && session.user.onboarded) {
    // If workspace suspended, intercept with suspension page
    if (session.activeWorkspace?.suspended) {
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 text-slate-300">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl max-w-lg w-full p-8 text-center space-y-6 shadow-2xl relative">
            <span className="absolute top-4 right-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 font-mono text-[9px] font-black px-2 py-0.5 rounded tracking-widest">
              BLOCKED
            </span>
            <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-full flex items-center justify-center mx-auto shadow-inner">
              <PowerOff className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-white tracking-tight">SaaS Tenant Suspended</h2>
              <p className="text-slate-400 text-xs leading-relaxed">
                The workspace <b>{session.activeWorkspace?.name}</b> is suspended by the platform administrator. Access to tracking dashboards, GHL metrics pipeline, and marketing attribution models has been deactivated.
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg text-[10px] text-slate-500 font-mono text-left space-y-1">
              <div>tenant_status: ACTIVE_SUSPENSION</div>
              <div>tenant_id: {session.activeWorkspace?.id}</div>
              <div>operator_action: Contact helpdesk@showtimepools.com</div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
              {/* If user belongs to other workspaces, let them switch */}
              {workspaces.length > 1 ? (
                <div className="w-full space-y-2">
                  <span className="text-[10px] text-slate-400 font-bold block">Switch to a different workspace:</span>
                  <div className="grid grid-cols-1 gap-1.5">
                    {workspaces.filter(w => w.id !== session.activeWorkspaceId).map(w => (
                      <button
                        key={w.id}
                        onClick={() => switchWorkspace(w.id)}
                        className="w-full p-2 bg-slate-900 hover:bg-slate-850 text-xs border border-slate-800 rounded-lg text-slate-200 cursor-pointer text-center font-bold"
                      >
                        {w.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <button
                  onClick={logout}
                  className="w-full p-2.5 bg-slate-800 hover:bg-slate-700 text-xs border border-slate-700 rounded-lg text-slate-200 font-bold cursor-pointer"
                >
                  Return to Member Login
                </button>
              )}
            </div>

            {/* Quick switcher list in suspended screen for testing */}
            <div className="pt-4 border-t border-slate-850">
              <span className="text-[10px] text-slate-500 font-bold block mb-1.5 uppercase tracking-widest text-left">SaaS Evaluator Impersonation Bypass:</span>
              <div className="grid grid-cols-2 gap-1">
                {playgroundUsers.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => handlePlaygroundSign(p.token)}
                    className="p-1 px-1.5 bg-slate-900 hover:bg-[#0c4a6e] hover:text-white rounded text-[10px] text-left text-slate-400 truncate font-semibold border border-slate-850"
                  >
                    {p.role.replace('WORKSPACE_', '')}: {p.name.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>

          </div>
        </div>
      );
    }

    // Entitlement lock. The server is the authority — this only renders what it reported on
    // /api/auth/me. Super admins are exempt server-side, so their entitlement always permits
    // access and they never reach this branch even when viewing a lapsed workspace.
    //
    // Note this is NOT a logout: the session is valid, the workspace's entitlement is not.
    if (session.entitlement && !session.entitlement.hasAccess) {
      return (
        <AccessLockedScreen
          entitlement={session.entitlement}
          workspaceName={session.activeWorkspace?.name || 'This workspace'}
          onLogout={logout}
          onRetry={triggerRefresh}
        />
      );
    }

    return (
      <>
        {/* Render standard app cockpit */}
        {children({
          user: session.user,
          activeWorkspace: session.activeWorkspace,
          role: session.role,
          workspaces,
          token,
          logout,
          triggerRefresh,
          switchWorkspace,
          entitlement: session.entitlement ?? null
        })}

      </>
    );
  }

  // ONBOARDING WORKSPACE FLOW
  if (page === 'onboarding') {
    return (
      <div className="min-h-screen bg-[#F1F5F9] text-slate-800 flex items-center justify-center p-4 sm:p-6 font-sans">
        <div className="bg-white border border-slate-250 rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col">
          
          {/* Header */}
          <div className="bg-[#0b1424] text-white p-6 relative">
            <span className="absolute top-4 right-4 bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider">
              Step {onboardStep} of 3
            </span>
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="w-6 h-6 text-blue-500" />
              <h1 className="text-lg font-black tracking-tight uppercase">Workspace Onboarding Portal</h1>
            </div>
            <p className="text-slate-400 text-xs">Let's provision your secure multi-tenant reporting workspace in the general cloud database.</p>
          </div>

          <div className="p-6 sm:p-8 flex-1 space-y-6">
            
            {/* Steps Nav */}
            <div className="flex items-center gap-2 pb-4 border-b border-slate-100 text-xs font-bold text-slate-400">
              <span className={onboardStep === 1 ? 'text-blue-600' : 'text-slate-500'}>1. Business Profile</span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-300" />
              <span className={onboardStep === 2 ? 'text-blue-600' : 'text-slate-500'}>2. GHL Integration</span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-300" />
              <span className={onboardStep === 3 ? 'text-blue-600' : 'text-slate-500'}>3. Confirm & Deploy</span>
            </div>

            {authError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2 font-semibold">
                <AlertCircle className="w-4 h-4 text-rose-600" />
                <span>{authError}</span>
              </div>
            )}

            {/* STEP 1: BUSINESS PROFILE */}
            {onboardStep === 1 && (
              <div className="space-y-4">
                <h2 className="text-base font-black text-slate-900 uppercase tracking-tight flex items-center gap-1.5">
                  <Building className="w-5 h-5 text-blue-600" /> Configure Workspace Profile
                </h2>
                <div className="space-y-1">
                  <label className="text-[11px] font-black text-slate-500 uppercase tracking-wider block">Company name *</label>
                  <input
                    type="text"
                    required
                    placeholder="Enter your enterprise name e.g. Showtime Pools Center"
                    value={obCompanyName}
                    onChange={(e) => setObCompanyName(e.target.value)}
                    className="w-full text-xs p-3 bg-white border border-slate-205 rounded-xl outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-semibold"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-black text-slate-500 uppercase tracking-wider block">Company URL Slug</label>
                  <div className="flex">
                    <span className="p-3 text-xs bg-slate-50 border border-r-0 border-slate-205 rounded-l-xl text-slate-400 font-mono font-medium">https://showtime.report/</span>
                    <input
                      type="text"
                      className="w-full text-xs p-3 bg-slate-50 border border-slate-205 rounded-r-xl outline-none font-mono text-slate-500"
                      readOnly
                      value={obCompanyName.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'my-workspace'}
                    />
                  </div>
                </div>

                <div className="pt-4 flex justify-end">
                  <button
                    onClick={() => {
                      if (!obCompanyName) {
                        setAuthError('Please input a valid company company name before advancing.');
                        return;
                      }
                      setAuthError(null);
                      setOnboardStep(2);
                    }}
                    className="flex items-center gap-1.5 p-2.5 px-5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition shadow-md shadow-blue-500/10 cursor-pointer"
                  >
                    Setup Integration Parameters
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: GHL INTEGRATION SETUP */}
            {onboardStep === 2 && (
              <div className="space-y-4">
                <h2 className="text-base font-black text-slate-900 uppercase tracking-tight flex items-center gap-1.5">
                  <KeyRound className="w-5 h-5 text-blue-600" /> GoHighLevel Connection Setup
                </h2>
                <p className="text-slate-500 text-xs leading-relaxed">
                  Choose if you want to pull data from a live GoHighLevel sub-account or build matching dashboards from beautifully synchronized offline simulated data.
                </p>

                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setObMode('MOCK')}
                    type="button"
                    className={`p-4 border text-left rounded-xl transition cursor-pointer flex flex-col justify-between ${
                      obMode === 'MOCK'
                        ? 'bg-blue-50/50 border-blue-550 ring-1 ring-blue-500'
                        : 'bg-white border-slate-205 hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <span className="text-xs font-black text-slate-900 block uppercase">Sandbox mode (Recommended)</span>
                      <p className="text-[10px] text-slate-500 mt-1 leading-normal font-semibold">
                        Pre-populates the workspace with a rich, fully populated historical pipeline of leads, booked appointments, and attribution sources. Perfect for evaluation.
                      </p>
                    </div>
                  </button>

                  <button
                    onClick={() => setObMode('LIVE')}
                    type="button"
                    className={`p-4 border text-left rounded-xl transition cursor-pointer flex flex-col justify-between ${
                      obMode === 'LIVE'
                        ? 'bg-blue-50/50 border-blue-550 ring-1 ring-blue-500'
                        : 'bg-white border-slate-205 hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <span className="text-xs font-black text-slate-900 block uppercase">Connect Live GHL V2 API</span>
                      <p className="text-[10px] text-slate-500 mt-1 leading-normal font-semibold">
                        Securely hooks into your live GoHighLevel Sub-Account location contacts, calendars, and opportunity cards to build reports.
                      </p>
                    </div>
                  </button>
                </div>

                {obMode === 'LIVE' && (
                  <div className="p-4 bg-slate-50 border border-slate-205 rounded-xl space-y-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">GHL Private Api Key / Access Token</label>
                      <input
                        type="password"
                        placeholder="Enter your private sub-account key"
                        value={obApiKey}
                        onChange={(e) => setObApiKey(e.target.value)}
                        className="w-full text-xs p-3 bg-white border border-slate-200 rounded-xl outline-none font-semibold"
                      />
                    </div>
                  </div>
                )}

                <div className="pt-4 flex justify-between">
                  <button
                    onClick={() => setOnboardStep(1)}
                    className="p-2.5 bg-white border border-slate-250 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => {
                      if (obMode === 'LIVE' && !obApiKey) {
                        setAuthError('You must enter a Private GHL Sub-Account token when selecting Live mode.');
                        return;
                      }
                      setAuthError(null);
                      setOnboardStep(3);
                    }}
                    className="flex items-center gap-1.5 p-2.5 px-5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold cursor-pointer transition shadow-md"
                  >
                    Review Deployment Steps
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: SUBSCRIPTION CHOOSE & CHECKLIST DEPLOYMENT */}
            {onboardStep === 3 && (
              <div className="space-y-5">
                <h2 className="text-base font-black text-slate-900 uppercase tracking-tight flex items-center gap-1.5">
                  <FileCheck className="w-5 h-5 text-blue-600" /> Review System Initialization
                </h2>

                {/* Subscriptions tier choosing */}
                <div className="space-y-2">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">Choose SaaS tier (Mock checkout)</span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      { id: 'starter', name: 'Starter Plan', cost: '$99/mo', value: '1 Active GHL Subaccount' },
                      { id: 'growth', name: 'Growth Scale', cost: '$249/mo', value: '3 Active GHL Subaccounts' },
                      { id: 'enterprise', name: 'Elite Enterprise', cost: '$499/mo', value: 'Unlimited Subaccounts' }
                    ].map((tier) => (
                      <button
                        key={tier.id}
                        onClick={() => setObTier(tier.id as any)}
                        type="button"
                        className={`p-3 border text-left rounded-xl transition cursor-pointer flex flex-col justify-between h-28 ${
                          obTier === tier.id
                            ? 'bg-blue-50/50 border-blue-550 ring-1 ring-blue-500'
                            : 'bg-white border-slate-205 hover:bg-slate-50'
                        }`}
                      >
                        <div>
                          <span className="text-[10px] font-black text-slate-500 block uppercase">{tier.name}</span>
                          <span className="text-sm font-black text-slate-900 mt-1 block">{tier.cost}</span>
                        </div>
                        <span className="text-[9px] text-slate-400 font-semibold leading-normal mt-2 block">{tier.value}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Secure Workspace Checklist */}
                <div className="p-4 bg-slate-900 text-slate-300 rounded-xl space-y-2.5 font-mono text-[10px]">
                  <div className="text-[11px] font-bold text-slate-100 flex items-center justify-between pb-1 text-xs font-sans tracking-wide">
                    <span>INITIALIZATION CHECKS & GUARANTEES</span>
                    <span className="text-blue-400 font-normal">[AUTO_GHL_V2]</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Multi-tenant data isolation rules configured on /api/reporting/*</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Pre-launch mock database sandbox registry initialized</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Cryptographic member permission checks map is active</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Real-time platform action Audit Logging stream allocated</span>
                  </div>
                </div>

                <div className="pt-4 flex justify-between">
                  <button
                    onClick={() => setOnboardStep(2)}
                    className="p-2.5 bg-white border border-slate-250 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleCompleteOnboarding}
                    disabled={loading}
                    className="flex items-center gap-1.5 p-2.5 px-6 bg-[#0F172A] hover:bg-slate-900 text-white rounded-lg text-xs font-bold cursor-pointer transition shadow-xl"
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Deploying Workspace...
                      </>
                    ) : (
                      <>
                        Initialize Workspace
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

          </div>

          {/* Quick Impersonation Shortcuts block to easily bypass onboarding */}
          <div className="bg-slate-50 px-6 py-4 border-t border-slate-205 flex items-center justify-between text-[11px] font-bold">
            <span className="text-slate-500">Developer Evaluation Bypass:</span>
            <div className="flex gap-1.5">
              <button
                onClick={() => handlePlaygroundSign('token_super_admin')}
                className="p-1 px-2.5 bg-white hover:bg-slate-100 border border-slate-205 rounded font-black text-[10px] text-slate-700 cursor-pointer"
              >
                Skip as Global Superadmin
              </button>
              <button
                onClick={() => handlePlaygroundSign('token_marcus')}
                className="p-1 px-2.5 bg-white hover:bg-slate-100 border border-slate-205 rounded font-black text-[10px] text-slate-700 cursor-pointer"
              >
                Skip as Workspace Owner
              </button>
            </div>
          </div>

        </div>
      </div>
    );
  }

  // CORE AUTHENTICATION VIEW PAGES: LOGIN, SIGNUP, FORGOT PASSWORD
  return (
    <div className="min-h-screen bg-[#F1F5F9] text-slate-800 flex flex-col justify-between py-12 px-4 sm:px-6 lg:px-8 font-sans">
      
      {/* Upper Brand Badge */}
      <div className="flex flex-col items-center justify-center shrink-0">
        <div className="flex items-center justify-center bg-[#0b1424] text-white p-3.5 rounded-2xl shadow-xl border border-slate-800">
          <Building2 className="w-7 h-7 text-blue-500" />
        </div>
        <h1 className="mt-4 text-xl font-black text-[#0b1424] uppercase tracking-tight">Showtime Command Suite</h1>
        <p className="text-xs text-slate-500 mt-1 font-semibold uppercase tracking-widest pl-1">Enterprise GHL V2 Reporting Portal</p>
      </div>

      <div className="my-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white border border-slate-250 py-8 px-6 shadow-xl rounded-2xl space-y-6 relative overflow-hidden">
          
          {/* Subtle upper slide accent */}
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-blue-500 via-sky-500 to-indigo-500" />

          {authError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2 font-semibold">
              <AlertCircle className="w-4.5 h-4.5 text-rose-600 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          {/* ==================================== */}
          {/* LOGIN PAGE */}
          {/* ==================================== */}
          {page === 'login' && (
            <form onSubmit={loginWithCredentials} className="space-y-4">
              <div className="text-center space-y-1">
                <h2 className="text-lg font-black text-slate-900 uppercase">Tenant Auth Gate</h2>
                <p className="text-xs text-slate-500 leading-normal pl-1">Input GHL command center credentials to view reports.</p>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">Authorized login email</label>
                <div className="relative">
                  <input
                    type="email"
                    required
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full text-xs p-3 pl-9 bg-white border border-slate-205 rounded-xl outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-semibold"
                  />
                  <Mail className="absolute left-3 top-3.5 w-4 h-4 text-slate-400" />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Secret account key</label>
                  <button
                    type="button"
                    onClick={() => setPage('forgot')}
                    className="text-[10px] text-blue-600 hover:underline font-bold cursor-pointer"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    type="password"
                    placeholder="••••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full text-xs p-3 pl-9 bg-white border border-slate-205 rounded-xl outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                  <Lock className="absolute left-3 top-3.5 w-4 h-4 text-slate-400" />
                </div>
              </div>

              <div className="flex items-center justify-between text-xs font-semibold select-none pt-1">
                <label className="flex items-center gap-2 text-slate-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
                  />
                  Keep me authorized
                </label>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full p-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-md cursor-pointer disabled:opacity-50"
              >
                {loading ? 'Initializing Session Securely...' : 'Unlock Analytics Dashboard'}
              </button>

              <div className="text-center pt-2">
                <span className="text-[10px] text-slate-400 font-bold block">
                  Don't have an enterprise workspace?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setAuthError(null);
                      setPage('signup');
                    }}
                    className="text-blue-600 hover:underline text-[10px] font-black cursor-pointer"
                  >
                    Register new customer
                  </button>
                </span>
              </div>
            </form>
          )}

          {/* ==================================== */}
          {/* SIGNUP PAGE */}
          {/* ==================================== */}
          {page === 'signup' && (
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="text-center space-y-1">
                <h2 className="text-lg font-black text-slate-900 uppercase">Register Workspace</h2>
                <p className="text-xs text-slate-500 leading-normal pl-1">Deploy free 14-day tracking and reporting trial.</p>
              </div>

              {signupSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-250 text-emerald-800 text-xs rounded-xl flex items-center gap-2 font-medium">
                  <CheckCircle className="w-4.5 h-4.5 text-emerald-600" />
                  <span>Account generated successfully! Initiating onboarding flow...</span>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">Administrator full name</label>
                <input
                  type="text"
                  required
                  placeholder="James Sterling"
                  value={signupName}
                  onChange={(e) => setSignupName(e.target.value)}
                  className="w-full text-xs p-3 bg-white border border-slate-205 rounded-xl outline-none focus:border-blue-500 font-semibold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">Business email address</label>
                <div className="relative">
                  <input
                    type="email"
                    required
                    placeholder="owner@showtimepools.com"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    className="w-full text-xs p-3 pl-9 bg-white border border-slate-205 rounded-xl outline-none focus:border-blue-500 font-semibold"
                  />
                  <Mail className="absolute left-3 top-3.5 w-4 h-4 text-slate-400" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">Create password</label>
                <div className="relative">
                  <input
                    type="password"
                    required
                    minLength={6}
                    placeholder="••••••••••••"
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    className="w-full text-xs p-3 pl-9 bg-white border border-slate-205 rounded-xl outline-none focus:border-blue-500 font-semibold"
                  />
                  <Lock className="absolute left-3 top-3.5 w-4 h-4 text-slate-400" />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full p-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-md cursor-pointer disabled:opacity-50"
              >
                {loading ? 'Deploying Nodes...' : 'Generate New Workspace'}
              </button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setAuthError(null);
                    setPage('login');
                  }}
                  className="text-slate-500 hover:text-slate-800 text-[10px] font-bold cursor-pointer hover:underline"
                >
                  Return to standard login gate
                </button>
              </div>
            </form>
          )}

          {/* ==================================== */}
          {/* FORGOT PASSWORD PAGE */}
          {/* ==================================== */}
          {page === 'forgot' && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="text-center space-y-1">
                <h2 className="text-lg font-black text-slate-900 uppercase">Recover Credentials</h2>
                <p className="text-xs text-slate-500 leading-normal pl-1">We will transmit a simulated security sync link.</p>
              </div>

              {forgotSent ? (
                <div className="p-4 bg-emerald-50 border border-emerald-150 text-emerald-800 text-xs rounded-xl space-y-2">
                  <div className="font-bold flex items-center gap-1">
                    <CheckCircle className="w-4 h-4 text-emerald-600 animate-bounce" />
                    Simulated Recovery Sent!
                  </div>
                  <p className="text-[10px] text-slate-600 leading-relaxed font-semibold">
                    An email containing recovery details has been logged in memory. For evaluators, simply switch identity roles using our dropdown helper below.
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">Authorized target email</label>
                  <div className="relative">
                    <input
                      type="email"
                      required
                      placeholder="owner@showtimepools.com"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      className="w-full text-xs p-3 pl-9 bg-white border border-slate-205 rounded-xl outline-none focus:border-blue-500 font-semibold"
                    />
                    <Mail className="absolute left-3 top-3.5 w-4 h-4 text-slate-400" />
                  </div>
                </div>
              )}

              {!forgotSent && (
                <button
                  type="submit"
                  className="w-full p-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-md cursor-pointer"
                >
                  Retrieve System Key
                </button>
              )}

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setForgotSent(false);
                    setAuthError(null);
                    setPage('login');
                  }}
                  className="text-slate-500 hover:text-slate-800 text-[10px] font-mono font-bold cursor-pointer hover:underline"
                >
                  Return to Authenticator gate
                </button>
              </div>
            </form>
          )}


        </div>
      </div>

      {/* Footer copyright */}
      <span className="text-[10px] tracking-wide text-slate-400 text-center shrink-0 font-medium">
        Showtime Command Suite Platform v2.8 • Secure Multi-Tenant Architecture Walled Off On Port 3000
      </span>

    </div>
  );
}
