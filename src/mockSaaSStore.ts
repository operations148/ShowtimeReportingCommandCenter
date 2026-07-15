import { UserRole, SaaSUser, Workspace, WorkspaceMember, GHLConnection, ReportingSettings, SubscriptionPlaceholder, AuditLog } from './types';

// Predefined mock users
export const seededUsers: SaaSUser[] = [
  { id: 'usr_super_admin', name: 'Alex Mercer (Platform Ops)', email: 'operations@showtimepoolmechanics.com', onboarded: true, createdAt: '2026-01-10T08:00:00Z' },
  { id: 'usr_owner_A', name: 'Marcus Sterling (Owner)', email: 'owner@showtime.com', onboarded: true, createdAt: '2026-02-15T09:30:00Z' },
  { id: 'usr_admin_A', name: 'Sarah Chen (Admin)', email: 'admin@showtime.com', onboarded: true, createdAt: '2026-03-01T14:15:00Z' },
  { id: 'usr_rep_A', name: 'Bobby Sales (Sales Rep)', email: 'sales@showtime.com', onboarded: true, createdAt: '2026-03-10T11:00:00Z' },
  { id: 'usr_member_A', name: 'Tyler Member (Team Member)', email: 'member@showtime.com', onboarded: true, createdAt: '2026-04-01T10:00:00Z' },
  { id: 'usr_readonly_A', name: 'Rachel Read (Read-Only)', email: 'readonly@showtime.com', onboarded: true, createdAt: '2026-04-15T16:45:00Z' },
  
  // Workspace B Client isolation users
  { id: 'usr_owner_B', name: 'Vance Refrigeration (Owner)', email: 'owner@vancepools.com', onboarded: true, createdAt: '2026-05-01T12:00:00Z' },
  { id: 'usr_readonly_B', name: 'Pam Beasley (Read-Only)', email: 'pam@vancepools.com', onboarded: true, createdAt: '2026-05-05T09:00:00Z' }
];

// Trial window for the mock trialling workspace, kept relative to now so the demo never
// rots into a permanently expired trial the way a hardcoded date would.
const MOCK_TRIAL_STARTED = new Date(Date.now() - 5 * 86400000).toISOString();
const MOCK_TRIAL_ENDS = new Date(Date.now() + 9 * 86400000).toISOString();

// Predefined mock workspaces. Between them they cover the three entitlement outcomes the
// gate can produce, so mock mode exercises the real states rather than only the happy path.
export const seededWorkspaces: Workspace[] = [
  // Converted: purchased outright, permanent access.
  {
    id: 'ws_showtime', name: 'Showtime Pool Mechanics', slug: 'showtime-pools',
    ghlLocationId: 'loc_g53h7s8a', createdAt: '2026-02-15T09:30:00Z', suspended: false,
    trialStartedAt: '2026-02-15T09:30:00Z', trialEndsAt: '2026-03-01T09:30:00Z',
    trialUsed: true, trialExtensionCount: 0,
    licenseStatus: 'LICENSED', licensedAt: '2026-02-28T10:00:00Z'
  },
  // Mid-trial: 9 days remaining.
  {
    id: 'ws_apex', name: 'Apex Blue Pools', slug: 'apex-blue',
    ghlLocationId: 'loc_apex_demo', createdAt: '2026-05-01T12:00:00Z', suspended: false,
    trialStartedAt: MOCK_TRIAL_STARTED, trialEndsAt: MOCK_TRIAL_ENDS,
    trialUsed: true, trialExtensionCount: 0,
    licenseStatus: 'NONE', licensedAt: null
  },
  // Suspended: operator override outranks its live trial.
  {
    id: 'ws_pro_clean', name: 'Pro Clean Builders', slug: 'pro-clean',
    ghlLocationId: 'loc_pro_demo', createdAt: '2026-05-05T09:00:00Z', suspended: true,
    trialStartedAt: MOCK_TRIAL_STARTED, trialEndsAt: MOCK_TRIAL_ENDS,
    trialUsed: true, trialExtensionCount: 0,
    licenseStatus: 'NONE', licensedAt: null
  }
];

// Workspace memberships linking users to workspaces with granular roles
export const seededWorkspaceMembers: WorkspaceMember[] = [
  // Super Admin of platform has access to everything, but we link them to Workspace A by default
  { id: 'mem_1', workspaceId: 'ws_showtime', userId: 'usr_super_admin', role: UserRole.SUPER_ADMIN, joinedAt: '2026-01-10T08:00:00Z' },
  
  // Workspace A Team (Showtime Pools)
  { id: 'mem_2', workspaceId: 'ws_showtime', userId: 'usr_owner_A', role: UserRole.WORKSPACE_OWNER, joinedAt: '2026-02-15T09:35:00Z' },
  { id: 'mem_3', workspaceId: 'ws_showtime', userId: 'usr_admin_A', role: UserRole.ADMIN, joinedAt: '2026-03-01T14:20:00Z' },
  { id: 'mem_4', workspaceId: 'ws_showtime', userId: 'usr_rep_A', role: UserRole.SALES_REP, joinedAt: '2026-03-10T11:05:00Z' },
  { id: 'mem_5', workspaceId: 'ws_showtime', userId: 'usr_member_A', role: UserRole.TEAM_MEMBER, joinedAt: '2026-04-01T10:05:00Z' },
  { id: 'mem_6', workspaceId: 'ws_showtime', userId: 'usr_readonly_A', role: UserRole.READ_ONLY, joinedAt: '2026-04-15T16:50:00Z' },

  // Workspace B Team (Apex Blue Pools)
  { id: 'mem_7', workspaceId: 'ws_apex', userId: 'usr_owner_B', role: UserRole.WORKSPACE_OWNER, joinedAt: '2026-05-01T12:05:00Z' },
  { id: 'mem_8', workspaceId: 'ws_apex', userId: 'usr_readonly_B', role: UserRole.READ_ONLY, joinedAt: '2026-05-05T09:05:00Z' }
];

// GoHighLevel Connection mappings per Client Workspace
export const seededGHLConnections: GHLConnection[] = [
  { id: 'gn_1', workspaceId: 'ws_showtime', locationId: 'loc_g53h7s8a', apiKey: 'ghl_live_token_sec_key_xyz_001', connectedAt: '2026-02-16T10:00:00Z', status: 'CONNECTED' },
  { id: 'gn_2', workspaceId: 'ws_apex', locationId: 'loc_apex_demo', apiKey: 'ghl_live_token_sec_key_abc_992', connectedAt: '2026-05-02T11:00:00Z', status: 'STALE' }
];

// Granular Allowed views per workspace mapping
export const seededReportingSettings: ReportingSettings[] = [
  {
    workspaceId: 'ws_showtime',
    defaultTimeframe: 'last_30_days',
    allowedDashboards: ['overview', 'opportunity', 'sales', 'owner', 'marketing'],
    lastSyncAt: '2026-05-28T15:00:00Z',
    mode: 'MOCK'
  },
  {
    workspaceId: 'ws_apex',
    defaultTimeframe: 'this_week',
    allowedDashboards: ['overview', 'opportunity', 'sales'], // Restrict access to owner/marketing for Apex Blue
    lastSyncAt: '2026-05-28T14:45:00Z',
    mode: 'MOCK'
  }
];

// Tenant Subscriptions Placeholder
export const seededSubscriptions: SubscriptionPlaceholder[] = [
  { workspaceId: 'ws_showtime', plan: 'UNLIMITED', status: 'ACTIVE', amount: 297, nextBillingDate: '2026-06-15T00:00:00Z' },
  { workspaceId: 'ws_apex', plan: 'GROWTH', status: 'ACTIVE', amount: 147, nextBillingDate: '2026-06-20T00:00:00Z' },
  { workspaceId: 'ws_pro_clean', plan: 'STARTER', status: 'PAST_DUE', amount: 97, nextBillingDate: '2026-05-25T00:00:00Z' }
];

// Audit Trails Logs
export let seededAuditLogs: AuditLog[] = [
  { id: 'log_001', workspaceId: 'ws_showtime', userId: 'usr_super_admin', userEmail: 'operations@showtimepoolmechanics.com', action: 'INIT_SYSTEM', details: 'SaaS Platform bootstrapped with secure tenants.', ipAddress: '127.0.0.1', timestamp: '2026-05-01T08:00:00Z' },
  { id: 'log_002', workspaceId: 'ws_showtime', userId: 'usr_owner_A', userEmail: 'owner@showtime.com', action: 'CONNECT_GHL_API', details: 'GoHighLevel private integration key was updated.', ipAddress: '198.51.100.41', timestamp: '2026-05-20T11:45:00Z' },
  { id: 'log_003', workspaceId: 'ws_showtime', userId: 'usr_admin_A', userEmail: 'admin@showtime.com', action: 'CHANGE_METRICS_MODE', details: 'Flipped workspace data fetch rule selector to mock mode.', ipAddress: '203.0.113.88', timestamp: '2026-05-25T14:20:00Z' }
];

// Dynamic In-Memory Store supporting state manipulation
export class MockDatabase {
  users = [...seededUsers];
  workspaces = [...seededWorkspaces];
  members = [...seededWorkspaceMembers];
  connections = [...seededGHLConnections];
  settings = [...seededReportingSettings];
  subscriptions = [...seededSubscriptions];
  auditLogs = [...seededAuditLogs];

  getUserByEmail(email: string) {
    return this.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  }

  getUserById(id: string) {
    return this.users.find(u => u.id === id);
  }

  getWorkspaceById(id: string) {
    return this.workspaces.find(w => w.id === id);
  }

  getWorkspacesForUser(userId: string) {
    // If user is platform SUPER_ADMIN, they can access ALL workspaces
    const memberObj = this.members.find(m => m.userId === userId);
    if (memberObj && memberObj.role === UserRole.SUPER_ADMIN) {
      return this.workspaces;
    }
    const myWorkspaceIds = this.members.filter(m => m.userId === userId).map(m => m.workspaceId);
    return this.workspaces.filter(w => myWorkspaceIds.includes(w.id));
  }

  getWorkspaceMember(workspaceId: string, userId: string) {
    return this.members.find(m => m.workspaceId === workspaceId && m.userId === userId);
  }

  getMembersByWorkspace(workspaceId: string) {
    return this.members.filter(m => m.workspaceId === workspaceId);
  }

  getGHLConnection(workspaceId: string) {
    return this.connections.find(c => c.workspaceId === workspaceId);
  }

  getReportingSettings(workspaceId: string) {
    let s = this.settings.find(st => st.workspaceId === workspaceId);
    if (!s) {
      s = {
        workspaceId,
        defaultTimeframe: 'last_30_days',
        allowedDashboards: ['overview', 'opportunity', 'sales'],
        lastSyncAt: null,
        mode: 'MOCK'
      };
      this.settings.push(s);
    }
    return s;
  }

  getSubscription(workspaceId: string) {
    return this.subscriptions.find(subs => subs.workspaceId === workspaceId);
  }

  log(workspaceId: string | null, userId: string, userEmail: string, action: string, details: string) {
    const entry: AuditLog = {
      id: `log_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      workspaceId,
      userId,
      userEmail,
      action,
      details,
      ipAddress: '127.0.0.1',
      timestamp: new Date().toISOString()
    };
    this.auditLogs.unshift(entry);
    return entry;
  }

  signup(name: string, email: string) {
    const userExists = this.getUserByEmail(email);
    if (userExists) {
      throw new Error('An account with this email address already exists.');
    }

    const newUser: SaaSUser = {
      id: `usr_${Date.now()}`,
      name,
      email,
      onboarded: false,
      createdAt: new Date().toISOString()
    };
    this.users.push(newUser);
    return newUser;
  }

  completeOnboarding(userId: string, companyName: string, ghlMode: 'MOCK' | 'LIVE', apiKey?: string) {
    const user = this.getUserById(userId);
    if (!user) throw new Error('User not found.');

    // Create secure new Tenant Workspace
    const slug = companyName.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
    const workspaceId = `ws_${Date.now()}`;
    // Onboarding starts the 14-day trial, mirroring /api/auth/onboarding. Without a trial
    // window a new workspace derives to NOT_STARTED and the entitlement gate denies it.
    const now = Date.now();
    const newWs: Workspace = {
      id: workspaceId,
      name: companyName,
      slug,
      ghlLocationId: ghlMode === 'LIVE' ? 'loc_live_' + slug.slice(0, 8) : 'loc_mock_' + slug.slice(0, 8),
      createdAt: new Date(now).toISOString(),
      suspended: false,
      trialStartedAt: new Date(now).toISOString(),
      trialEndsAt: new Date(now + 14 * 86400000).toISOString(),
      trialUsed: true,
      trialExtensionCount: 0,
      licenseStatus: 'NONE',
      licensedAt: null
    };
    this.workspaces.push(newWs);

    // Link user as WORKSPACE_OWNER
    const memberId = `mem_${Date.now()}`;
    const newMember: WorkspaceMember = {
      id: memberId,
      workspaceId,
      userId,
      role: UserRole.WORKSPACE_OWNER,
      joinedAt: new Date().toISOString()
    };
    this.members.push(newMember);

    // Setup reporting configuration
    this.settings.push({
      workspaceId,
      defaultTimeframe: 'last_30_days',
      allowedDashboards: ['overview', 'opportunity', 'sales', 'owner', 'marketing'],
      lastSyncAt: new Date().toISOString(),
      mode: ghlMode
    });

    // Create integration connection
    if (ghlMode === 'LIVE' && apiKey) {
      this.connections.push({
        id: `gn_${Date.now()}`,
        workspaceId,
        locationId: newWs.ghlLocationId,
        apiKey,
        connectedAt: new Date().toISOString(),
        status: 'CONNECTED'
      });
    }

    // Set user as onboarded
    user.onboarded = true;

    // Default basic subscription plan (starter / growth / trial)
    this.subscriptions.push({
      workspaceId,
      plan: 'GROWTH',
      status: 'TRIALING',
      amount: 147,
      nextBillingDate: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString() // 14 days trial
    });

    this.log(workspaceId, userId, user.email, 'ONBOARD_WORKSPACE', `Completed corporate onboarding for workspace: ${companyName}`);

    return { user, workspace: newWs, member: newMember };
  }
}

// Instantiate singleton database store
export const db = new MockDatabase();
