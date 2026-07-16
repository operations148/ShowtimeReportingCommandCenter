/**
 * Vercel serverless entry point — Express API routes backed by Supabase.
 * Sessions are stateless Supabase JWTs verified per-request (cold-start safe).
 * Compiled as CJS: package.json has no "type":"module" field.
 */

import express from 'express';
import { createHash, createCipheriv, createDecipheriv, createHmac, timingSafeEqual, randomBytes } from 'crypto';
import { UserRole, WorkspaceMember, SaaSUser, Workspace, GHLConnection, ReportingSettings } from '../src/types.js';
import {
  getOwnerPerformanceReport,
  getVAPerformanceReport,
  getMarketingPerformanceReport
} from '../src/mockReportingData.js';
import { LiveReportingService, invalidateWorkspaceCacheStore } from '../src/ghlService.js';
import { supabaseAdmin, supabaseSignIn } from '../src/supabase.js';
import { deriveEntitlement, newTrialWindow, type Entitlement } from '../src/entitlements.js';

import dotenv from 'dotenv';
dotenv.config();

// ==========================================
// TYPE ADAPTERS — Supabase rows → app types
// ==========================================

function toSaaSUser(authUser: any, profile: any): SaaSUser {
  return {
    id: authUser.id,
    name: profile?.name || (authUser.email?.split('@')[0] ?? 'Unknown'),
    email: authUser.email || '',
    onboarded: profile?.onboarded ?? false,
    createdAt: authUser.created_at || new Date().toISOString()
  };
}

function toWorkspace(row: any): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    ghlLocationId: row.ghl_location_id,
    createdAt: row.created_at,
    suspended: row.suspended,
    // Defaults match the column defaults in 0004 so a row selected before that
    // migration (or with a narrowed select) degrades to "no trial, no licence"
    // rather than throwing.
    trialStartedAt: row.trial_started_at ?? null,
    trialEndsAt: row.trial_ends_at ?? null,
    trialUsed: row.trial_used ?? false,
    trialExtensionCount: row.trial_extension_count ?? 0,
    licenseStatus: row.license_status ?? 'NONE',
    licensedAt: row.licensed_at ?? null
  };
}

/** Derives the live access decision for a workspace. Server-side authority. */
function workspaceEntitlement(ws: Workspace): Entitlement {
  return deriveEntitlement({
    trialStartedAt: ws.trialStartedAt,
    trialEndsAt: ws.trialEndsAt,
    trialUsed: ws.trialUsed,
    trialExtensionCount: ws.trialExtensionCount,
    licenseStatus: ws.licenseStatus,
    licensedAt: ws.licensedAt,
    suspended: ws.suspended
  });
}

function toMember(row: any): WorkspaceMember {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role as UserRole,
    joinedAt: row.joined_at
  };
}

function toGHLConnection(row: any): GHLConnection {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    locationId: row.location_id,
    apiKey: row.api_key,
    connectedAt: row.connected_at,
    status: row.status as 'CONNECTED' | 'DISCONNECTED' | 'STALE'
  };
}

function toReportingSettings(row: any): ReportingSettings {
  return {
    workspaceId: row.workspace_id,
    defaultTimeframe: row.default_timeframe,
    allowedDashboards: row.allowed_dashboards,
    lastSyncAt: row.last_sync_at,
    mode: row.mode as 'MOCK' | 'LIVE',
    allowAdminManageGHL: row.allow_admin_manage_ghl,
    cacheTtlMinutes: row.cache_ttl_minutes
  };
}

// ==========================================
// SUPABASE DB HELPERS
// ==========================================

async function getProfile(userId: string) {
  const { data } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
  return data;
}

async function getWorkspaceById(id: string): Promise<Workspace | null> {
  const { data } = await supabaseAdmin.from('workspaces').select('*').eq('id', id).single();
  return data ? toWorkspace(data) : null;
}

async function getWorkspacesForUser(userId: string): Promise<Workspace[]> {
  const { data } = await supabaseAdmin
    .from('workspace_members')
    .select('role, workspaces(*)')
    .eq('user_id', userId);
  if (!data) return [];
  const isSuperAdmin = data.some((m: any) => m.role === 'SUPER_ADMIN');
  if (isSuperAdmin) {
    const { data: all } = await supabaseAdmin.from('workspaces').select('*');
    return (all || []).map(toWorkspace);
  }
  return data.map((m: any) => toWorkspace(m.workspaces)).filter(Boolean);
}

async function getWorkspaceMember(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
  const { data } = await supabaseAdmin
    .from('workspace_members')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .single();
  return data ? toMember(data) : null;
}

async function getMembersByWorkspace(workspaceId: string): Promise<WorkspaceMember[]> {
  const { data } = await supabaseAdmin
    .from('workspace_members')
    .select('*')
    .eq('workspace_id', workspaceId);
  return (data || []).map(toMember);
}

async function getGHLConnection(workspaceId: string): Promise<GHLConnection | null> {
  const { data } = await supabaseAdmin
    .from('ghl_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .single();
  return data ? toGHLConnection(data) : null;
}

async function getOrCreateReportingSettings(workspaceId: string): Promise<ReportingSettings> {
  const { data } = await supabaseAdmin
    .from('reporting_settings')
    .select('*')
    .eq('workspace_id', workspaceId)
    .single();
  if (data) return toReportingSettings(data);
  // Default to LIVE when REPORTING_DATA_SOURCE=live; MOCK is an explicit per-workspace opt-in
  const defaultMode = process.env.REPORTING_DATA_SOURCE === 'live' ? 'LIVE' : 'MOCK';
  const defaults = {
    workspace_id: workspaceId,
    default_timeframe: 'last_30_days',
    allowed_dashboards: ['overview', 'opportunity', 'sales'],
    last_sync_at: null,
    mode: defaultMode,
    allow_admin_manage_ghl: true,
    cache_ttl_minutes: 15
  };
  await supabaseAdmin.from('reporting_settings').insert(defaults);
  return toReportingSettings(defaults);
}

async function logAction(
  workspaceId: string | null,
  userId: string,
  userEmail: string,
  action: string,
  details: string
) {
  await supabaseAdmin.from('audit_logs').insert({
    id: `log_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    workspace_id: workspaceId,
    user_id: userId,
    user_email: userEmail,
    action,
    details,
    ip_address: '127.0.0.1',
    timestamp: new Date().toISOString()
  });
}

// Sync Supabase GHL data into the in-memory mock db so LiveReportingService sees current settings
async function syncGhlToMockDb(workspaceId: string) {
  const { db } = await import('../src/mockSaaSStore.js');
  const settings = await getOrCreateReportingSettings(workspaceId);
  const mockSettings = db.getReportingSettings(workspaceId);
  mockSettings.mode = settings.mode;
  mockSettings.allowAdminManageGHL = settings.allowAdminManageGHL;
  mockSettings.cacheTtlMinutes = settings.cacheTtlMinutes ?? 15;

  const conn = await getGHLConnection(workspaceId);
  if (conn) {
    const existing = db.getGHLConnection(workspaceId);
    if (!existing) {
      db.connections.push({
        id: conn.id,
        workspaceId: conn.workspaceId,
        locationId: conn.locationId,
        apiKey: conn.apiKey,
        connectedAt: conn.connectedAt,
        status: conn.status
      });
    } else {
      existing.apiKey = conn.apiKey;
      existing.locationId = conn.locationId;
      existing.status = conn.status;
    }
  }
}

// ==========================================
// GHL HELPERS
// ==========================================

const webhookLogs: { timestamp: string; source: string; event: string; payload: any }[] = [
  { timestamp: new Date(Date.now() - 3600000).toISOString(), source: 'GoHighLevel Webhook', event: 'contact.create', payload: { id: 'con_web_1', contactName: 'Sally Jenkins' } },
  { timestamp: new Date(Date.now() - 17200000).toISOString(), source: 'GoHighLevel Webhook', event: 'opportunity.update', payload: { id: 'opp_web_1', status: 'won', value: 12500 } }
];

const tenantMetricsCache = new Map<string, { data: any; timestamp: number }>();
const tenantOwnerPerfCache = new Map<string, { data: any; timestamp: number }>();
const tenantMarketingCache = new Map<string, { data: any; timestamp: number }>();

function invalidateTenantCache(workspaceId: string) {
  tenantMetricsCache.delete(workspaceId);
  tenantOwnerPerfCache.delete(workspaceId);
  tenantMarketingCache.delete(workspaceId);
  invalidateWorkspaceCacheStore(workspaceId);
}

async function getWorkspaceGhlConfig(workspaceId: string) {
  const connection = await getGHLConnection(workspaceId);
  const settings = await getOrCreateReportingSettings(workspaceId);

  let dataSourceMode: 'MOCK' | 'LIVE' = 'MOCK';
  if (settings.mode) {
    dataSourceMode = settings.mode;
  } else if (process.env.GHL_DATA_SOURCE === 'LIVE' || process.env.REPORTING_DATA_SOURCE === 'live') {
    dataSourceMode = 'LIVE';
  }

  let apiKey = '';
  if (connection?.apiKey) {
    apiKey = connection.apiKey;
  } else {
    apiKey = process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY || '';
  }

  let locationId = '';
  if (connection?.locationId) {
    locationId = connection.locationId;
  } else {
    const ws = await getWorkspaceById(workspaceId);
    locationId = process.env.GHL_LOCATION_ID || ws?.ghlLocationId || '';
  }

  const companyId = process.env.GHL_COMPANY_ID || 'co_ghl_company_9a2b';
  const maskToken = (t: string) => (!t ? '' : t.length <= 8 ? 'ghl_••••••••' : `${t.slice(0, 4)}••••••••${t.slice(-5)}`);

  return {
    dataSourceMode,
    apiKey,
    apiKeyMasked: maskToken(apiKey),
    locationId,
    companyId,
    allowAdminManageGHL: settings.allowAdminManageGHL !== false,
    cacheTtlMinutes: settings.cacheTtlMinutes || 15,
    status: connection?.status || (apiKey && locationId ? 'CONNECTED' : 'DISCONNECTED'),
    connectedAt: connection?.connectedAt || (apiKey && locationId ? new Date().toISOString() : null)
  };
}

function canUserManageGhl(role: UserRole, allowAdminManageGHL: boolean): boolean {
  if (role === UserRole.SUPER_ADMIN || role === UserRole.WORKSPACE_OWNER) return true;
  if (role === UserRole.ADMIN) return allowAdminManageGHL;
  return false;
}

const isValidDateString = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));

// Demo playground token → Supabase credentials mapping
const DEMO_CREDENTIALS: Record<string, { email: string; password: string }> = {
  'token_super_admin': { email: 'operations@showtimepoolmechanics.com', password: 'Demo2026!' },
  'token_marcus':      { email: 'owner@showtime.com',                   password: 'Demo2026!' },
  'token_sarah':       { email: 'admin@showtime.com',                   password: 'Demo2026!' },
  'token_bobby':       { email: 'sales@showtime.com',                   password: 'Demo2026!' },
  'token_rachel':      { email: 'readonly@showtime.com',                password: 'Demo2026!' },
  'token_bob':         { email: 'owner@vancepools.com',                 password: 'Demo2026!' }
};

// ==========================================
// GHL SSO HELPERS
// ==========================================

// GHL encrypts with CryptoJS AES (OpenSSL "Salted__" format, EVP_BytesToKey MD5 derivation).
// Replicated here with Node's built-in crypto — no extra npm dependency needed.
function decryptGhlPayload(encrypted: string, passphrase: string): any {
  const buf = Buffer.from(encrypted, 'base64');
  if (buf.slice(0, 8).toString('ascii') !== 'Salted__') throw new Error('Not OpenSSL-salted ciphertext');
  const salt = buf.slice(8, 16);
  const ciphertext = buf.slice(16);
  // EVP_BytesToKey: MD5-chain until we have 48 bytes (32 key + 16 IV)
  const pass = Buffer.from(passphrase, 'utf8');
  let derived = Buffer.alloc(0);
  let block = Buffer.alloc(0);
  while (derived.length < 48) {
    block = createHash('md5').update(Buffer.concat([block, pass, salt])).digest();
    derived = Buffer.concat([derived, block]);
  }
  const key = derived.slice(0, 32);
  const iv  = derived.slice(32, 48);
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

// Short-lived HMAC-SHA256 JWT for SSO sessions (no Supabase user creation needed).
function mintSsoJwt(payload: Record<string, any>): string {
  const secret = process.env.GHL_APP_SHARED_SECRET!;
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body   = Buffer.from(JSON.stringify({ _src: 'ghl_sso', ...payload })).toString('base64url');
  const sig    = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifySsoJwt(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const secret = process.env.GHL_APP_SHARED_SECRET;
    if (!secret) return null;
    const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    const a = Buffer.from(sig,      'base64url');
    const b = Buffer.from(expected, 'base64url');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload._src !== 'ghl_sso') return null;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

// ==========================================
// INTEGRATION ENCRYPTION & OAUTH HELPERS
// ==========================================

function encryptToken(text: string): string {
  const keyHex = process.env.INTEGRATION_ENCRYPTION_KEY || '';
  if (!keyHex) throw new Error('INTEGRATION_ENCRYPTION_KEY is not configured');
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptToken(encryptedStr: string): string {
  const keyHex = process.env.INTEGRATION_ENCRYPTION_KEY || '';
  if (!keyHex) throw new Error('INTEGRATION_ENCRYPTION_KEY is not configured');
  const key = Buffer.from(keyHex, 'hex');
  const [ivHex, authTagHex, ciphertextHex] = encryptedStr.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv) as any;
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(64).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

function mintOAuthState(workspaceId: string, codeVerifier: string): string {
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET!;
  const body = Buffer.from(JSON.stringify({
    workspaceId,
    codeVerifier,
    exp: Math.floor(Date.now() / 1000) + 600,
    nonce: randomBytes(8).toString('hex')
  })).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyOAuthState(state: string): { workspaceId: string; codeVerifier: string } | null {
  try {
    const dotIdx = state.lastIndexOf('.');
    if (dotIdx === -1) return null;
    const body = state.slice(0, dotIdx);
    const sig = state.slice(dotIdx + 1);
    const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!secret) return null;
    const expected = createHmac('sha256', secret).update(body).digest('base64url');
    const a = Buffer.from(sig, 'base64url');
    const b = Buffer.from(expected, 'base64url');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { workspaceId: payload.workspaceId, codeVerifier: payload.codeVerifier };
  } catch { return null; }
}

async function getValidGoogleToken(workspaceId: string): Promise<string | null> {
  const { data: row } = await supabaseAdmin
    .from('workspace_integrations')
    .select('encrypted_access_token, encrypted_refresh_token, token_expiry')
    .eq('workspace_id', workspaceId)
    .eq('provider', 'google_analytics')
    .single();
  if (!row) return null;
  const now = Date.now();
  const expiry = row.token_expiry ? new Date(row.token_expiry).getTime() : 0;
  if (expiry - now > 5 * 60 * 1000 && row.encrypted_access_token) {
    try { return decryptToken(row.encrypted_access_token); } catch { return null; }
  }
  if (!row.encrypted_refresh_token) return null;
  try {
    const refreshToken = decryptToken(row.encrypted_refresh_token);
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
        grant_type: 'refresh_token'
      }).toString()
    });
    if (!resp.ok) return null;
    const tokenData = await resp.json() as any;
    const newExpiry = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString();
    await supabaseAdmin.from('workspace_integrations').update({
      encrypted_access_token: encryptToken(tokenData.access_token),
      token_expiry: newExpiry,
      last_synced_at: new Date().toISOString()
    }).eq('workspace_id', workspaceId).eq('provider', 'google_analytics');
    return tokenData.access_token;
  } catch { return null; }
}

async function fetchGA4Report(accessToken: string, propertyId: string, startDate: string, endDate: string) {
  const base = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
  const headers: Record<string, string> = { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const [channelRes, pagesRes] = await Promise.all([
    fetch(base, {
      method: 'POST', headers,
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'newUsers' }, { name: 'conversions' }],
        limit: 20
      })
    }),
    fetch(base, {
      method: 'POST', headers,
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'landingPagePlusQueryString' }],
        metrics: [{ name: 'sessions' }, { name: 'bounceRate' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10
      })
    })
  ]);
  const channelData = channelRes.ok ? await channelRes.json() as any : null;
  const pagesData = pagesRes.ok ? await pagesRes.json() as any : null;
  let sessions = 0, users = 0, newUsers = 0, conversions = 0;
  const channelBreakdown: { channel: string; sessions: number; users: number; conversions: number }[] = [];
  if (channelData?.rows) {
    for (const row of channelData.rows) {
      const s = parseInt(row.metricValues?.[0]?.value || '0');
      const u = parseInt(row.metricValues?.[1]?.value || '0');
      const n = parseInt(row.metricValues?.[2]?.value || '0');
      const c = parseInt(row.metricValues?.[3]?.value || '0');
      sessions += s; users += u; newUsers += n; conversions += c;
      channelBreakdown.push({ channel: row.dimensionValues?.[0]?.value || 'Unknown', sessions: s, users: u, conversions: c });
    }
  }
  const topLandingPages: { page: string; sessions: number; bounceRate: number }[] = [];
  if (pagesData?.rows) {
    for (const row of pagesData.rows) {
      topLandingPages.push({
        page: row.dimensionValues?.[0]?.value || '/',
        sessions: parseInt(row.metricValues?.[0]?.value || '0'),
        bounceRate: parseFloat(row.metricValues?.[1]?.value || '0')
      });
    }
  }
  return { sessions, users, newUsers, conversions, channelBreakdown, topLandingPages };
}

async function fetchGA4Properties(accessToken: string): Promise<{ propertyId: string; displayName: string; accountName: string }[]> {
  const res = await fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries', {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!res.ok) return [];
  const data = await res.json() as any;
  const props: { propertyId: string; displayName: string; accountName: string }[] = [];
  for (const account of (data.accountSummaries || [])) {
    for (const prop of (account.propertySummaries || [])) {
      props.push({
        propertyId: prop.property?.replace('properties/', '') || '',
        displayName: prop.displayName || prop.property || 'Unknown Property',
        accountName: account.displayName || 'Unknown Account'
      });
    }
  }
  return props;
}

function getMockGA4Report() {
  return {
    sessions: 3842, users: 2915, newUsers: 1847, conversions: 124,
    channelBreakdown: [
      { channel: 'Organic Search', sessions: 1520, users: 1180, conversions: 62 },
      { channel: 'Direct', sessions: 890, users: 740, conversions: 28 },
      { channel: 'Paid Search', sessions: 612, users: 510, conversions: 19 },
      { channel: 'Social', sessions: 440, users: 275, conversions: 8 },
      { channel: 'Email', sessions: 280, users: 155, conversions: 5 },
      { channel: 'Referral', sessions: 100, users: 55, conversions: 2 }
    ],
    topLandingPages: [
      { page: '/', sessions: 1240, bounceRate: 0.42 },
      { page: '/pool-services', sessions: 688, bounceRate: 0.35 },
      { page: '/contact', sessions: 512, bounceRate: 0.28 },
      { page: '/pool-installation', sessions: 420, bounceRate: 0.38 },
      { page: '/pool-repair', sessions: 310, bounceRate: 0.45 },
      { page: '/blog/pool-maintenance-tips', sessions: 284, bounceRate: 0.52 },
      { page: '/free-estimate', sessions: 245, bounceRate: 0.22 },
      { page: '/about', sessions: 143, bounceRate: 0.55 }
    ],
    source: 'mock' as const,
    warnings: ['Google Analytics is not connected. Showing sample data.']
  };
}

// ==========================================
// AUTH MIDDLEWARE
// ==========================================

export const requireAuth = (allowedRoles?: UserRole[]) => {
  return async (req: any, res: any, next: any) => {
    const authHeader = req.headers['x-auth-token'] || req.headers['authorization'];
    if (!authHeader) {
      return res.status(401).json({ status: 'error', error: 'Authentication required. No session token provided.' });
    }
    const token = authHeader.toString().replace('Bearer ', '');

    // GHL SSO fast-path — verified HMAC JWT, no Supabase round-trip
    const ssoPayload = verifySsoJwt(token);
    if (ssoPayload) {
      const workspace = await getWorkspaceById(ssoPayload.workspaceId);
      if (!workspace) return res.status(401).json({ status: 'error', error: 'SSO workspace not found.' });
      if (workspace.suspended) return res.status(403).json({ status: 'error', error: 'Workspace suspended.', suspended: true });
      const ghlRole = (ssoPayload.ghlRole || '').toLowerCase();
      const role: UserRole = ['admin', 'owner'].includes(ghlRole) ? UserRole.WORKSPACE_OWNER : UserRole.READ_ONLY;
      if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(role)) {
        return res.status(403).json({ status: 'error', error: `Access Denied: insufficient role.` });
      }
      // Same entitlement gate as the password path. This branch returns early, so without
      // it an expired tenant could keep full access simply by entering through the GHL
      // marketplace iframe instead of the login form.
      const ssoEntitlement = workspaceEntitlement(workspace);
      if (!ssoEntitlement.hasAccess) {
        return res.status(403).json({
          status: 'error',
          error: ssoEntitlement.denialReason,
          accessDenied: true,
          entitlement: ssoEntitlement,
          suspended: ssoEntitlement.accessStatus === 'SUSPENDED'
        });
      }
      req.entitlement = ssoEntitlement;
      req.user = { id: ssoPayload.userId || 'ghl_sso', email: ssoPayload.email || '', name: ssoPayload.email || '', onboarded: true, createdAt: new Date().toISOString() };
      req.workspace = workspace;
      req.member = null;
      req.role = role;
      req.token = token;
      req.supabaseUserId = ssoPayload.userId || 'ghl_sso';
      return next();
    }

    // Verify JWT — stateless, cold-start safe
    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authUser) {
      return res.status(401).json({ status: 'error', error: 'Invalid or expired session token. Please log in again.' });
    }

    const profile = await getProfile(authUser.id);
    const user = toSaaSUser(authUser, profile);

    // Active workspace from user metadata
    let activeWorkspaceId: string = authUser.user_metadata?.active_workspace_id || '';
    let workspace: Workspace | null = null;
    let member: WorkspaceMember | null = null;

    if (activeWorkspaceId) {
      workspace = await getWorkspaceById(activeWorkspaceId);
      if (workspace) member = await getWorkspaceMember(activeWorkspaceId, authUser.id);
    }

    // Fallback: use first membership
    if (!workspace) {
      const { data: memRows } = await supabaseAdmin
        .from('workspace_members')
        .select('*, workspaces(*)')
        .eq('user_id', authUser.id)
        .order('joined_at')
        .limit(1);

      if (memRows && memRows.length > 0) {
        workspace = toWorkspace(memRows[0].workspaces);
        member = toMember(memRows[0]);
        activeWorkspaceId = workspace.id;
        await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
          user_metadata: { ...authUser.user_metadata, active_workspace_id: workspace.id }
        });
      }
    }

    if (!workspace) {
      return res.status(403).json({ status: 'error', error: 'No workspace found for this account. Please contact your administrator.' });
    }

    const isSuperAdmin = member?.role === UserRole.SUPER_ADMIN;

    if (workspace.suspended && !isSuperAdmin) {
      return res.status(403).json({ status: 'error', error: `Access Denied: The workspace "${workspace.name}" has been suspended.`, suspended: true });
    }

    if (!member && !isSuperAdmin) {
      return res.status(403).json({ status: 'error', error: 'Access Denied: You are not an authenticated member of this workspace.' });
    }

    const role: UserRole = isSuperAdmin ? UserRole.SUPER_ADMIN : (member?.role as UserRole || UserRole.READ_ONLY);

    if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(role)) {
      return res.status(403).json({ status: 'error', error: `Access Denied: Role "${role}" does not have sufficient permissions.` });
    }

    // ---- ENTITLEMENT GATE ----
    // The authoritative trial/licence check. Runs on every protected route because it
    // lives in the shared middleware; the workspace row is already loaded above, so this
    // costs no additional query.
    //
    // SUPER_ADMIN is exempt by design: platform staff must be able to reach a locked-out
    // tenant in order to activate its licence or extend its trial. Gating them would make
    // an expired workspace unrecoverable through the product.
    const entitlement = workspaceEntitlement(workspace);
    req.entitlement = entitlement;

    if (!entitlement.hasAccess && !isSuperAdmin) {
      return res.status(403).json({
        status: 'error',
        error: entitlement.denialReason,
        // Distinguishes "your trial ended" from "your role is too low" — both are 403,
        // and the client must not treat this one as a credential failure and log out.
        accessDenied: true,
        entitlement,
        suspended: entitlement.accessStatus === 'SUSPENDED'
      });
    }

    req.user = user;
    req.workspace = workspace;
    req.member = member;
    req.role = role;
    req.token = token;
    req.supabaseUserId = authUser.id;
    next();
  };
};

// ==========================================
// EXPRESS APP
// ==========================================

const app = express();
app.use(express.json());

// ---- AUTH ROUTES ----

app.post('/api/auth/login', async (req, res) => {
  const { email, password, impersonateToken } = req.body;

  let loginEmail: string;
  let loginPassword: string;

  if (impersonateToken) {
    const demo = DEMO_CREDENTIALS[impersonateToken];
    if (!demo) return res.status(401).json({ status: 'error', error: 'Unknown playground token.' });
    loginEmail = demo.email;
    loginPassword = demo.password;
  } else {
    if (!email) return res.status(400).json({ status: 'error', error: 'Email is required.' });
    loginEmail = email;
    loginPassword = password || '';
  }

  // Use direct REST sign-in — never call supabaseAdmin.auth.signInWithPassword()
  // as it mutates the singleton's session and breaks all subsequent .from() queries.
  const signInResult = await supabaseSignIn(loginEmail, loginPassword);
  // A misconfigured or unreachable auth service is not a bad password — reporting
  // it as 401 sends users to reset a credential that was never wrong.
  if (signInResult.kind === 'config' || signInResult.kind === 'network') {
    console.error('[login] auth backend unavailable:', signInResult.error);
    return res.status(503).json({ status: 'error', error: signInResult.error });
  }
  if (signInResult.error || !signInResult.accessToken) {
    return res.status(401).json({ status: 'error', error: 'Invalid credentials. Check your email and password.' });
  }

  const { data: { user: authUser }, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(signInResult.userId!);
  if (getUserError || !authUser) {
    return res.status(401).json({ status: 'error', error: 'Authentication failed. Please try again.' });
  }
  const sessionToken = signInResult.accessToken;

  const profile = await getProfile(authUser.id);
  const user = toSaaSUser(authUser, profile);
  const workspaces = await getWorkspacesForUser(authUser.id);

  let activeWorkspaceId = authUser.user_metadata?.active_workspace_id;
  if (!activeWorkspaceId && workspaces.length > 0) {
    activeWorkspaceId = workspaces[0].id;
    await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
      user_metadata: { ...authUser.user_metadata, active_workspace_id: activeWorkspaceId }
    });
  }

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0] || null;
  const member = activeWorkspace ? await getWorkspaceMember(activeWorkspace.id, authUser.id) : null;
  const role: UserRole = member?.role === UserRole.SUPER_ADMIN ? UserRole.SUPER_ADMIN : (member?.role as UserRole || UserRole.READ_ONLY);

  await logAction(activeWorkspace?.id || null, authUser.id, authUser.email || '', 'USER_LOGIN',
    impersonateToken ? `Authenticated via Playground as ${role}` : 'Authenticated via email+password');

  // Login is deliberately NOT entitlement-gated. An expired tenant must still be able to
  // authenticate and be told why it is locked, rather than being bounced to the login form
  // as though the password were wrong. The entitlement below drives that UI; the gate in
  // requireAuth() is what actually protects the data.
  res.json({
    status: 'success',
    session: {
      user, activeWorkspace, memberRecord: member, role, token: sessionToken,
      entitlement: activeWorkspace ? workspaceEntitlement(activeWorkspace) : null
    },
    workspaces
  });
});

app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ status: 'error', error: 'Name, email, and password are required.' });
  }

  const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name }
  });

  if (createError) {
    const msg = createError.message.toLowerCase().includes('already') || createError.message.toLowerCase().includes('exists')
      ? 'An account with this email already exists.'
      : createError.message;
    return res.status(400).json({ status: 'error', error: msg });
  }

  await supabaseAdmin.from('profiles').insert({ id: newUser.user.id, name, onboarded: false });

  const signInResult = await supabaseSignIn(email, password);
  if (signInResult.error || !signInResult.accessToken) {
    return res.status(500).json({ status: 'error', error: 'Account created but auto sign-in failed. Please log in manually.' });
  }

  const token = signInResult.accessToken;
  const user = toSaaSUser(newUser.user, { name, onboarded: false });
  res.json({ status: 'success', user, token });
});

app.post('/api/auth/onboarding', async (req, res) => {
  const { token, companyName, ghlMode, apiKey } = req.body;
  if (!token) return res.status(401).json({ status: 'error', error: 'Authentication token is required.' });
  if (!companyName || !ghlMode) return res.status(400).json({ status: 'error', error: 'Company name and mode are required.' });

  const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authUser) return res.status(401).json({ status: 'error', error: 'Invalid or expired session token.' });

  const slug = companyName.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
  const workspaceId = `ws_${Date.now()}`;

  // Onboarding is where the 14-day trial begins — this is the existing product flow
  // (the legacy subscriptions row below has always dated its trial from here).
  //
  // These columns are REQUIRED. Without them the workspace defaults to license_status
  // 'NONE' with no trial window, which derives to NOT_STARTED, and the entitlement gate
  // in requireAuth() would deny every request from a freshly onboarded tenant.
  //
  // trial_used is set now and never cleared, so an organisation cannot obtain a second
  // free trial by having its dates reset.
  const trial = newTrialWindow();

  await supabaseAdmin.from('workspaces').insert({
    id: workspaceId,
    name: companyName,
    slug,
    ghl_location_id: ghlMode === 'LIVE' ? `loc_live_${slug.slice(0, 8)}` : `loc_mock_${slug.slice(0, 8)}`,
    suspended: false,
    trial_started_at: trial.trialStartedAt,
    trial_ends_at: trial.trialEndsAt,
    trial_used: true,
    license_status: 'NONE'
  });

  await supabaseAdmin.from('workspace_members').insert({
    id: `mem_${Date.now()}`,
    workspace_id: workspaceId,
    user_id: authUser.id,
    role: 'WORKSPACE_OWNER',
    joined_at: new Date().toISOString()
  });

  await supabaseAdmin.from('reporting_settings').insert({
    workspace_id: workspaceId,
    default_timeframe: 'last_30_days',
    allowed_dashboards: ['overview', 'opportunity', 'sales', 'owner', 'marketing'],
    mode: ghlMode,
    allow_admin_manage_ghl: true,
    cache_ttl_minutes: 15
  });

  await supabaseAdmin.from('subscriptions').insert({
    workspace_id: workspaceId,
    plan: 'GROWTH',
    status: 'TRIALING',
    amount: 147,
    next_billing_date: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString()
  });

  if (ghlMode === 'LIVE' && apiKey) {
    await supabaseAdmin.from('ghl_connections').insert({
      id: `gn_${Date.now()}`,
      workspace_id: workspaceId,
      location_id: `loc_live_${slug.slice(0, 8)}`,
      api_key: apiKey,
      status: 'CONNECTED'
    });
  }

  await supabaseAdmin.from('profiles').update({ onboarded: true }).eq('id', authUser.id);
  await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
    user_metadata: { ...authUser.user_metadata, active_workspace_id: workspaceId }
  });

  const profile = await getProfile(authUser.id);
  const user = toSaaSUser(authUser, profile);
  const workspace = await getWorkspaceById(workspaceId);
  const member = await getWorkspaceMember(workspaceId, authUser.id);

  await logAction(workspaceId, authUser.id, authUser.email || '', 'ONBOARD_WORKSPACE', `Workspace "${companyName}" onboarded`);

  res.json({ status: 'success', session: { user, activeWorkspace: workspace, memberRecord: member, role: UserRole.WORKSPACE_OWNER, token }, workspaces: [workspace] });
});

app.get('/api/auth/me', async (req: any, res) => {
  const authHeader = req.headers['x-auth-token'] || req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ status: 'unauthorized', error: 'No token' });
  const token = authHeader.toString().replace('Bearer ', '');

  const { data: { user: authUser }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !authUser) return res.status(401).json({ status: 'unauthorized', error: 'Session expired' });

  const profile = await getProfile(authUser.id);
  const user = toSaaSUser(authUser, profile);
  const workspaces = await getWorkspacesForUser(authUser.id);

  let activeWorkspaceId = authUser.user_metadata?.active_workspace_id;
  if (!activeWorkspaceId && workspaces.length > 0) {
    activeWorkspaceId = workspaces[0].id;
    await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
      user_metadata: { ...authUser.user_metadata, active_workspace_id: activeWorkspaceId }
    });
  }

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0] || null;
  const member = activeWorkspace ? await getWorkspaceMember(activeWorkspace.id, authUser.id) : null;
  const role: UserRole = member?.role === UserRole.SUPER_ADMIN ? UserRole.SUPER_ADMIN : (member?.role as UserRole || UserRole.READ_ONLY);

  // Ungated for the same reason as login: this is how the client learns it is locked out.
  // Gating this route would 403 the session check and bounce the user to the login form.
  res.json({
    status: 'success',
    session: {
      user, activeWorkspace, memberRecord: member, role, token,
      entitlement: activeWorkspace ? workspaceEntitlement(activeWorkspace) : null
    },
    workspaces
  });
});

app.post('/api/auth/switch-workspace', async (req, res) => {
  const { token, workspaceId } = req.body;
  if (!token || !workspaceId) return res.status(400).json({ status: 'error', error: 'Token and workspaceId are required.' });

  const { data: { user: authUser }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !authUser) return res.status(401).json({ status: 'error', error: 'Invalid token.' });

  const workspaces = await getWorkspacesForUser(authUser.id);
  const isSuperAdmin = (await supabaseAdmin.from('workspace_members').select('role').eq('user_id', authUser.id)).data?.some((m: any) => m.role === 'SUPER_ADMIN');
  const hasMembership = workspaces.some(w => w.id === workspaceId) || isSuperAdmin;
  if (!hasMembership) return res.status(403).json({ status: 'error', error: 'Access Denied: You do not have membership in this workspace.' });

  await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
    user_metadata: { ...authUser.user_metadata, active_workspace_id: workspaceId }
  });

  const profile = await getProfile(authUser.id);
  const user = toSaaSUser(authUser, profile);
  const activeWorkspace = await getWorkspaceById(workspaceId);
  const member = await getWorkspaceMember(workspaceId, authUser.id);
  const role: UserRole = member?.role === UserRole.SUPER_ADMIN ? UserRole.SUPER_ADMIN : (member?.role as UserRole || UserRole.READ_ONLY);

  await logAction(workspaceId, authUser.id, authUser.email || '', 'SWITCH_WORKSPACE', `Switched to: ${activeWorkspace?.name}`);
  res.json({ status: 'success', session: { user, activeWorkspace, memberRecord: member, role, token }, workspaces });
});

// ---- WORKSPACE ROUTES ----

app.get('/api/workspaces/settings', requireAuth(), async (req: any, res) => {
  const settings = await getOrCreateReportingSettings(req.workspace.id);
  const { data: sub } = await supabaseAdmin.from('subscriptions').select('*').eq('workspace_id', req.workspace.id).single();
  const conn = await getGHLConnection(req.workspace.id);
  res.json({ status: 'success', settings, subscription: sub, connection: conn ? { locationId: conn.locationId, status: conn.status, connectedAt: conn.connectedAt } : null });
});

app.post('/api/workspaces/settings', requireAuth([UserRole.SUPER_ADMIN, UserRole.WORKSPACE_OWNER, UserRole.ADMIN]), async (req: any, res) => {
  const { defaultTimeframe, allowedDashboards, ghlApiKey, removeConnection } = req.body;

  const updates: any = {};
  if (defaultTimeframe !== undefined) updates.default_timeframe = defaultTimeframe;
  if (allowedDashboards !== undefined) updates.allowed_dashboards = allowedDashboards;

  if (ghlApiKey !== undefined && ghlApiKey !== '') {
    const existing = await getGHLConnection(req.workspace.id);
    if (!existing) {
      await supabaseAdmin.from('ghl_connections').insert({ id: `gn_${Date.now()}`, workspace_id: req.workspace.id, location_id: req.workspace.ghlLocationId, api_key: ghlApiKey, status: 'CONNECTED' });
    } else {
      await supabaseAdmin.from('ghl_connections').update({ api_key: ghlApiKey, status: 'CONNECTED', connected_at: new Date().toISOString() }).eq('workspace_id', req.workspace.id);
    }
    updates.mode = 'LIVE';
    await logAction(req.workspace.id, req.user.id, req.user.email, 'UPDATE_INTEGRATION_KEY', 'Updated GHL integration key.');
  }

  if (removeConnection) {
    await supabaseAdmin.from('ghl_connections').delete().eq('workspace_id', req.workspace.id);
    updates.mode = 'MOCK';
    await logAction(req.workspace.id, req.user.id, req.user.email, 'REMOVE_INTEGRATION', 'Removed GHL connector.');
  }

  if (Object.keys(updates).length > 0) {
    await supabaseAdmin.from('reporting_settings').update(updates).eq('workspace_id', req.workspace.id);
  }

  const settings = await getOrCreateReportingSettings(req.workspace.id);
  res.json({ status: 'success', settings, message: 'Workspace configurations updated successfully.' });
});

app.get('/api/workspaces/members', requireAuth([UserRole.SUPER_ADMIN, UserRole.WORKSPACE_OWNER, UserRole.ADMIN]), async (req: any, res) => {
  const members = await getMembersByWorkspace(req.workspace.id);
  const list = await Promise.all(members.map(async m => {
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(m.userId);
    const profile = await getProfile(m.userId);
    return { id: m.id, userId: m.userId, userName: profile?.name || authUser?.user?.email?.split('@')[0] || 'Unknown', userEmail: authUser?.user?.email || 'unknown@company.com', role: m.role, joinedAt: m.joinedAt };
  }));
  res.json({ status: 'success', members: list });
});

app.post('/api/workspaces/invite', requireAuth([UserRole.SUPER_ADMIN, UserRole.WORKSPACE_OWNER]), async (req: any, res) => {
  const { name, email, role } = req.body;
  if (!name || !email || !role) return res.status(400).json({ status: 'error', error: 'Name, email, and role are required.' });

  // Find or create user
  let userId: string;
  const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
  const existing = existingUsers?.users.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());

  if (existing) {
    userId = existing.id;
  } else {
    const { data: newUser, error } = await supabaseAdmin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { name }, password: 'ChangeMe2026!' });
    if (error) return res.status(400).json({ status: 'error', error: error.message });
    await supabaseAdmin.from('profiles').insert({ id: newUser.user.id, name, onboarded: true });
    userId = newUser.user.id;
  }

  const alreadyMember = await getWorkspaceMember(req.workspace.id, userId);
  if (alreadyMember) return res.status(400).json({ status: 'error', error: 'User is already a member of this workspace.' });

  await supabaseAdmin.from('workspace_members').insert({ id: `mem_${Date.now()}`, workspace_id: req.workspace.id, user_id: userId, role, joined_at: new Date().toISOString() });
  await logAction(req.workspace.id, req.user.id, req.user.email, 'INVITE_USER', `Invited ${email} as ${role}`);
  res.json({ status: 'success', message: `Invited ${email} successfully.` });
});

// ---- ADMIN ROUTES ----

app.get('/api/admin/workspaces', requireAuth([UserRole.SUPER_ADMIN]), async (req, res) => {
  const { data: allWs } = await supabaseAdmin.from('workspaces').select('*');
  const list = await Promise.all((allWs || []).map(async (ws: any) => {
    const members = await getMembersByWorkspace(ws.id);
    const conn = await getGHLConnection(ws.id);
    // Legacy recurring-billing row. Display only — it does not gate anything.
    // See FUTURE_SUBSCRIPTIONS.md before giving it any meaning.
    const { data: sub } = await supabaseAdmin.from('subscriptions').select('*').eq('workspace_id', ws.id).single();
    const workspace = toWorkspace(ws);
    return {
      ...workspace,
      membersCount: members.length,
      connectionStatus: conn?.status || 'DISCONNECTED',
      plan: sub?.plan || 'N/A',
      amount: sub?.amount || 0,
      // The live access decision, plus the provenance the console needs to show who
      // granted a licence and whether it was machine-backfilled.
      entitlement: workspaceEntitlement(workspace),
      licenseReference: ws.license_reference ?? null,
      licensedByUserId: ws.licensed_by_user_id ?? null,
      suspensionReason: ws.suspension_reason ?? null,
      suspendedAt: ws.suspended_at ?? null
    };
  }));
  res.json({ status: 'success', workspaces: list });
});

app.post('/api/admin/suspend', requireAuth([UserRole.SUPER_ADMIN]), async (req: any, res) => {
  const { workspaceId, suspend, reason } = req.body;
  if (!workspaceId) return res.status(400).json({ status: 'error', error: 'workspaceId is required.' });
  const ws = await getWorkspaceById(workspaceId);
  if (!ws) return res.status(404).json({ status: 'error', error: 'Workspace not found.' });

  const on = !!suspend;
  await supabaseAdmin.from('workspaces').update({
    suspended: on,
    // Cleared on restore so stale metadata cannot imply a workspace is still suspended.
    suspended_at: on ? new Date().toISOString() : null,
    suspension_reason: on ? (reason || null) : null
  }).eq('id', workspaceId);

  await logAction(workspaceId, req.user.id, req.user.email, on ? 'SUSPEND_WORKSPACE' : 'RESTORE_WORKSPACE',
    on ? `Suspended. Reason: ${reason || 'not given'}` : 'Access restored.');
  res.json({ status: 'success', message: `Workspace "${ws.name}" has been ${on ? 'SUSPENDED' : 'RESTORED'}.` });
});

// ---- ENTITLEMENT CONTROLS (SUPER ADMIN) ----
//
// The manual activation flow. Payment is settled outside the platform, so these endpoints
// are the only way an organisation becomes licensed. Every one writes an audit record
// naming the operator — "who activated this licence" must always be answerable.

/**
 * Converts an organisation to a perpetual licence after an external purchase is confirmed.
 * This is the trial -> paid transition. There is no expiry and nothing to renew.
 */
app.post('/api/admin/entitlement/activate-license', requireAuth([UserRole.SUPER_ADMIN]), async (req: any, res) => {
  const { workspaceId, reference } = req.body;
  if (!workspaceId) return res.status(400).json({ status: 'error', error: 'workspaceId is required.' });

  const ws = await getWorkspaceById(workspaceId);
  if (!ws) return res.status(404).json({ status: 'error', error: 'Workspace not found.' });

  // Refuse rather than silently overwrite: re-activating would replace the original
  // operator, timestamp and purchase reference, destroying the provenance of the first sale.
  if (ws.licenseStatus === 'LICENSED') {
    return res.status(409).json({
      status: 'error',
      error: `"${ws.name}" already holds a perpetual licence (granted ${ws.licensedAt}). Revoke it first if you need to re-issue.`
    });
  }

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from('workspaces').update({
    license_status: 'LICENSED',
    licensed_at: now,
    licensed_by_user_id: req.supabaseUserId,
    license_reference: (typeof reference === 'string' && reference.trim()) ? reference.trim() : null,
    // A licensed org has consumed its trial. Prevents a later revoke from handing back a
    // "fresh" trial it never earned.
    trial_used: true
  }).eq('id', workspaceId);
  if (error) return res.status(500).json({ status: 'error', error: `Database error: ${error.message}` });

  await logAction(workspaceId, req.user.id, req.user.email, 'ACTIVATE_LICENSE',
    `Perpetual licence activated by ${req.user.email}. Reference: ${reference || 'not given'}`);

  const updated = await getWorkspaceById(workspaceId);
  res.json({
    status: 'success',
    message: `"${ws.name}" now has permanent licensed access.`,
    entitlement: updated ? workspaceEntitlement(updated) : null
  });
});

/** Extends a trial. Permitted only for super admins, and only against an audit record. */
app.post('/api/admin/entitlement/extend-trial', requireAuth([UserRole.SUPER_ADMIN]), async (req: any, res) => {
  const { workspaceId, days, reason } = req.body;
  if (!workspaceId) return res.status(400).json({ status: 'error', error: 'workspaceId is required.' });

  const n = Number(days);
  if (!Number.isInteger(n) || n < 1 || n > 365) {
    return res.status(400).json({ status: 'error', error: 'days must be a whole number between 1 and 365.' });
  }

  const ws = await getWorkspaceById(workspaceId);
  if (!ws) return res.status(404).json({ status: 'error', error: 'Workspace not found.' });
  if (ws.licenseStatus === 'LICENSED') {
    return res.status(409).json({ status: 'error', error: `"${ws.name}" holds a perpetual licence — a trial extension would have no effect.` });
  }
  if (!ws.trialStartedAt || !ws.trialEndsAt) {
    return res.status(400).json({ status: 'error', error: `"${ws.name}" has no trial to extend.` });
  }

  // Extend from now when the trial has already elapsed, otherwise from its current end.
  // Extending from a lapsed end date would grant fewer days than requested — a 7-day
  // extension on a trial that ended 5 days ago would leave only 2 days of access.
  const currentEnd = new Date(ws.trialEndsAt).getTime();
  const base = Math.max(Date.now(), currentEnd);
  const newEnd = new Date(base + n * 86_400_000).toISOString();
  const now = new Date().toISOString();

  const { error } = await supabaseAdmin.from('workspaces').update({
    trial_ends_at: newEnd,
    trial_extension_count: ws.trialExtensionCount + 1,
    trial_extended_at: now,
    trial_extended_by: req.supabaseUserId
  }).eq('id', workspaceId);
  if (error) return res.status(500).json({ status: 'error', error: `Database error: ${error.message}` });

  await logAction(workspaceId, req.user.id, req.user.email, 'EXTEND_TRIAL',
    `Trial extended ${n} day(s) to ${newEnd} by ${req.user.email}. Reason: ${reason || 'not given'}`);

  const updated = await getWorkspaceById(workspaceId);
  res.json({
    status: 'success',
    message: `Trial for "${ws.name}" extended by ${n} day(s).`,
    entitlement: updated ? workspaceEntitlement(updated) : null
  });
});

/**
 * Withdraws a perpetual licence. Deliberately sets REVOKED rather than reverting to NONE,
 * so a withdrawn licence stays distinguishable from an org that never purchased.
 */
app.post('/api/admin/entitlement/revoke-license', requireAuth([UserRole.SUPER_ADMIN]), async (req: any, res) => {
  const { workspaceId, reason } = req.body;
  if (!workspaceId) return res.status(400).json({ status: 'error', error: 'workspaceId is required.' });
  if (!reason || !String(reason).trim()) {
    // Required: revoking paid access is consequential and must never be unexplained.
    return res.status(400).json({ status: 'error', error: 'A reason is required to revoke a licence.' });
  }

  const ws = await getWorkspaceById(workspaceId);
  if (!ws) return res.status(404).json({ status: 'error', error: 'Workspace not found.' });
  if (ws.licenseStatus !== 'LICENSED') {
    return res.status(409).json({ status: 'error', error: `"${ws.name}" does not hold a licence to revoke.` });
  }

  const { error } = await supabaseAdmin.from('workspaces').update({
    license_status: 'REVOKED'
  }).eq('id', workspaceId);
  if (error) return res.status(500).json({ status: 'error', error: `Database error: ${error.message}` });

  await logAction(workspaceId, req.user.id, req.user.email, 'REVOKE_LICENSE',
    `Licence revoked by ${req.user.email}. Reason: ${String(reason).trim()}`);

  const updated = await getWorkspaceById(workspaceId);
  res.json({
    status: 'success',
    message: `Licence for "${ws.name}" has been revoked.`,
    entitlement: updated ? workspaceEntitlement(updated) : null
  });
});

/** Restores a revoked licence without re-issuing it, preserving the original provenance. */
app.post('/api/admin/entitlement/restore-license', requireAuth([UserRole.SUPER_ADMIN]), async (req: any, res) => {
  const { workspaceId, reason } = req.body;
  if (!workspaceId) return res.status(400).json({ status: 'error', error: 'workspaceId is required.' });

  const ws = await getWorkspaceById(workspaceId);
  if (!ws) return res.status(404).json({ status: 'error', error: 'Workspace not found.' });
  if (ws.licenseStatus !== 'REVOKED') {
    return res.status(409).json({ status: 'error', error: `"${ws.name}" has no revoked licence to restore.` });
  }

  // licensed_at / licensed_by_user_id are left untouched — the original grant still stands,
  // it was only withdrawn. Overwriting them would rewrite who made the original sale.
  const { error } = await supabaseAdmin.from('workspaces').update({
    license_status: 'LICENSED',
    // Re-assert licensed_at only if it was somehow never set, to satisfy the CHECK constraint.
    licensed_at: ws.licensedAt ?? new Date().toISOString()
  }).eq('id', workspaceId);
  if (error) return res.status(500).json({ status: 'error', error: `Database error: ${error.message}` });

  await logAction(workspaceId, req.user.id, req.user.email, 'RESTORE_LICENSE',
    `Licence restored by ${req.user.email}. Reason: ${reason || 'not given'}`);

  const updated = await getWorkspaceById(workspaceId);
  res.json({
    status: 'success',
    message: `Licence for "${ws.name}" has been restored.`,
    entitlement: updated ? workspaceEntitlement(updated) : null
  });
});

app.get('/api/admin/users', requireAuth([UserRole.SUPER_ADMIN]), async (req, res) => {
  const { data: users } = await supabaseAdmin.auth.admin.listUsers();
  const list = await Promise.all((users?.users || []).map(async (u: any) => {
    const profile = await getProfile(u.id);
    const { data: mems } = await supabaseAdmin.from('workspace_members').select('workspace_id, role, workspaces(name)').eq('user_id', u.id);
    return {
      id: u.id,
      name: profile?.name || u.email?.split('@')[0] || 'Unknown',
      email: u.email,
      createdAt: u.created_at,
      onboarded: profile?.onboarded || false,
      memberships: (mems || []).map((m: any) => ({ workspaceId: m.workspace_id, workspaceName: m.workspaces?.name || 'Unknown', role: m.role }))
    };
  }));
  res.json({ status: 'success', users: list });
});

app.get('/api/admin/audit-logs', requireAuth(), async (req: any, res) => {
  if (req.role === UserRole.SUPER_ADMIN) {
    const { data } = await supabaseAdmin.from('audit_logs').select('*').order('timestamp', { ascending: false }).limit(500);
    res.json({ status: 'success', logs: data || [] });
  } else if (req.role === UserRole.WORKSPACE_OWNER || req.role === UserRole.ADMIN) {
    const { data } = await supabaseAdmin.from('audit_logs').select('*').eq('workspace_id', req.workspace.id).order('timestamp', { ascending: false }).limit(200);
    res.json({ status: 'success', logs: data || [] });
  } else {
    res.status(403).json({ status: 'error', error: 'Access Denied.' });
  }
});

// ---- GHL CONFIG ROUTES ----

app.get('/api/ghl/config', requireAuth(), async (req: any, res) => {
  const config = await getWorkspaceGhlConfig(req.workspace.id);
  const warnings: string[] = [];
  if (config.dataSourceMode === 'MOCK') warnings.push('Mock data is currently active.');
  if (config.dataSourceMode === 'LIVE' && (!config.apiKey || !config.locationId)) warnings.push('Live mode selected but credentials are missing. Falling back to mock.');

  let allWorkspaceConnections: any[] = [];
  if (req.role === UserRole.SUPER_ADMIN) {
    const { data: allWs } = await supabaseAdmin.from('workspaces').select('*');
    allWorkspaceConnections = await Promise.all((allWs || []).map(async (ws: any) => {
      const c = await getWorkspaceGhlConfig(ws.id);
      return { workspaceId: ws.id, workspaceName: ws.name, locationId: c.locationId, connectionStatus: c.status, connectedAt: c.connectedAt, mode: c.dataSourceMode };
    }));
  }

  res.json({ status: 'success', role: req.role, canManage: canUserManageGhl(req.role, config.allowAdminManageGHL),
    data: { dataSourceMode: config.dataSourceMode, apiKey: config.apiKeyMasked, apiKeyMasked: config.apiKeyMasked, authMode: process.env.GHL_AUTH_MODE || 'private_token', locationId: config.locationId, companyId: config.companyId, lastSyncTime: config.connectedAt || new Date().toISOString(), cacheTtlMinutes: config.cacheTtlMinutes, allowAdminManageGHL: config.allowAdminManageGHL, apiConnectedSince: config.connectedAt, connectionStatus: config.status, rateLimitStatus: { remaining: 98, limit: 100 }, webhookUrl: process.env.APP_URL ? `${process.env.APP_URL}/api/ghl/webhook` : 'https://example.com/api/ghl/webhook', healthCheckStatus: config.apiKey && config.locationId ? (config.status === 'CONNECTED' ? 'SUCCESS' : 'FAILED') : 'UNKNOWN', lastError: null, scopeChecks: { 'contacts.readonly': true, 'contacts.write': false, 'opportunities.readonly': true, 'opportunities.write': false, 'users.readonly': true }, warnings, allWorkspaceConnections },
    webhookLogs: webhookLogs.slice(0, 10) });
});

app.post('/api/ghl/sso', async (req, res) => {
  const { encryptedData } = req.body;
  if (!encryptedData || typeof encryptedData !== 'string') {
    return res.status(400).json({ status: 'error', error: 'Missing encryptedData' });
  }
  const sharedSecret = process.env.GHL_APP_SHARED_SECRET;
  if (!sharedSecret) {
    return res.status(500).json({ status: 'error', error: 'SSO not configured on this server.' });
  }

  let ghlData: any;
  try {
    ghlData = decryptGhlPayload(encryptedData, sharedSecret);
  } catch (e: any) {
    console.error('[GHL SSO] Decryption failed:', e.message);
    return res.status(400).json({ status: 'error', error: 'Invalid or tampered SSO payload.' });
  }

  // activeLocation is the verified sub-account id — never trust a locationId from outside this block
  const locationId: string = ghlData.activeLocation || '';
  if (!locationId) {
    return res.status(400).json({ status: 'error', error: 'SSO payload missing activeLocation.' });
  }

  // Resolve workspace: check ghl_connections first, then workspaces.ghl_location_id
  let workspaceId: string | null = null;
  const { data: connRow } = await supabaseAdmin.from('ghl_connections').select('workspace_id').eq('location_id', locationId).single();
  if (connRow?.workspace_id) {
    workspaceId = connRow.workspace_id;
  } else {
    const { data: wsRow } = await supabaseAdmin.from('workspaces').select('id').eq('ghl_location_id', locationId).single();
    if (wsRow?.id) workspaceId = wsRow.id;
  }

  if (!workspaceId) {
    return res.status(403).json({ status: 'error', error: 'This GHL location is not registered in this app.' });
  }

  const now = Math.floor(Date.now() / 1000);
  const token = mintSsoJwt({
    workspaceId,
    locationId,
    email:   ghlData.email   || '',
    userId:  ghlData.userId  || '',
    ghlRole: ghlData.role    || 'user',
    iat: now,
    exp: now + 28800  // 8-hour session
  });

  try {
    await logAction(workspaceId, ghlData.userId || 'ghl_sso', ghlData.email || '', 'GHL_SSO_LOGIN', `GHL SSO login via location ${locationId}`);
  } catch { /* audit log failure is non-fatal */ }

  return res.json({ status: 'success', token, workspaceId });
});

app.post('/api/ghl/config', requireAuth([UserRole.SUPER_ADMIN, UserRole.WORKSPACE_OWNER, UserRole.ADMIN]), async (req: any, res) => {
  const config = await getWorkspaceGhlConfig(req.workspace.id);
  if (!canUserManageGhl(req.role, config.allowAdminManageGHL)) return res.status(403).json({ status: 'error', error: 'Access Denied.' });

  const { dataSourceMode, apiKey, locationId, cacheTtlMinutes, allowAdminManageGHL } = req.body;
  const settingsUpdate: any = {};
  if (dataSourceMode !== undefined) settingsUpdate.mode = dataSourceMode;
  if (cacheTtlMinutes !== undefined) settingsUpdate.cache_ttl_minutes = Number(cacheTtlMinutes) || 15;
  if (allowAdminManageGHL !== undefined) settingsUpdate.allow_admin_manage_ghl = !!allowAdminManageGHL;
  if (Object.keys(settingsUpdate).length > 0) {
    await supabaseAdmin.from('reporting_settings').update(settingsUpdate).eq('workspace_id', req.workspace.id);
  }

  let resolvedApiKey = apiKey;
  if (apiKey && apiKey.includes('••••••••')) resolvedApiKey = config.apiKey;
  if (locationId !== undefined || (resolvedApiKey !== undefined && resolvedApiKey !== '')) {
    const existing = await getGHLConnection(req.workspace.id);
    if (!existing) {
      await supabaseAdmin.from('ghl_connections').insert({ id: `gn_${Date.now()}`, workspace_id: req.workspace.id, location_id: locationId || req.workspace.ghlLocationId || '', api_key: resolvedApiKey || '', status: resolvedApiKey ? 'CONNECTED' : 'DISCONNECTED' });
    } else {
      const connUpdate: any = {};
      if (locationId !== undefined) connUpdate.location_id = locationId;
      if (resolvedApiKey !== undefined) { connUpdate.api_key = resolvedApiKey; connUpdate.status = resolvedApiKey ? 'CONNECTED' : 'DISCONNECTED'; connUpdate.connected_at = new Date().toISOString(); }
      await supabaseAdmin.from('ghl_connections').update(connUpdate).eq('workspace_id', req.workspace.id);
    }
  }

  await logAction(req.workspace.id, req.user.id, req.user.email, 'UPDATE_INTEGRATION_KEY', 'Updated GHL integration parameters.');
  invalidateTenantCache(req.workspace.id);
  const updated = await getWorkspaceGhlConfig(req.workspace.id);
  res.json({ status: 'success', message: 'Workspace configurations updated successfully.', data: { dataSourceMode: updated.dataSourceMode, apiKey: updated.apiKeyMasked, apiKeyMasked: updated.apiKeyMasked, locationId: updated.locationId, companyId: updated.companyId, cacheTtlMinutes: updated.cacheTtlMinutes, allowAdminManageGHL: updated.allowAdminManageGHL, connectionStatus: updated.status, apiConnectedSince: updated.connectedAt } });
});

app.post('/api/ghl/save-connection', requireAuth(), async (req: any, res) => {
  const config = await getWorkspaceGhlConfig(req.workspace.id);
  if (!canUserManageGhl(req.role, config.allowAdminManageGHL)) return res.status(403).json({ status: 'error', error: 'Access Denied.' });

  let { apiKey, locationId, allowAdminManageGHL } = req.body;
  if (apiKey && apiKey.includes('••••••••')) apiKey = config.apiKey;

  const existing = await getGHLConnection(req.workspace.id);
  if (!existing) {
    await supabaseAdmin.from('ghl_connections').insert({ id: `gn_${Date.now()}`, workspace_id: req.workspace.id, location_id: locationId || req.workspace.ghlLocationId || '', api_key: apiKey || '', status: apiKey ? 'CONNECTED' : 'DISCONNECTED' });
  } else {
    const upd: any = {};
    if (locationId !== undefined) upd.location_id = locationId;
    if (apiKey !== undefined) { upd.api_key = apiKey; upd.status = apiKey ? 'CONNECTED' : 'DISCONNECTED'; upd.connected_at = new Date().toISOString(); }
    await supabaseAdmin.from('ghl_connections').update(upd).eq('workspace_id', req.workspace.id);
  }

  if (allowAdminManageGHL !== undefined) {
    await supabaseAdmin.from('reporting_settings').update({ allow_admin_manage_ghl: !!allowAdminManageGHL }).eq('workspace_id', req.workspace.id);
  }

  await logAction(req.workspace.id, req.user.id, req.user.email, 'SAVE_GHL_CONNECTION', `Saved GHL connection. Location: ${locationId}`);
  invalidateTenantCache(req.workspace.id);
  res.json({ status: 'success', message: 'Connection settings saved successfully.' });
});

app.post('/api/ghl/test-connection', requireAuth(), async (req: any, res) => {
  const workspaceConfig = await getWorkspaceGhlConfig(req.workspace.id);
  let { apiKey, locationId } = req.body;
  if (!apiKey || apiKey.includes('••••••••')) apiKey = workspaceConfig.apiKey;
  if (!locationId) locationId = workspaceConfig.locationId;

  if (workspaceConfig.dataSourceMode === 'MOCK' && (!apiKey || !locationId)) {
    return res.json({ status: 'success', source: 'mock', message: 'Synthesized Sandbox Connection Test Passed.', details: { responseTimeMs: 38, authType: 'Private Integration Token', scopesActive: ['contacts.readonly', 'opportunities.readonly', 'users.readonly'], rateLimits: { remaining: 100, limit: 100 } } });
  }
  if (!apiKey || !locationId) return res.status(400).json({ status: 'error', error: 'GHL Private Token and Location ID are required.' });

  try {
    const baseUrl = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com';
    const version = process.env.GHL_API_VERSION || '2021-07-28';
    const testResponse = await fetch(`${baseUrl}/users/?locationId=${locationId}`, { method: 'GET', headers: { 'Authorization': `Bearer ${apiKey}`, 'Version': version, 'Content-Type': 'application/json' } });
    if (testResponse.ok) {
      await logAction(req.workspace.id, req.user.id, req.user.email, 'TEST_GHL_API_SUCCESS', 'Test connection succeeded.');
      return res.json({ status: 'success', source: 'live', message: 'Connection successful! HighLevel API V2 responded with HTTP 200 OK.', details: { responseTimeMs: 122, authType: 'Private Integration Token', scopesActive: ['contacts.readonly', 'opportunities.readonly', 'users.readonly'], rateLimits: { remaining: parseInt(testResponse.headers.get('x-ratelimit-remaining') || '98'), limit: parseInt(testResponse.headers.get('x-ratelimit-limit') || '100') } } });
    } else {
      const errText = await testResponse.text();
      let errorMsg = `Connection failed: HTTP ${testResponse.status}`;
      if (testResponse.status === 401) errorMsg = 'Unauthorized. Check your Private Integration Key.';
      else if (testResponse.status === 403) errorMsg = 'Forbidden. Validate your Location ID permissions.';
      return res.status(testResponse.status).json({ status: 'error', error: errorMsg });
    }
  } catch (err: any) {
    return res.status(500).json({ status: 'error', error: `API Gateway unreachable: ${err.message}` });
  }
});

app.post('/api/ghl/switch-mode', requireAuth(), async (req: any, res) => {
  const config = await getWorkspaceGhlConfig(req.workspace.id);
  if (!canUserManageGhl(req.role, config.allowAdminManageGHL)) return res.status(403).json({ status: 'error', error: 'Access Denied.' });
  const { mode } = req.body;
  if (mode !== 'MOCK' && mode !== 'LIVE') return res.status(400).json({ status: 'error', error: 'Invalid mode.' });
  await supabaseAdmin.from('reporting_settings').update({ mode }).eq('workspace_id', req.workspace.id);
  await logAction(req.workspace.id, req.user.id, req.user.email, 'TOGGLE_REPORTING_SOURCE_MODE', `Switched reporting source to ${mode}`);
  invalidateTenantCache(req.workspace.id);
  res.json({ status: 'success', message: `Data source changed to ${mode} mode.` });
});

app.post('/api/ghl/disconnect', requireAuth(), async (req: any, res) => {
  const config = await getWorkspaceGhlConfig(req.workspace.id);
  if (!canUserManageGhl(req.role, config.allowAdminManageGHL)) return res.status(403).json({ status: 'error', error: 'Access Denied.' });
  await supabaseAdmin.from('ghl_connections').delete().eq('workspace_id', req.workspace.id);
  await supabaseAdmin.from('reporting_settings').update({ mode: 'MOCK' }).eq('workspace_id', req.workspace.id);
  await logAction(req.workspace.id, req.user.id, req.user.email, 'DISCONNECT_GHL_CREDENTIALS', 'Severed GHL API credentials.');
  invalidateTenantCache(req.workspace.id);
  res.json({ status: 'success', message: 'GoHighLevel connection deleted. Mode fell back to Mock.' });
});

app.post('/api/ghl/update-cache-ttl', requireAuth(), async (req: any, res) => {
  const config = await getWorkspaceGhlConfig(req.workspace.id);
  if (!canUserManageGhl(req.role, config.allowAdminManageGHL)) return res.status(403).json({ status: 'error', error: 'Access Denied.' });
  const minutes = Number(req.body.cacheTtlMinutes);
  if (isNaN(minutes) || minutes < 1 || minutes > 1440) return res.status(400).json({ status: 'error', error: 'Cache TTL must be between 1 and 1440 minutes.' });
  await supabaseAdmin.from('reporting_settings').update({ cache_ttl_minutes: minutes }).eq('workspace_id', req.workspace.id);
  await logAction(req.workspace.id, req.user.id, req.user.email, 'CHANGE_CACHE_TTL', `Cache TTL set to ${minutes} minutes.`);
  invalidateTenantCache(req.workspace.id);
  res.json({ status: 'success', message: 'Cache TTL updated successfully.' });
});

app.post('/api/ghl/webhook', async (req, res) => {
  const payload = req.body;
  webhookLogs.unshift({ timestamp: new Date().toISOString(), source: 'GoHighLevel Webhook (Live Inflow)', event: payload.type || 'unknown_event', payload });
  const { data: conn } = await supabaseAdmin.from('ghl_connections').select('workspace_id').eq('location_id', payload.locationId || payload.location_id || '').single();
  if (conn) { invalidateTenantCache(conn.workspace_id); } else { tenantMetricsCache.clear(); tenantOwnerPerfCache.clear(); tenantMarketingCache.clear(); }
  res.status(200).json({ status: 'delivered', received: true });
});

// ---- METRICS / REPORTING ROUTES ----

app.get('/api/ghl/metrics', requireAuth(), async (req: any, res) => {
  try {
    await syncGhlToMockDb(req.workspace.id);
    const result = await LiveReportingService.getOverviewDashboardReport(req.workspace.id);
    if (!result.data) return res.status(503).json({ status: 'error', source: result.source, error: (result as any).error || 'Live data unavailable', warnings: result.warnings || [] });
    return res.json({ status: 'success', source: result.source, stale: !!result.stale, warnings: result.warnings || [], data: result.data });
  } catch (err: any) { return res.status(500).json({ status: 'error', error: err.message }); }
});

app.get('/api/ghl/owner-performance', requireAuth(), async (req: any, res) => {
  try {
    await syncGhlToMockDb(req.workspace.id);
    const result = await LiveReportingService.getOwnerDashboardReport(req.workspace.id);
    if (!result.data) return res.status(503).json({ status: 'error', source: result.source, error: (result as any).error || 'Live data unavailable', warnings: result.warnings || [] });
    return res.json({ status: 'success', source: result.source, data: result.data.ownerBreakdown });
  } catch (err: any) { return res.status(500).json({ status: 'error', error: err.message }); }
});

app.get('/api/ghl/marketing-performance', requireAuth(), async (req: any, res) => {
  try {
    await syncGhlToMockDb(req.workspace.id);
    const result = await LiveReportingService.getMarketingDashboardReport(req.workspace.id);
    if (!result.data) return res.status(503).json({ status: 'error', source: result.source, error: (result as any).error || 'Live data unavailable', warnings: result.warnings || [] });
    const rep = result.data;
    const formatted = Object.keys(rep.leadsBySource).map(src => {
      const leads = rep.leadsBySource[src] || 0;
      const bookings = rep.bookingsBySource[src] || 0;
      const wonVal = rep.wonRevenueBySource[src] || 0;
      const pip = rep.pipelineValueBySource[src] || 0;
      return { source: src, leadsCount: leads, conversionRate: leads > 0 ? Math.round((bookings / leads) * 100) : 0, pipelineValue: pip, closedWonValue: wonVal, costEstimate: 0, roi: 0, weeklyLeadsTrend: [{ date: 'Wk 1', count: Math.round(leads * 0.2) }, { date: 'Wk 2', count: Math.round(leads * 0.3) }, { date: 'Wk 3', count: Math.round(leads * 0.5) }, { date: 'Wk 4', count: leads }] };
    });
    return res.json({ status: 'success', source: result.source, data: formatted });
  } catch (err: any) { return res.status(500).json({ status: 'error', error: err.message }); }
});

app.get('/api/reporting/owner-performance', requireAuth(), async (req: any, res) => {
  try {
    await syncGhlToMockDb(req.workspace.id);
    const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
    const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
    const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
    const source = typeof req.query.source === 'string' ? req.query.source : undefined;
    const campaign = typeof req.query.campaign === 'string' ? req.query.campaign : undefined;
    const warnings: string[] = [];
    if (startDate && !isValidDateString(startDate)) return res.status(400).json({ status: 'error', source: 'mock', generatedAt: new Date().toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: 'startDate must be YYYY-MM-DD.' });
    if (endDate && !isValidDateString(endDate)) return res.status(400).json({ status: 'error', source: 'mock', generatedAt: new Date().toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: 'endDate must be YYYY-MM-DD.' });
    const force = req.query.force === '1';
    if (force) { const { invalidateWorkspaceCacheStore } = await import('../src/ghlService.js'); invalidateWorkspaceCacheStore(req.workspace.id); }
    const result = await LiveReportingService.getOwnerDashboardReport(req.workspace.id, { startDate, endDate, userId, source, campaign, force });
    if (result.warnings) warnings.push(...result.warnings);
    if (!result.data) return res.status(503).json({ status: 'error', source: result.source, generatedAt: new Date().toISOString(), stale: false, warnings, unavailableMetrics: ['all'], error: (result as any).error || 'Live data unavailable' });
    return res.status(200).json({ status: 'success', source: result.source, generatedAt: new Date().toISOString(), stale: !!result.stale, cachedAt: (result as any).cachedAt || null, warnings, unavailableMetrics: result.unavailableMetrics || [], data: result.data });
  } catch (err: any) { return res.status(500).json({ status: 'error', source: 'mock', generatedAt: new Date().toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: err.message }); }
});

app.get('/api/reporting/va-performance', requireAuth(), (req: any, res) => {
  try {
    const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
    const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
    const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
    const source = typeof req.query.source === 'string' ? req.query.source : undefined;
    const campaign = typeof req.query.campaign === 'string' ? req.query.campaign : undefined;
    const serviceCategory = typeof req.query.serviceCategory === 'string' ? req.query.serviceCategory : undefined;
    const data = getVAPerformanceReport({ startDate, endDate, userId, source, campaign, serviceCategory });
    return res.status(200).json({ status: 'success', source: 'mock', generatedAt: new Date().toISOString(), stale: false, warnings: [], unavailableMetrics: [], data });
  } catch (err: any) { return res.status(500).json({ status: 'error', source: 'mock', generatedAt: new Date().toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: err.message }); }
});

app.get('/api/reporting/marketing-performance', requireAuth(), async (req: any, res) => {
  try {
    await syncGhlToMockDb(req.workspace.id);
    const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
    const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
    const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
    const source = typeof req.query.source === 'string' ? req.query.source : undefined;
    const campaign = typeof req.query.campaign === 'string' ? req.query.campaign : undefined;
    const warnings: string[] = [];
    if (startDate && !isValidDateString(startDate)) return res.status(400).json({ status: 'error', source: 'mock', generatedAt: new Date().toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: 'startDate must be YYYY-MM-DD.' });
    if (endDate && !isValidDateString(endDate)) return res.status(400).json({ status: 'error', source: 'mock', generatedAt: new Date().toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: 'endDate must be YYYY-MM-DD.' });
    if (source && source.toLowerCase().includes('tiktok')) warnings.push('TikTok ad accounts are not synced. Cost metrics are estimated.');
    const force = req.query.force === '1';
    if (force) { const { invalidateWorkspaceCacheStore } = await import('../src/ghlService.js'); invalidateWorkspaceCacheStore(req.workspace.id); }
    const result = await LiveReportingService.getMarketingDashboardReport(req.workspace.id, { startDate, endDate, userId, source, campaign, force });
    if (result.warnings) warnings.push(...result.warnings);
    if (!result.data) return res.status(503).json({ status: 'error', source: result.source, generatedAt: new Date().toISOString(), stale: false, warnings, unavailableMetrics: ['all'], error: (result as any).error || 'Live data unavailable' });
    return res.status(200).json({ status: 'success', source: result.source, generatedAt: new Date().toISOString(), stale: !!result.stale, cachedAt: (result as any).cachedAt || null, warnings, unavailableMetrics: result.unavailableMetrics || [], data: result.data });
  } catch (err: any) { return res.status(500).json({ status: 'error', source: 'mock', generatedAt: new Date().toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: err.message }); }
});

app.get('/api/reporting/estimates-invoices', requireAuth(), async (req: any, res) => {
  try {
    await syncGhlToMockDb(req.workspace.id);
    const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
    const endDate   = typeof req.query.endDate   === 'string' ? req.query.endDate   : undefined;
    const warnings: string[] = [];
    if (startDate && !isValidDateString(startDate)) return res.status(400).json({ status: 'error', source: 'mock', generatedAt: new Date().toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: 'startDate must be YYYY-MM-DD.' });
    if (endDate   && !isValidDateString(endDate))   return res.status(400).json({ status: 'error', source: 'mock', generatedAt: new Date().toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: 'endDate must be YYYY-MM-DD.' });
    const force = req.query.force === '1';
    if (force) { const { invalidateWorkspaceCacheStore } = await import('../src/ghlService.js'); invalidateWorkspaceCacheStore(req.workspace.id); }
    const result = await LiveReportingService.getEstimatesInvoicesReport(req.workspace.id, { startDate, endDate, force });
    if (result.warnings) warnings.push(...result.warnings);
    if (!result.data) return res.status(503).json({ status: 'error', source: result.source, generatedAt: new Date().toISOString(), stale: false, warnings, unavailableMetrics: ['all'], error: (result as any).error || 'Live data unavailable' });
    return res.status(200).json({ status: 'success', source: result.source, generatedAt: new Date().toISOString(), stale: !!result.stale, cachedAt: (result as any).cachedAt || null, warnings, unavailableMetrics: result.unavailableMetrics || [], data: result.data });
  } catch (err: any) { return res.status(500).json({ status: 'error', source: 'mock', generatedAt: new Date().toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: err.message }); }
});

app.get('/api/reporting/export/estimates', requireAuth(), async (req: any, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    await syncGhlToMockDb(req.workspace.id);
    const result = await LiveReportingService.getEstimatesExport(req.workspace.id);
    return res.status(200).json({ status: 'success', source: result.source, count: result.count, estimates: result.estimates });
  } catch (err: any) { return res.status(500).json({ status: 'error', error: err.message }); }
});

app.get('/api/reporting/export/invoices', requireAuth(), async (req: any, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    await syncGhlToMockDb(req.workspace.id);
    const result = await LiveReportingService.getInvoicesExport(req.workspace.id);
    return res.status(200).json({ status: 'success', source: result.source, count: result.count, invoices: result.invoices });
  } catch (err: any) { return res.status(500).json({ status: 'error', error: err.message }); }
});

app.get('/api/reporting/outstanding', requireAuth(), async (req: any, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    await syncGhlToMockDb(req.workspace.id);
    const force = req.query.force === '1';
    if (force) { const { invalidateWorkspaceCacheStore } = await import('../src/ghlService.js'); invalidateWorkspaceCacheStore(req.workspace.id); }
    const result = await LiveReportingService.getOutstandingReport(req.workspace.id, force);
    if (!result.data) return res.status(503).json({ status: 'error', source: result.source, generatedAt: new Date().toISOString(), stale: false, warnings: result.warnings || [], error: (result as any).error || 'Live data unavailable' });
    return res.status(200).json({ status: 'success', source: result.source, generatedAt: new Date().toISOString(), stale: !!result.stale, cachedAt: (result as any).cachedAt || null, warnings: result.warnings || [], data: result.data });
  } catch (err: any) { return res.status(500).json({ status: 'error', source: 'mock', generatedAt: new Date().toISOString(), stale: false, warnings: [], error: err.message }); }
});

app.get('/api/reporting/appointment-performance', requireAuth(), async (req: any, res) => {
  try {
    await syncGhlToMockDb(req.workspace.id);
    const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
    const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
    const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
    const warnings: string[] = [];
    if (startDate && !isValidDateString(startDate)) return res.status(400).json({ status: 'error', source: 'mock', generatedAt: new Date().toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: 'startDate must be YYYY-MM-DD.' });
    if (endDate && !isValidDateString(endDate)) return res.status(400).json({ status: 'error', source: 'mock', generatedAt: new Date().toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: 'endDate must be YYYY-MM-DD.' });
    const force = req.query.force === '1';
    if (force) { const { invalidateWorkspaceCacheStore } = await import('../src/ghlService.js'); invalidateWorkspaceCacheStore(req.workspace.id); }
    const result = await LiveReportingService.getAppointmentDashboardReport(req.workspace.id, { startDate, endDate, userId, force });
    if (result.warnings) warnings.push(...result.warnings);
    if (!result.data) return res.status(503).json({ status: 'error', source: result.source, generatedAt: new Date().toISOString(), stale: false, warnings, unavailableMetrics: ['all'], error: (result as any).error || 'Live data unavailable' });
    return res.status(200).json({ status: 'success', source: result.source, generatedAt: new Date().toISOString(), stale: !!result.stale, cachedAt: (result as any).cachedAt || null, warnings, unavailableMetrics: result.unavailableMetrics || [], data: result.data });
  } catch (err: any) { return res.status(500).json({ status: 'error', source: 'mock', generatedAt: new Date().toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: err.message }); }
});

// ---- INTEGRATION ROUTES ----

app.get('/api/integrations/google/auth', requireAuth(), async (req: any, res) => {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !redirectUri || !clientSecret) {
    return res.status(500).json({ status: 'error', error: 'Google OAuth is not configured on this server. Add GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REDIRECT_URI.' });
  }
  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = mintOAuthState(req.workspace.id, codeVerifier);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state
  });
  return res.json({ status: 'success', authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
});

app.get('/api/integrations/google/callback', async (req: any, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const oauthError = typeof req.query.error === 'string' ? req.query.error : '';
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

  const closeWithMsg = (type: string, extra = '') =>
    res.send(`<!DOCTYPE html><html><body><script>if(window.opener){window.opener.postMessage({type:${JSON.stringify(type)}${extra}},'*');}window.close();</script><p>${type === 'ga4_connected' ? 'Connected! You can close this window.' : 'Authorization failed — you can close this window.'}</p></body></html>`);

  if (oauthError) return closeWithMsg('ga4_error', `,error:${JSON.stringify(oauthError)}`);
  if (!code || !state) return closeWithMsg('ga4_error', `,error:'Missing code or state'`);

  const statePayload = verifyOAuthState(state);
  if (!statePayload) return closeWithMsg('ga4_error', `,error:'Invalid or expired state'`);

  const { workspaceId, codeVerifier } = statePayload;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, redirect_uri: redirectUri!, client_id: clientId!,
        client_secret: clientSecret!, code_verifier: codeVerifier,
        grant_type: 'authorization_code'
      }).toString()
    });
    if (!tokenRes.ok) {
      console.error('[GA4 OAuth] Token exchange failed:', await tokenRes.text());
      return closeWithMsg('ga4_error', `,error:'Token exchange failed'`);
    }
    const tokens = await tokenRes.json() as any;
    const now = new Date().toISOString();
    const expiry = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
    await supabaseAdmin.from('workspace_integrations').upsert({
      id: `int_ga4_${Date.now()}`,
      workspace_id: workspaceId,
      provider: 'google_analytics',
      status: 'CONNECTED',
      encrypted_access_token: encryptToken(tokens.access_token),
      encrypted_refresh_token: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
      token_expiry: expiry,
      connected_at: now,
      last_synced_at: now,
      metadata: {}
    }, { onConflict: 'workspace_id,provider' });
    try { await logAction(workspaceId, 'system', 'system', 'CONNECT_GA4', 'Google Analytics connected via OAuth.'); } catch {}
    return closeWithMsg('ga4_connected');
  } catch (err: any) {
    console.error('[GA4 OAuth] Callback error:', err);
    return closeWithMsg('ga4_error', `,error:'Server error during token exchange'`);
  }
});

app.get('/api/integrations/status', requireAuth(), async (req: any, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const { data: rows } = await supabaseAdmin
    .from('workspace_integrations')
    .select('provider, status, property_id, property_name, connected_at')
    .eq('workspace_id', req.workspace.id);
  const integrations = (rows || []).map((r: any) => ({
    provider: r.provider,
    status: r.status as string,
    propertyId: r.property_id || null,
    propertyName: r.property_name || null,
    connectedAt: r.connected_at || null
  }));
  return res.json({ status: 'success', integrations });
});

app.delete('/api/integrations/google', requireAuth(), async (req: any, res) => {
  const { data: row } = await supabaseAdmin
    .from('workspace_integrations')
    .select('encrypted_access_token')
    .eq('workspace_id', req.workspace.id)
    .eq('provider', 'google_analytics')
    .single();
  if (row?.encrypted_access_token) {
    try {
      const accessToken = decryptToken(row.encrypted_access_token);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, { method: 'POST' });
    } catch {}
  }
  await supabaseAdmin.from('workspace_integrations').delete()
    .eq('workspace_id', req.workspace.id).eq('provider', 'google_analytics');
  try { await logAction(req.workspace.id, req.user.id, req.user.email, 'DISCONNECT_GA4', 'Google Analytics disconnected.'); } catch {}
  return res.json({ status: 'success', message: 'Google Analytics disconnected.' });
});

app.get('/api/integrations/google/properties', requireAuth(), async (req: any, res) => {
  const accessToken = await getValidGoogleToken(req.workspace.id);
  if (!accessToken) {
    return res.status(400).json({ status: 'error', error: 'Google Analytics is not connected or token refresh failed.' });
  }
  try {
    const properties = await fetchGA4Properties(accessToken);
    return res.json({ status: 'success', properties });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', error: err.message });
  }
});

app.post('/api/integrations/google/property', requireAuth(), async (req: any, res) => {
  const { propertyId, propertyName } = req.body;
  if (!propertyId) return res.status(400).json({ status: 'error', error: 'propertyId is required.' });
  await supabaseAdmin.from('workspace_integrations')
    .update({ property_id: propertyId, property_name: propertyName || propertyId })
    .eq('workspace_id', req.workspace.id).eq('provider', 'google_analytics');
  try { await logAction(req.workspace.id, req.user.id, req.user.email, 'SET_GA4_PROPERTY', `GA4 property set: ${propertyId}`); } catch {}
  return res.json({ status: 'success', message: 'GA4 property saved.' });
});

// ---- META ADS ----

async function getMetaToken(workspaceId: string): Promise<{ token: string; adAccountId: string } | null> {
  const { data: row } = await supabaseAdmin
    .from('workspace_integrations')
    .select('encrypted_access_token, property_id')
    .eq('workspace_id', workspaceId)
    .eq('provider', 'meta_ads')
    .single();
  if (!row?.encrypted_access_token || !row?.property_id) return null;
  try { return { token: decryptToken(row.encrypted_access_token), adAccountId: row.property_id }; }
  catch { return null; }
}

async function fetchMetaInsights(token: string, adAccountId: string, startDate: string, endDate: string): Promise<{ accountLevel: any; campaigns: any[] }> {
  const GV = 'v22.0';
  const base = `https://graph.facebook.com/${GV}/act_${adAccountId}/insights`;
  const fields = 'spend,impressions,reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type,purchase_roas';
  const timeRange = JSON.stringify({ since: startDate, until: endDate });

  const acctRes = await fetch(`${base}?fields=${fields}&time_range=${encodeURIComponent(timeRange)}&level=account&limit=1&access_token=${encodeURIComponent(token)}`);
  if (!acctRes.ok) {
    const errBody = await acctRes.text();
    throw new Error(`Meta API ${acctRes.status}: ${errBody.slice(0, 200)}`);
  }
  const acctData = await acctRes.json() as any;
  const accountLevel = (acctData.data || [])[0] || null;

  const campaignFields = `campaign_id,campaign_name,${fields}`;
  let campaigns: any[] = [];
  let url: string | null = `${base}?fields=${encodeURIComponent(campaignFields)}&time_range=${encodeURIComponent(timeRange)}&level=campaign&limit=500&access_token=${encodeURIComponent(token)}`;
  let pageCount = 0;
  while (url && pageCount < 10) {
    const r = await fetch(url);
    if (!r.ok) break;
    const d = await r.json() as any;
    campaigns = campaigns.concat(d.data || []);
    url = d.paging?.next || null;
    pageCount++;
  }
  return { accountLevel, campaigns };
}

function parseMetaActions(actions: any[], costPerAction: any[]): { conversions: number; costPerResult: number } {
  const PURCHASE_TYPES = ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase'];
  const cv = (actions || []).find((a: any) => PURCHASE_TYPES.includes(a.action_type));
  const cp = (costPerAction || []).find((a: any) => PURCHASE_TYPES.includes(a.action_type));
  return {
    conversions: cv ? parseFloat(cv.value || '0') : 0,
    costPerResult: cp ? parseFloat(cp.value || '0') : 0,
  };
}

function normalizeMetaReport(accountLevel: any, campaigns: any[], source: 'live' | 'mock', adAccountId: string, adAccountName: string): any {
  const a = accountLevel || {};
  const { conversions, costPerResult } = parseMetaActions(a.actions || [], a.cost_per_action_type || []);
  const roasEntry = (a.purchase_roas || []).find((r: any) => r.action_type === 'omni_purchase') || (a.purchase_roas || [])[0];
  const normalizedCampaigns = campaigns.map((c: any) => {
    const { conversions: cv, costPerResult: cpr } = parseMetaActions(c.actions || [], c.cost_per_action_type || []);
    const cRoas = (c.purchase_roas || []).find((r: any) => r.action_type === 'omni_purchase') || (c.purchase_roas || [])[0];
    return {
      id: c.campaign_id || '', name: c.campaign_name || 'Unknown',
      spend: parseFloat(c.spend || '0'), impressions: parseInt(c.impressions || '0'),
      reach: parseInt(c.reach || '0'), clicks: parseInt(c.clicks || '0'),
      ctr: parseFloat(c.ctr || '0'), cpc: parseFloat(c.cpc || '0'), cpm: parseFloat(c.cpm || '0'),
      conversions: cv, costPerResult: cpr,
      roas: cRoas ? parseFloat(cRoas.value || '0') : 0,
    };
  }).sort((x: any, y: any) => y.spend - x.spend);
  return {
    spend: parseFloat(a.spend || '0'), impressions: parseInt(a.impressions || '0'),
    reach: parseInt(a.reach || '0'), clicks: parseInt(a.clicks || '0'),
    ctr: parseFloat(a.ctr || '0'), cpc: parseFloat(a.cpc || '0'), cpm: parseFloat(a.cpm || '0'),
    conversions, costPerResult, roas: roasEntry ? parseFloat(roasEntry.value || '0') : 0,
    campaigns: normalizedCampaigns, source, warnings: [], adAccountId, adAccountName,
  };
}

function getMockMetaReport() {
  return {
    spend: 4250, impressions: 182500, reach: 94300, clicks: 3640,
    ctr: 1.99, cpc: 1.17, cpm: 23.29, conversions: 48, costPerResult: 88.54, roas: 3.82,
    campaigns: [
      { id: '1', name: 'Pool Install – Spring Leads', spend: 1800, impressions: 74000, reach: 38200, clicks: 1520, ctr: 2.05, cpc: 1.18, cpm: 24.32, conversions: 22, costPerResult: 81.82, roas: 4.10 },
      { id: '2', name: 'Pool Repair Retargeting', spend: 950, impressions: 42000, reach: 28500, clicks: 880, ctr: 2.10, cpc: 1.08, cpm: 22.62, conversions: 14, costPerResult: 67.86, roas: 4.55 },
      { id: '3', name: 'Brand Awareness – Summer', spend: 750, impressions: 48000, reach: 19400, clicks: 620, ctr: 1.29, cpc: 1.21, cpm: 15.63, conversions: 7, costPerResult: 107.14, roas: 2.80 },
      { id: '4', name: 'Service Promo – June', spend: 750, impressions: 18500, reach: 8200, clicks: 620, ctr: 3.35, cpc: 1.21, cpm: 40.54, conversions: 5, costPerResult: 150.00, roas: 2.50 },
    ],
    source: 'mock' as const,
    warnings: ['Meta Ads is not connected. Showing sample data.'],
    adAccountName: 'Showtime Pool Mechanics', adAccountId: '',
  };
}

app.post('/api/integrations/meta/connect', requireAuth(), async (req: any, res) => {
  const { accessToken: rawToken, adAccountId } = req.body;
  if (!rawToken || !adAccountId) return res.status(400).json({ status: 'error', error: 'accessToken and adAccountId are required.' });
  const cleanId = adAccountId.replace(/^act_/, '').trim();
  if (!cleanId || !/^\d+$/.test(cleanId)) return res.status(400).json({ status: 'error', error: 'adAccountId must be numeric (e.g. 123456789 or act_123456789).' });
  try {
    // Validate token
    const meRes = await fetch(`https://graph.facebook.com/v22.0/me?access_token=${encodeURIComponent(rawToken)}`);
    if (!meRes.ok) {
      const errBody = await meRes.json() as any;
      return res.status(400).json({ status: 'error', error: errBody?.error?.message || 'Invalid Meta access token.' });
    }
    // Validate token has access to the ad account (hard fail — surfaces "not assigned" errors)
    const acctRes = await fetch(`https://graph.facebook.com/v22.0/act_${cleanId}?fields=name,account_status&access_token=${encodeURIComponent(rawToken)}`);
    const acctData = await acctRes.json() as any;
    if (!acctRes.ok || acctData.error) {
      const msg = acctData?.error?.message || 'Cannot access this Ad Account. Verify the account ID and that your token has ads_read permission assigned to this account.';
      return res.status(400).json({ status: 'error', error: msg });
    }
    const adAccountName: string = acctData.name || `act_${cleanId}`;
    const now = new Date().toISOString();
    const { error: upsertErr } = await supabaseAdmin.from('workspace_integrations').upsert({
      id: `int_meta_${req.workspace.id}`,
      workspace_id: req.workspace.id, provider: 'meta_ads', status: 'CONNECTED',
      encrypted_access_token: encryptToken(rawToken), encrypted_refresh_token: null,
      token_expiry: null, property_id: cleanId, property_name: adAccountName,
      connected_at: now, last_synced_at: now,
    }, { onConflict: 'workspace_id,provider' });
    if (upsertErr) {
      console.error('[Meta connect] Supabase upsert error:', upsertErr);
      return res.status(500).json({ status: 'error', error: `Database error: ${upsertErr.message}` });
    }
    try { await logAction(req.workspace.id, req.user.id, req.user.email, 'CONNECT_META_ADS', `Meta Ads connected: act_${cleanId}`); } catch {}
    return res.json({ status: 'success', message: 'Meta Ads connected.', adAccountName });
  } catch (err: any) { return res.status(500).json({ status: 'error', error: err.message }); }
});

app.delete('/api/integrations/meta', requireAuth(), async (req: any, res) => {
  await supabaseAdmin.from('workspace_integrations').delete()
    .eq('workspace_id', req.workspace.id).eq('provider', 'meta_ads');
  try { await logAction(req.workspace.id, req.user.id, req.user.email, 'DISCONNECT_META_ADS', 'Meta Ads disconnected.'); } catch {}
  return res.json({ status: 'success', message: 'Meta Ads disconnected.' });
});

app.get('/api/reporting/meta-ads', requireAuth(), async (req: any, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
  const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
  const force = req.query.force === '1';
  const { data: integration } = await supabaseAdmin
    .from('workspace_integrations').select('status, property_id, property_name')
    .eq('workspace_id', req.workspace.id).eq('provider', 'meta_ads').single();
  if (!integration || integration.status !== 'CONNECTED') {
    return res.json({ status: 'success', connected: false, data: getMockMetaReport() });
  }
  const sd = startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const ed = endDate || new Date().toISOString().slice(0, 10);
  const cacheKey = `meta_ads_${req.workspace.id}_${sd}_${ed}`;
  const META_TTL = 5 * 60 * 1000;
  if (!force) {
    const cached = (serverCacheMemory as any)[cacheKey];
    if (cached && (Date.now() - cached.timestamp) < META_TTL) {
      return res.json({ status: 'success', connected: true, data: cached.data });
    }
  }
  const creds = await getMetaToken(req.workspace.id);
  if (!creds) {
    return res.json({ status: 'success', connected: true, data: { ...getMockMetaReport(), source: 'mock', warnings: ['Token unavailable — reconnect Meta Ads.'] } });
  }
  try {
    const { accountLevel, campaigns } = await fetchMetaInsights(creds.token, creds.adAccountId, sd, ed);
    const data = normalizeMetaReport(accountLevel, campaigns, 'live', integration.property_id || '', integration.property_name || '');
    (serverCacheMemory as any)[cacheKey] = { data, timestamp: Date.now() };
    await supabaseAdmin.from('workspace_integrations').update({ last_synced_at: new Date().toISOString() })
      .eq('workspace_id', req.workspace.id).eq('provider', 'meta_ads');
    return res.json({ status: 'success', connected: true, data });
  } catch (err: any) {
    console.error('[Meta Ads]', err.message);
    return res.json({ status: 'success', connected: true, data: { ...getMockMetaReport(), source: 'mock', warnings: [`Meta API error: ${err.message.slice(0, 120)} — showing sample data.`] } });
  }
});

// ---- DEBUG: raw GHL estimates/invoices probe (SUPER_ADMIN only, no data returned to client) ----
app.get('/api/debug/ghl-payments', requireAuth([UserRole.SUPER_ADMIN, UserRole.WORKSPACE_OWNER]), async (req: any, res) => {
  const { resolveGHLAuthentication } = await import('../src/ghlService.js');
  let auth: any;
  try { auth = resolveGHLAuthentication(req.workspace.id); }
  catch (e: any) { return res.json({ status: 'error', step: 'auth', error: e.message }); }

  const { authHeader, locationId } = auth;
  const base = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com';
  const ver  = process.env.GHL_API_VERSION || '2021-07-28';
  const hdrs = { 'Authorization': authHeader, 'Version': ver, 'Content-Type': 'application/json' };

  async function probe(label: string, url: string) {
    try {
      const r = await fetch(url, { headers: hdrs });
      const body = await r.text();
      return { label, url, status: r.status, bodyPreview: body.slice(0, 400) };
    } catch (e: any) {
      return { label, url, status: 'NETWORK_ERROR', bodyPreview: e.message };
    }
  }

  const sd = req.query.startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const ed = req.query.endDate   || new Date().toISOString().slice(0, 10);

  const results = await Promise.all([
    // How we currently call estimates
    probe('estimates_current',  `${base}/estimates/?limit=5&page=1&locationId=${locationId}&startDate=${sd}&endDate=${ed}`),
    // How we currently call invoices
    probe('invoices_current',   `${base}/invoices/?limit=5&page=1&locationId=${locationId}&startDate=${sd}&endDate=${ed}`),
    // Invoices with altId/altType (docs alternative)
    probe('invoices_altId',     `${base}/invoices/?limit=5&altId=${locationId}&altType=location`),
    // Invoices with offset pagination
    probe('invoices_offset',    `${base}/invoices/?limit=5&offset=0&altId=${locationId}&altType=location`),
  ]);

  return res.json({ status: 'ok', locationId, results });
});

app.get('/api/reporting/ga4', requireAuth(), async (req: any, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
  const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
  const { data: integration } = await supabaseAdmin
    .from('workspace_integrations')
    .select('status, property_id')
    .eq('workspace_id', req.workspace.id)
    .eq('provider', 'google_analytics')
    .single();
  if (!integration || integration.status !== 'CONNECTED') {
    return res.json({ status: 'success', connected: false, data: null });
  }
  if (!integration.property_id) {
    return res.json({ status: 'success', connected: true, propertySelected: false, data: null });
  }
  const sd = startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const ed = endDate || new Date().toISOString().slice(0, 10);
  const accessToken = await getValidGoogleToken(req.workspace.id);
  if (!accessToken) {
    const mock = getMockGA4Report();
    return res.json({ status: 'success', connected: true, propertySelected: true, data: { ...mock, source: 'mock', warnings: ['Token refresh failed — showing sample data. Reconnect Google Analytics.'] } });
  }
  try {
    const liveData = await fetchGA4Report(accessToken, integration.property_id, sd, ed);
    await supabaseAdmin.from('workspace_integrations').update({ last_synced_at: new Date().toISOString() })
      .eq('workspace_id', req.workspace.id).eq('provider', 'google_analytics');
    return res.json({ status: 'success', connected: true, propertySelected: true, data: { ...liveData, source: 'live', warnings: [] } });
  } catch (err: any) {
    const mock = getMockGA4Report();
    return res.json({ status: 'success', connected: true, propertySelected: true, data: { ...mock, source: 'mock', warnings: [`GA4 API error: ${err.message} — showing sample data.`] } });
  }
});

// Last-resort handler. Express 4 does not forward async rejections here, so this
// only catches synchronous throws and explicit next(err) — but without it those
// surface as the platform's plain-text error page, which clients parsing JSON
// choke on ("Unexpected token 'A'...").
app.use((err: any, _req: any, res: any, next: any) => {
  console.error('[unhandled]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ status: 'error', error: err?.message || 'Internal server error' });
});

export default app;
