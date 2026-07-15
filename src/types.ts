/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// GHL API V2 Objects Definitions

export interface GHLUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  avatarUrl?: string;
}

export interface GHLContact {
  id: string;
  name: string;
  email: string;
  phone?: string;
  source: string;
  tags: string[];
  dateAdded: string;
}

export interface GHLOpportunity {
  id: string;
  name: string;
  pipelineId: string;
  stageId: string;
  value: number; // e.g., deal size or recurring fee
  status: 'open' | 'won' | 'lost' | 'abandoned';
  assignedTo: string; // User ID
  source: string;
  createdAt: string;
  contactId?: string; // linked contact id (used for missedLeads computation)
}

export interface GHLAppointment {
  id: string;
  title: string;
  appointmentStatus: 'confirmed' | 'showed' | 'noshow' | 'cancelled';
  startTime: string;
  userId: string; // Assigned owner
  contactId?: string; // linked contact id (for source attribution in marketing report)
}

export interface GHLConversation {
  id: string;
  userId: string;
  smsCount: number;
  emailCount: number;
  callCount: number;
  avgResponseTimeMin: number;
}

// Aggregated UI Metrics Response

export interface DashboardMetrics {
  totalLeads: number;
  leadsDelta: number; // monthly comparison percentage
  pipelineValue: number;
  pipelineDelta: number;
  closedWonRevenue: number;
  revenueDelta: number;
  appointmentShowRate: number; // percentage
  showRateDelta: number;
  
  // Weekly trend for Sparkline
  trends: {
    leads: number[];
    pipeline: number[];
    revenue: number[];
    appointments: number[];
  };
}

export interface OwnerPerformanceMetric {
  userId: string;
  userName: string;
  userEmail: string;
  opportunitiesCount: number;
  closedWonCount: number;
  closedWonValue: number;
  winRate: number; // percentage
  avgResponseTimeMin: number;
  appointmentsCount: number;
  noShowCount: number;
  funnel: {
    leads: number;
    opps: number;
    won: number;
  };
}

export interface MarketingMetric {
  source: string;
  leadsCount: number;
  conversionRate: number; // percentage of leads converting to won opportunities
  pipelineValue: number;
  closedWonValue: number;
  costEstimate?: number;
  roi?: number; // percentage
  weeklyLeadsTrend: { date: string; count: number }[];
}

export interface GHLAppConfig {
  dataSourceMode: 'MOCK' | 'LIVE';
  apiKey: string;
  locationId: string;
  webhookUrl: string;
  apiConnectedSince: string | null;
  cacheTtlMinutes: number;
  rateLimitStatus: {
    remaining: number;
    limit: number;
  };
}

// ==========================================
// NEW REPORTING COMMAND CENTER ARCHITECTURE
// ==========================================

// Shared Interfaces
export interface MetricCard {
  id: string;
  label: string;
  value: string | number;
  change: number; // monthly comparison percentage, e.g. +14.8 or -2.3
  trend: 'up' | 'down' | 'neutral';
  timeframe?: string;
}

export interface TrendChartPoint {
  date: string; // ISO date string or formatted (e.g., "Wk 1", "2026-05-20")
  [key: string]: string | number; // allow flexible key metrics like leads, appointments, etc.
}

export interface FunnelStage {
  stage: string; // e.g. "Leads", "Booked", "Showed", "Won"
  count: number;
  percentageOfPrevious: number; // calculation relative to previous stage
  percentageOfTotal: number; // calculation relative to top funnel (leads)
}

export interface TableColumn {
  id: string;
  header: string;
  type: 'string' | 'number' | 'percentage' | 'currency' | 'date';
}

export interface TableData {
  columns: TableColumn[];
  rows: Record<string, any>[];
}

export interface SourceBreakdown {
  source: string;
  leads: number;
  appointments: number;
  won: number;
  revenue: number;
  conversionRate: number;
}

// Filter Definitions
export interface DateRangeFilter {
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
}

export interface UserFilter {
  userId?: string;
  userName?: string;
}

export interface SourceFilter {
  source?: string;
}

export interface PipelineFilter {
  pipelineId?: string;
}

export interface CampaignFilter {
  campaign?: string;
}

export interface ServiceCategoryFilter {
  serviceCategory?: string; // e.g., "Pool Install", "Pool Remodel", "Leak Detection"
}

// Normalized API Response Wrapper
export interface ApiResponse<T> {
  data: T;
  status: 'success' | 'error';
  source: 'mock' | 'live';
  generatedAt: string;
  stale: boolean;
  cachedAt?: number | null;
  warnings: string[];
  unavailableMetrics: string[];
  error?: string;
}

// Page 1: Owner Performance Report Payload
export interface OwnerPerformanceReport {
  summary: {
    totalLeads: number;
    newLeads: number;
    bookedAppointments: number;
    showRate: number; // percentage
    closeRate: number; // percentage
    pipelineValue: number;
    wonRevenue: number;
    lostOpportunities: number;
    missedLeadsOrCalls: number;
    avgSpeedToLeadSec: number;
    leadToBookingConvRate: number;
    bookingToWonConvRate: number;
  };
  revenueBySource: Record<string, number>;
  revenueByServiceType: Record<string, number>;
  ownerBreakdown: {
    userId: string;
    userName: string;
    userEmail: string;
    totalLeads: number;
    newLeads: number;
    bookedAppointments: number;
    showRate: number;
    closeRate: number;
    pipelineValue: number;
    wonRevenue: number;
    lostOpportunities: number;
    missedLeads: number;
    avgSpeedToLeadSec: number;
  }[];
  trends: TrendChartPoint[];
  funnel: FunnelStage[];
}

// Page 2: VA Performance Report Payload
export interface VAPerformanceReport {
  summary: {
    leadsAssigned: number;
    leadsContacted: number;
    avgFirstResponseTimeMin: number;
    conversationsHandled: number;
    followUpsCompleted: number;
    tasksCompleted: number;
    appointmentsBooked: number;
    bookingRate: number; // percentage
    noShowRecoveryAttempts: number;
    staleLeadsCount: number;
    responseSlaPerformance: number; // percentage of responses within 5 minutes SLA
  };
  vaBreakdown: {
    vaId: string;
    vaName: string;
    leadsAssigned: number;
    leadsContacted: number;
    avgFirstResponseTimeMin: number;
    conversationsHandled: number;
    followUpsCompleted: number;
    tasksCompleted: number;
    appointmentsBooked: number;
    bookingRate: number;
    noShowRecoveryAttempts: number;
    staleLeadsCount: number;
    responseSlaPerformance: number;
  }[];
  recentActivity: {
    id: string;
    timestamp: string;
    vaName: string;
    leadName: string;
    action: string;
    status: 'success' | 'pending' | 'failed' | 'info';
  }[];
  staleLeadsDetails: {
    id: string;
    leadName: string;
    assignedVa: string;
    daysStale: number;
    lastContactDate: string;
    status: string;
  }[];
  trends: TrendChartPoint[];
}

// Page 2b: Appointment Dashboard Report Payload
export interface AppointmentDashboardReport {
  summary: {
    totalBooked: number;
    totalShowed: number;
    totalNoShow: number;
    totalCancelled: number;
    totalConfirmed: number;
    showRate: number;
    noShowRate: number;
    cancellationRate: number;
    upcomingCount: number;
  };
  statusDistribution: { status: string; count: number }[];
  calendarBreakdown: {
    calendarId: string;
    calendarName: string;
    total: number;
    showed: number;
    noshow: number;
    cancelled: number;
    confirmed: number;
    showRate: number;
  }[];
  repBreakdown: {
    userId: string;
    userName: string;
    booked: number;
    showed: number;
    noshow: number;
    cancelled: number;
    showRate: number;
  }[];
  upcomingAppointments: {
    id: string;
    title: string;
    startTime: string;
    status: string;
    userId: string;
    userName?: string;
    calendarId: string;
    calendarName?: string;
  }[];
  trends: TrendChartPoint[];
}

// Page 3: Marketing Performance Report Payload
export interface MarketingPerformanceReport {
  summary: {
    totalLeads: number;
    totalBookings: number;
    totalPipelineValue: number;
    totalWonRevenue: number;
    avgLeadToAppointmentRate: number; // percentage
    avgAppointmentToWonRate: number; // percentage
    costPerLeadPlaceholder: number;
    roasPlaceholder: number; // return on ad spend multiplier (e.g. 5.2x)
  };
  leadsBySource: Record<string, number>;
  leadsByCampaign: Record<string, number>;
  bookingsBySource: Record<string, number>;
  pipelineValueBySource: Record<string, number>;
  wonRevenueBySource: Record<string, number>;
  campaignBreakdown: {
    campaignId: string;
    campaignName: string;
    leads: number;
    bookings: number;
    pipelineValue: number;
    wonRevenue: number;
    cost: number;
    roas: number;
    conversionRate: number;
  }[];
  trends: TrendChartPoint[];
}

// Page 4: Estimates & Invoices Dashboard Report
export interface EstimatesInvoicesReport {
  estimates: {
    totalCount: number;
    totalValue: number;
    byStatus: Record<string, { count: number; value: number }>;
    funnel: {
      sent: number;
      sentValue: number;
      viewed: number;
      viewRate: number;
      accepted: number;
      acceptanceRate: number;
      rejected: number;
      rejectionRate: number;
      converted: number;
      conversionRate: number;
      expired: number;
    };
  };
  invoices: {
    totalCount: number;
    totalValue: number;
    totalPaid: number;
    totalOutstanding: number;
    collectionRate: number;
    avgInvoiceValue: number;
    byStatus: Record<string, { count: number; value: number; amountPaid: number; amountDue: number }>;
    aging: {
      current:    { count: number; value: number };
      days1to30:  { count: number; value: number };
      days31to60: { count: number; value: number };
      days61plus: { count: number; value: number };
    };
    unpaidList: {
      id: string;
      invoiceNumber: string;
      name: string;
      contactName: string;
      contactEmail: string;
      amountDue: number;
      total: number;
      dueDate: string;
      issueDate: string;
      daysOverdue: number;
      status: string;
    }[];
  };
  crossMetrics: {
    estimateToInvoiceRate: number;
  };
  warnings: string[];
  unavailableMetrics: string[];
}

// ==========================================
// SAAS AUTHENTICATION, ROLE, & WORKSPACE TYPES
// ==========================================

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  WORKSPACE_OWNER = 'WORKSPACE_OWNER',
  ADMIN = 'ADMIN',
  SALES_REP = 'SALES_REP',
  TEAM_MEMBER = 'TEAM_MEMBER',
  READ_ONLY = 'READ_ONLY'
}

export interface SaaSUser {
  id: string;
  name: string;
  email: string;
  onboarded: boolean;
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  ghlLocationId: string;
  createdAt: string;
  suspended: boolean;

  // Stored entitlement facts (migration 0004). The trial/access *states* are not stored —
  // they are derived from these by deriveEntitlement() in src/entitlements.ts, because
  // time-dependent states would go stale in a column. Do not add a status field here.
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  trialUsed: boolean;
  trialExtensionCount: number;
  licenseStatus: 'NONE' | 'LICENSED' | 'REVOKED';
  licensedAt: string | null;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: UserRole;
  joinedAt: string;
}

export interface GHLConnection {
  id: string;
  workspaceId: string;
  locationId: string;
  apiKey: string;
  connectedAt: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'STALE';
}

export interface ReportingSettings {
  workspaceId: string;
  defaultTimeframe: 'today' | 'this_week' | 'this_month' | 'last_30_days' | 'this_quarter' | 'this_year';
  allowedDashboards: ('overview' | 'opportunity' | 'sales' | 'owner' | 'marketing')[];
  lastSyncAt: string | null;
  mode: 'MOCK' | 'LIVE';
  allowAdminManageGHL?: boolean;
  cacheTtlMinutes?: number;
}

export interface SubscriptionPlaceholder {
  workspaceId: string;
  plan: 'STARTER' | 'GROWTH' | 'UNLIMITED';
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'TRIALING';
  amount: number;
  nextBillingDate: string;
}

// ==========================================
// OUTSTANDING REPORT TYPES
// ==========================================

export interface OutstandingRecord {
  id: string;
  number: string;
  name: string;
  contactName: string;
  contactEmail: string;
  status: string;        // raw GHL status, not normalized
  sentDate: string;      // ISO — sentAt → issueDate → updatedAt → createdAt fallback
  amount: number;        // total (estimates) or amountDue (unpaid invoices) or total (paid invoices)
  daysOutstanding: number;
  // Unpaid invoice extras
  total?: number;        // raw invoice total (separate from amountDue for PARTIAL invoices)
  dueDate?: string;      // ISO due date
  // Paid invoice extras
  issuedAt?: string;     // original sentAt/issueDate (sentDate stores paidAt for paid records)
}

export interface OutstandingReport {
  pendingEstimates: {
    count: number;
    totalValue: number;
    records: OutstandingRecord[];
  };
  unpaidInvoices: {
    count: number;
    totalValue: number;
    records: OutstandingRecord[];
  };
  paidInvoices: {
    count: number;
    totalValue: number;
    records: OutstandingRecord[]; // amount = invoice total; sentDate = paidAt fallback chain
  };
  allSentEstimates: {
    count: number;
    totalValue: number;
    records: OutstandingRecord[]; // status = raw GHL status (not normalized)
  };
  fetchedAt: string;
  warnings: string[];
}

// ==========================================
// EXTERNAL ANALYTICS INTEGRATION TYPES
// ==========================================

export interface IntegrationStatus {
  provider: string;
  status: 'CONNECTED' | 'ERROR' | 'REVOKED' | 'PENDING' | 'NOT_CONNECTED';
  propertyId: string | null;
  propertyName: string | null;
  connectedAt: string | null;
}

export interface GA4ChannelRow {
  channel: string;
  sessions: number;
  users: number;
  conversions: number;
}

export interface GA4LandingPageRow {
  page: string;
  sessions: number;
  bounceRate: number;
}

export interface GA4Report {
  sessions: number;
  users: number;
  newUsers: number;
  conversions: number;
  channelBreakdown: GA4ChannelRow[];
  topLandingPages: GA4LandingPageRow[];
  source: 'live' | 'mock';
  warnings: string[];
}

export interface MetaCampaignRow {
  id: string;
  name: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  conversions: number;
  costPerResult: number;
  roas: number;
}

export interface MetaAdsReport {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  conversions: number;
  costPerResult: number;
  roas: number;
  campaigns: MetaCampaignRow[];
  source: 'live' | 'mock';
  warnings: string[];
  adAccountId: string;
  adAccountName: string;
}

export interface AuditLog {
  id: string;
  workspaceId: string | null;
  userId: string;
  userEmail: string;
  action: string;
  details: string;
  ipAddress: string;
  timestamp: string;
}

export interface SecureAuthSession {
  user: SaaSUser;
  activeWorkspace: Workspace | null;
  memberRecord: WorkspaceMember | null;
  token: string;
}

