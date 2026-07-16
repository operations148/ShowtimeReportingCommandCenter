import React, { useState, useEffect, useCallback } from 'react';
import {
  Plug, CheckCircle2, AlertTriangle, RefreshCw, Link2, Unlink, ExternalLink,
  BarChart3, Megaphone, Building2, Search, Webhook, ShieldCheck, KeyRound, X
} from 'lucide-react';

/**
 * Integrations Center — one surface for every per-workspace data connection.
 *
 * Each provider's credentials are stored per workspace (OAuth tokens or private keys,
 * encrypted at rest), never in Vercel environment variables. Vercel holds only
 * platform-level configuration (OAuth client IDs, the encryption key). This view is the
 * consolidation the brief asks for: connect / test / reconnect / replace / disconnect for
 * every provider in one place, rather than scattered across the Marketing dashboard and
 * the GHL settings tab.
 *
 * It calls only pre-existing endpoints; nothing here is a new backend contract.
 */

interface IntegrationsCenterViewProps {
  sessionToken: string;
  /** Navigate to another top-level tab (used to hand GHL off to its dedicated settings). */
  onNavigate?: (tab: string) => void;
}

type Method = 'OAuth 2.0' | 'Private Token' | 'Access Token' | 'Webhook Secret';

interface StatusRow {
  provider: string;
  status: string;
  propertyId?: string | null;
  propertyName?: string | null;
  connectedAt?: string | null;
}

export default function IntegrationsCenterView({ sessionToken, onNavigate }: IntegrationsCenterViewProps) {
  const [statuses, setStatuses] = useState<StatusRow[]>([]);
  const [ghlConnected, setGhlConnected] = useState<boolean>(false);
  const [ghlLocation, setGhlLocation] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Meta connect form
  const [metaFormOpen, setMetaFormOpen] = useState(false);
  const [metaToken, setMetaToken] = useState('');
  const [metaAccount, setMetaAccount] = useState('');

  const headers = { 'x-auth-token': sessionToken };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, ghlRes] = await Promise.all([
        fetch('/api/integrations/status', { headers, cache: 'no-store' }),
        fetch('/api/ghl/config', { headers, cache: 'no-store' })
      ]);
      if (statusRes.ok) {
        const p = await statusRes.json();
        if (p.status === 'success') setStatuses(p.integrations || []);
      }
      if (ghlRes.ok) {
        const g = await ghlRes.json();
        // Shape tolerated defensively — this endpoint returns config in a few shapes
        // depending on role and connection state.
        const conn = g.connection || g.config || {};
        const connected = (conn.status === 'CONNECTED') || !!conn.locationId || g.connected === true;
        setGhlConnected(!!connected);
        setGhlLocation(conn.locationId || g.locationId || null);
      }
    } catch (e: any) {
      setError(`Could not load integration status: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => { load(); }, [load]);

  const flash = (msg: string) => { setSuccess(msg); setTimeout(() => setSuccess(null), 4000); };

  const find = (provider: string) => statuses.find(s => s.provider === provider);
  const isConnected = (provider: string) => find(provider)?.status === 'CONNECTED';

  // ---- GA4: OAuth popup ----
  const connectGA4 = async () => {
    setBusy('google_analytics'); setError(null);
    try {
      const res = await fetch('/api/integrations/google/auth', { headers });
      const p = await res.json();
      if (!res.ok || !p.authUrl) throw new Error(p.error || 'Could not start Google authorization.');

      const popup = window.open(p.authUrl, 'ga4_oauth', 'width=520,height=640');
      // The callback page posts a message back to this window, then closes itself.
      const onMsg = (e: MessageEvent) => {
        if (e.data?.type === 'ga4_connected') {
          window.removeEventListener('message', onMsg);
          flash('Google Analytics connected. Select a property to begin reporting.');
          setBusy(null);
          load();
        } else if (e.data?.type === 'ga4_error') {
          window.removeEventListener('message', onMsg);
          setError(`Google authorization failed: ${e.data.error || 'unknown error'}`);
          setBusy(null);
        }
      };
      window.addEventListener('message', onMsg);

      // If the user closes the popup without finishing, stop showing a spinner forever.
      const poll = setInterval(() => {
        if (popup?.closed) {
          clearInterval(poll);
          window.removeEventListener('message', onMsg);
          setBusy(b => (b === 'google_analytics' ? null : b));
          load();
        }
      }, 800);
    } catch (e: any) {
      setError(e.message);
      setBusy(null);
    }
  };

  const disconnectGA4 = async () => {
    setBusy('google_analytics'); setError(null);
    try {
      const res = await fetch('/api/integrations/google', { method: 'DELETE', headers });
      const p = await res.json();
      if (!res.ok || p.status !== 'success') throw new Error(p.error || 'Disconnect failed.');
      flash('Google Analytics disconnected.');
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };

  // ---- Meta Ads: token + ad account ----
  const connectMeta = async () => {
    if (!metaToken.trim() || !metaAccount.trim()) { setError('Access token and ad account ID are both required.'); return; }
    setBusy('meta_ads'); setError(null);
    try {
      const res = await fetch('/api/integrations/meta/connect', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: metaToken.trim(), adAccountId: metaAccount.trim() })
      });
      const p = await res.json();
      if (!res.ok || p.status !== 'success') throw new Error(p.error || 'Meta connection failed.');
      flash(`Meta Ads connected${p.adAccountName ? ` — ${p.adAccountName}` : ''}.`);
      setMetaFormOpen(false); setMetaToken(''); setMetaAccount('');
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };

  const disconnectMeta = async () => {
    setBusy('meta_ads'); setError(null);
    try {
      const res = await fetch('/api/integrations/meta', { method: 'DELETE', headers });
      const p = await res.json();
      if (!res.ok || p.status !== 'success') throw new Error(p.error || 'Disconnect failed.');
      flash('Meta Ads disconnected.');
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-6" id="integrations-center-view">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] bg-blue-50 border border-blue-200 text-blue-700 px-2.5 py-0.5 rounded-full font-black uppercase tracking-wider block w-fit mb-1.5">
            Workspace Data Sources
          </span>
          <h2 className="text-xl font-bold tracking-tight text-[#0F172A] mb-1">Integrations Center</h2>
          <p className="text-slate-500 text-xs font-semibold max-w-xl">
            Connect this workspace's own accounts. Credentials are stored encrypted per workspace —
            never in shared server configuration — and can be tested, replaced or disconnected here at any time.
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

      {loading ? (
        <div className="py-16 text-center space-y-2">
          <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto" />
          <p className="text-xs text-slate-500">Reading connection status…</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* GoHighLevel */}
          <ProviderCard
            icon={<Building2 className="w-5 h-5" />}
            name="GoHighLevel"
            method="Private Token"
            description="Contacts, opportunities, calendars and invoices — the core reporting pipeline."
            connected={ghlConnected}
            detail={ghlConnected ? (ghlLocation ? `Location ${ghlLocation}` : 'Connected') : undefined}
          >
            <button
              onClick={() => onNavigate?.('ghl-settings')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold transition-colors cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5" />
              {ghlConnected ? 'Manage connection' : 'Connect'}
            </button>
          </ProviderCard>

          {/* Google Analytics 4 */}
          <ProviderCard
            icon={<BarChart3 className="w-5 h-5" />}
            name="Google Analytics 4"
            method="OAuth 2.0"
            description="Website sessions, traffic sources and conversions for marketing attribution."
            connected={isConnected('google_analytics')}
            detail={find('google_analytics')?.propertyName
              ? `Property: ${find('google_analytics')!.propertyName}`
              : (isConnected('google_analytics') ? 'Connected — select a property' : undefined)}
          >
            {isConnected('google_analytics') ? (
              <div className="flex gap-2">
                <button
                  onClick={connectGA4}
                  disabled={busy === 'google_analytics'}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-250 hover:bg-slate-50 text-slate-700 rounded-lg text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${busy === 'google_analytics' ? 'animate-spin' : ''}`} />
                  Reconnect
                </button>
                <button
                  onClick={disconnectGA4}
                  disabled={busy === 'google_analytics'}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 rounded-lg text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Unlink className="w-3.5 h-3.5" /> Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={connectGA4}
                disabled={busy === 'google_analytics'}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50"
              >
                <Link2 className="w-3.5 h-3.5" />
                {busy === 'google_analytics' ? 'Authorizing…' : 'Connect with Google'}
              </button>
            )}
          </ProviderCard>

          {/* Meta Ads */}
          <ProviderCard
            icon={<Megaphone className="w-5 h-5" />}
            name="Meta Ads"
            method="Access Token"
            description="Ad spend, reach and results from a Meta (Facebook/Instagram) ad account."
            connected={isConnected('meta_ads')}
            detail={find('meta_ads')?.propertyName
              ? `Account: ${find('meta_ads')!.propertyName}`
              : (isConnected('meta_ads') ? 'Connected' : undefined)}
          >
            {isConnected('meta_ads') ? (
              <div className="flex gap-2">
                <button
                  onClick={() => setMetaFormOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-250 hover:bg-slate-50 text-slate-700 rounded-lg text-[11px] font-bold transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Replace token
                </button>
                <button
                  onClick={disconnectMeta}
                  disabled={busy === 'meta_ads'}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 rounded-lg text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Unlink className="w-3.5 h-3.5" /> Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={() => setMetaFormOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold transition-colors cursor-pointer"
              >
                <Link2 className="w-3.5 h-3.5" /> Connect
              </button>
            )}
          </ProviderCard>

          {/* Google Ads — recognised, not yet available */}
          <ProviderCard
            icon={<Search className="w-5 h-5" />}
            name="Google Ads"
            method="OAuth 2.0"
            description="Search and display campaign performance."
            connected={false}
            comingSoon
          />

          {/* Custom Webhooks — recognised, not yet available */}
          <ProviderCard
            icon={<Webhook className="w-5 h-5" />}
            name="Custom Webhooks"
            method="Webhook Secret"
            description="Push events from other systems into this workspace's reporting."
            connected={false}
            comingSoon
          />
        </div>
      )}

      {/* Security note */}
      <div className="bg-blue-50 border border-blue-200 border-dashed rounded-xl p-4 text-xs text-blue-800 flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
        <p className="leading-relaxed font-medium">
          Each connection uses this workspace's own credentials, encrypted at rest and isolated from every
          other workspace. Connecting or replacing a credential here never requires a server redeploy or
          environment-variable change.
        </p>
      </div>

      {/* Meta connect / replace modal */}
      {metaFormOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setMetaFormOpen(false)}>
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="bg-[#0b1424] text-white p-5 rounded-t-2xl flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Megaphone className="w-5 h-5 text-blue-400" />
                <h2 className="text-sm font-black uppercase tracking-tight">Connect Meta Ads</h2>
              </div>
              <button onClick={() => setMetaFormOpen(false)} aria-label="Close" className="text-slate-400 hover:text-white transition-colors cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">Access token</label>
                <input
                  type="password" value={metaToken} onChange={(e) => setMetaToken(e.target.value)}
                  placeholder="Meta system-user or long-lived access token"
                  className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-semibold"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">Ad account ID</label>
                <input
                  type="text" value={metaAccount} onChange={(e) => setMetaAccount(e.target.value)}
                  placeholder="e.g. 123456789 or act_123456789"
                  className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-semibold font-mono"
                />
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                The token needs <b>ads_read</b> permission on this ad account. It is validated against the Meta API
                before saving, and stored encrypted.
              </p>
              <button
                onClick={connectMeta}
                disabled={busy === 'meta_ads'}
                className="w-full flex items-center justify-center gap-1.5 p-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
              >
                <Link2 className="w-3.5 h-3.5" />
                {busy === 'meta_ads' ? 'Validating…' : 'Validate & Connect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- provider card ----

interface ProviderCardProps {
  icon: React.ReactNode;
  name: string;
  method: Method;
  description: string;
  connected: boolean;
  detail?: string;
  comingSoon?: boolean;
  children?: React.ReactNode;
}

function ProviderCard({ icon, name, method, description, connected, detail, comingSoon, children }: ProviderCardProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            connected ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-slate-100 text-slate-500 border border-slate-200'
          }`}>
            {icon}
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-900">{name}</h3>
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <Plug className="w-2.5 h-2.5" /> {method}
            </span>
          </div>
        </div>
        {comingSoon ? (
          <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border bg-slate-50 text-slate-400 border-slate-200">
            Coming soon
          </span>
        ) : (
          <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${
            connected ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'
          }`}>
            <span className={`w-1 h-1 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            {connected ? 'Connected' : 'Not connected'}
          </span>
        )}
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed">{description}</p>

      {detail && (
        <p className="text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-mono">
          {detail}
        </p>
      )}

      {!comingSoon && children && <div className="pt-1">{children}</div>}
      {comingSoon && (
        <p className="text-[10px] text-slate-400 flex items-center gap-1 pt-1">
          <ExternalLink className="w-3 h-3" /> Recognised provider — activation planned in a future release.
        </p>
      )}
    </div>
  );
}
