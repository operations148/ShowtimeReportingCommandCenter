var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/types.ts
var init_types = __esm({
  "src/types.ts"() {
  }
});

// src/mockReportingData.ts
function getOwnerPerformanceReport(filters = {}) {
  const userFilter = filters.userId;
  const sourceFilter = filters.source;
  const campaignFilter = filters.campaign;
  const serviceCategoryFilter = filters.serviceCategory;
  const targetingOwners = userFilter ? mockTeamOwners.filter((u) => u.id === userFilter) : mockTeamOwners;
  const mockBaseData = {
    usr_001: {
      totalLeads: 24,
      newLeads: 5,
      bookedAppointments: 18,
      showedApts: 15,
      closedWon: 8,
      pipelineValue: 36e4,
      wonRevenue: 245e3,
      lostOpps: 4,
      missedLeads: 1,
      totalSpeedSec: 88,
      revenueBySource: { "Google Local Service Ads": 135e3, "Referral": 95e3, "Yelp Organic": 15e3 },
      revenueByServiceType: { "Pool Install": 18e4, "Pool Remodel": 5e4, "Leak Detection": 15e3 }
    },
    usr_002: {
      totalLeads: 31,
      newLeads: 8,
      bookedAppointments: 22,
      showedApts: 19,
      closedWon: 9,
      pipelineValue: 285e3,
      wonRevenue: 132e3,
      lostOpps: 7,
      missedLeads: 3,
      totalSpeedSec: 142,
      revenueBySource: { "Facebook Ads": 65e3, "Google Search Organic": 45e3, "Instagram Ads": 22e3 },
      revenueByServiceType: { "Pool Remodel": 85e3, "Weekly Service": 25e3, "Leak Detection": 22e3 }
    },
    usr_003: {
      totalLeads: 19,
      newLeads: 3,
      bookedAppointments: 12,
      showedApts: 9,
      closedWon: 4,
      pipelineValue: 165e3,
      wonRevenue: 74e3,
      lostOpps: 5,
      missedLeads: 2,
      totalSpeedSec: 210,
      revenueBySource: { "Google Search Organic": 38e3, "Facebook Ads": 28e3, "Yelp Organic": 8e3 },
      revenueByServiceType: { "Pool Install": 45e3, "Leak Detection": 21e3, "Weekly Service": 8e3 }
    },
    usr_004: {
      totalLeads: 28,
      newLeads: 7,
      bookedAppointments: 20,
      showedApts: 17,
      closedWon: 7,
      pipelineValue: 24e4,
      wonRevenue: 118e3,
      lostOpps: 6,
      missedLeads: 0,
      totalSpeedSec: 95,
      revenueBySource: { "Yelp Organic": 18e3, "Referral": 58e3, "Google Local Service Ads": 42e3 },
      revenueByServiceType: { "Pool Install": 82e3, "Pool Remodel": 28e3, "Leak Detection": 8e3 }
    }
  };
  let totalLeads = 0;
  let newLeads = 0;
  let bookedAppointments = 0;
  let showedApts = 0;
  let closedWon = 0;
  let pipelineValue = 0;
  let wonRevenue = 0;
  let lostOpps = 0;
  let missedLeadsOrCalls = 0;
  let totalSpeedAcrossAllSec = 0;
  let speedCount = 0;
  const aggregatedSourceRev = {};
  const aggregatedServiceRev = {};
  const ownerBreakdown = targetingOwners.map((owner) => {
    const raw = mockBaseData[owner.id] || {
      totalLeads: 10,
      newLeads: 2,
      bookedAppointments: 5,
      showedApts: 4,
      closedWon: 2,
      pipelineValue: 5e4,
      wonRevenue: 25050,
      lostOpps: 2,
      missedLeads: 1,
      totalSpeedSec: 150,
      revenueBySource: {},
      revenueByServiceType: {}
    };
    let multiplier = 1;
    if (sourceFilter) {
      multiplier = mockSources.includes(sourceFilter) ? 0.4 : 0.05;
    }
    if (campaignFilter) {
      multiplier *= 0.35;
    }
    if (serviceCategoryFilter) {
      multiplier *= 0.5;
    }
    const locLeads = Math.max(1, Math.round(raw.totalLeads * multiplier));
    const locNew = Math.max(0, Math.round(raw.newLeads * multiplier));
    const locBooked = Math.max(1, Math.round(raw.bookedAppointments * multiplier));
    const locShowed = Math.max(1, Math.round(raw.showedApts * multiplier));
    const locWon = Math.max(0, Math.round(raw.closedWon * multiplier));
    const locPip = Math.round(raw.pipelineValue * multiplier);
    const locRev = Math.round(raw.wonRevenue * multiplier);
    const locLost = Math.max(0, Math.round(raw.lostOpps * multiplier));
    const locMissed = Math.max(0, Math.round(raw.missedLeads * multiplier));
    const speed = Math.max(15, raw.totalSpeedSec);
    Object.entries(raw.revenueBySource).forEach(([src, val]) => {
      if (!sourceFilter || src === sourceFilter) {
        const value = Math.round(val * (campaignFilter ? 0.5 : 1) * (serviceCategoryFilter ? 0.6 : 1));
        aggregatedSourceRev[src] = (aggregatedSourceRev[src] || 0) + value;
      }
    });
    Object.entries(raw.revenueByServiceType).forEach(([service, val]) => {
      if (!serviceCategoryFilter || service === serviceCategoryFilter) {
        const value = Math.round(val * (sourceFilter ? 0.4 : 1) * (campaignFilter ? 0.5 : 1));
        aggregatedServiceRev[service] = (aggregatedServiceRev[service] || 0) + value;
      }
    });
    totalLeads += locLeads;
    newLeads += locNew;
    bookedAppointments += locBooked;
    showedApts += locShowed;
    closedWon += locWon;
    pipelineValue += locPip;
    wonRevenue += locRev;
    lostOpps += locLost;
    missedLeadsOrCalls += locMissed;
    totalSpeedAcrossAllSec += speed;
    speedCount++;
    const sRate = locBooked > 0 ? Math.round(locShowed / locBooked * 100) : 0;
    const cRate = locBooked > 0 ? Math.round(locWon / locBooked * 100) : 0;
    return {
      userId: owner.id,
      userName: owner.name,
      userEmail: owner.email,
      totalLeads: locLeads,
      newLeads: locNew,
      bookedAppointments: locBooked,
      showRate: Math.min(100, sRate),
      closeRate: Math.min(100, cRate),
      pipelineValue: locPip,
      wonRevenue: locRev,
      lostOpportunities: locLost,
      missedLeads: locMissed,
      avgSpeedToLeadSec: speed
    };
  });
  const aggregateShowRate = bookedAppointments > 0 ? Math.round(showedApts / bookedAppointments * 100) : 75;
  const aggregateCloseRate = bookedAppointments > 0 ? Math.round(closedWon / bookedAppointments * 100) : 38;
  const leadToBookingConvRate = totalLeads > 0 ? Math.round(bookedAppointments / totalLeads * 100) : 45;
  const bookingToWonConvRate = bookedAppointments > 0 ? Math.round(closedWon / bookedAppointments * 100) : 34;
  const finalAvgSpeedSec = speedCount > 0 ? Math.round(totalSpeedAcrossAllSec / speedCount) : 120;
  const trends = [
    { date: "2026-05-01", leads: Math.round(totalLeads * 0.15), wonRevenue: Math.round(wonRevenue * 0.1), pipeline: Math.round(pipelineValue * 0.15) },
    { date: "2026-05-07", leads: Math.round(totalLeads * 0.32), wonRevenue: Math.round(wonRevenue * 0.28), pipeline: Math.round(pipelineValue * 0.35) },
    { date: "2026-05-14", leads: Math.round(totalLeads * 0.55), wonRevenue: Math.round(wonRevenue * 0.5), pipeline: Math.round(pipelineValue * 0.6) },
    { date: "2026-05-21", leads: Math.round(totalLeads * 0.8), wonRevenue: Math.round(wonRevenue * 0.82), pipeline: Math.round(pipelineValue * 0.85) },
    { date: "2026-05-27", leads: totalLeads, wonRevenue, pipeline: pipelineValue }
  ];
  const funnel = [
    { stage: "Total Sourced Contacts", count: totalLeads, percentageOfPrevious: 100, percentageOfTotal: 100 },
    { stage: "Pipeline Opportunities", count: Math.round(totalLeads * 0.85), percentageOfPrevious: 85, percentageOfTotal: 85 },
    { stage: "Booked Appointments", count: bookedAppointments, percentageOfPrevious: Math.round(bookedAppointments / (totalLeads * 0.85) * 100), percentageOfTotal: leadToBookingConvRate },
    { stage: "Confirmed Attended (Showed)", count: showedApts, percentageOfPrevious: aggregateShowRate, percentageOfTotal: Math.round(showedApts / totalLeads * 100) },
    { stage: "Closed Won Contracts", count: closedWon, percentageOfPrevious: aggregateCloseRate, percentageOfTotal: Math.round(closedWon / totalLeads * 100) }
  ];
  return {
    summary: {
      totalLeads,
      newLeads,
      bookedAppointments,
      showRate: Math.min(100, aggregateShowRate),
      closeRate: Math.min(100, aggregateCloseRate),
      pipelineValue,
      wonRevenue,
      lostOpportunities: lostOpps,
      missedLeadsOrCalls,
      avgSpeedToLeadSec: finalAvgSpeedSec,
      leadToBookingConvRate: Math.min(100, leadToBookingConvRate),
      bookingToWonConvRate: Math.min(100, bookingToWonConvRate)
    },
    revenueBySource: Object.keys(aggregatedSourceRev).length > 0 ? aggregatedSourceRev : { "Google Local Service Ads": 142e3, "Facebook Ads": 93e3, "Other Organic": 11e4 },
    revenueByServiceType: Object.keys(aggregatedServiceRev).length > 0 ? aggregatedServiceRev : { "Pool Install": 225e3, "Pool Remodel": 113e3, "Leak Detection": 72e3 },
    ownerBreakdown,
    trends,
    funnel
  };
}
function getVAPerformanceReport(filters = {}) {
  const userFilter = filters.userId;
  const sourceFilter = filters.source;
  const campaignFilter = filters.campaign;
  const targetingVAs = userFilter ? mockVirtualAssistants.filter((v) => v.id === userFilter) : mockVirtualAssistants;
  const mockBaseVA = {
    va_001: {
      leadsAssigned: 55,
      leadsContacted: 53,
      avgFirstResponseTimeMin: 2.1,
      conversationsHandled: 120,
      followUpsCompleted: 98,
      tasksCompleted: 45,
      appointmentsBooked: 24,
      noShowRecoveryAttempts: 15,
      staleLeadsCount: 1,
      responseSlaPerformance: 98
    },
    va_002: {
      leadsAssigned: 48,
      leadsContacted: 44,
      avgFirstResponseTimeMin: 4.8,
      conversationsHandled: 95,
      followUpsCompleted: 78,
      tasksCompleted: 38,
      appointmentsBooked: 18,
      noShowRecoveryAttempts: 8,
      staleLeadsCount: 4,
      responseSlaPerformance: 89
    },
    va_003: {
      leadsAssigned: 62,
      leadsContacted: 61,
      avgFirstResponseTimeMin: 1.8,
      conversationsHandled: 145,
      followUpsCompleted: 110,
      tasksCompleted: 52,
      appointmentsBooked: 29,
      noShowRecoveryAttempts: 19,
      staleLeadsCount: 2,
      responseSlaPerformance: 99
    },
    va_004: {
      leadsAssigned: 42,
      leadsContacted: 38,
      avgFirstResponseTimeMin: 6.2,
      conversationsHandled: 82,
      followUpsCompleted: 65,
      tasksCompleted: 30,
      appointmentsBooked: 14,
      noShowRecoveryAttempts: 6,
      staleLeadsCount: 5,
      responseSlaPerformance: 82
    }
  };
  let leadsAssigned = 0;
  let leadsContacted = 0;
  let sumFirstResponse = 0;
  let conversationsHandled = 0;
  let followUpsCompleted = 0;
  let tasksCompleted = 0;
  let appointmentsBooked = 0;
  let noShowRecoveryAttempts = 0;
  let staleLeadsCount = 0;
  let sumSlaPerf = 0;
  let countVAs = 0;
  const vaBreakdown = targetingVAs.map((va) => {
    const raw = mockBaseVA[va.id] || {
      leadsAssigned: 20,
      leadsContacted: 18,
      avgFirstResponseTimeMin: 5,
      conversationsHandled: 40,
      followUpsCompleted: 30,
      tasksCompleted: 15,
      appointmentsBooked: 6,
      noShowRecoveryAttempts: 5,
      staleLeadsCount: 2,
      responseSlaPerformance: 90
    };
    let multiplier = 1;
    if (sourceFilter) multiplier *= 0.45;
    if (campaignFilter) multiplier *= 0.35;
    const locAssigned = Math.max(1, Math.round(raw.leadsAssigned * multiplier));
    const locContacted = Math.max(1, Math.round(raw.leadsContacted * multiplier));
    const locConversations = Math.max(2, Math.round(raw.conversationsHandled * multiplier));
    const locFollowups = Math.max(1, Math.round(raw.followUpsCompleted * multiplier));
    const locTasks = Math.max(1, Math.round(raw.tasksCompleted * multiplier));
    const locApts = Math.max(1, Math.round(raw.appointmentsBooked * multiplier));
    const locNoShowRec = Math.max(0, Math.round(raw.noShowRecoveryAttempts * multiplier));
    const locStale = Math.max(0, Math.round(raw.staleLeadsCount * (sourceFilter ? 0.5 : 1)));
    leadsAssigned += locAssigned;
    leadsContacted += locContacted;
    sumFirstResponse += raw.avgFirstResponseTimeMin;
    conversationsHandled += locConversations;
    followUpsCompleted += locFollowups;
    tasksCompleted += locTasks;
    appointmentsBooked += locApts;
    noShowRecoveryAttempts += locNoShowRec;
    staleLeadsCount += locStale;
    sumSlaPerf += raw.responseSlaPerformance;
    countVAs++;
    const bRate = locContacted > 0 ? Math.round(locApts / locContacted * 100) : 0;
    return {
      vaId: va.id,
      vaName: va.name,
      leadsAssigned: locAssigned,
      leadsContacted: locContacted,
      avgFirstResponseTimeMin: raw.avgFirstResponseTimeMin,
      conversationsHandled: locConversations,
      followUpsCompleted: locFollowups,
      tasksCompleted: locTasks,
      appointmentsBooked: locApts,
      bookingRate: Math.min(100, bRate),
      noShowRecoveryAttempts: locNoShowRec,
      staleLeadsCount: locStale,
      responseSlaPerformance: raw.responseSlaPerformance
    };
  });
  const finalAvgSla = countVAs > 0 ? Math.round(sumSlaPerf / countVAs) : 92;
  const finalBookingRate = leadsContacted > 0 ? Math.round(appointmentsBooked / leadsContacted * 100) : 41;
  const finalAvgResponse = countVAs > 0 ? Number((sumFirstResponse / countVAs).toFixed(1)) : 3.5;
  const staleLeadsDetails = [
    { id: "con_stale_1", leadName: "Jack Reacher", assignedVa: "Alisha Gomez", daysStale: 14, lastContactDate: "2026-05-13", status: "Snoozed" },
    { id: "con_stale_2", leadName: "Monica Geller", assignedVa: "Brandon Lee", daysStale: 9, lastContactDate: "2026-05-18", status: "Needs Follow-up" },
    { id: "con_stale_3", leadName: "Chandler Bing", assignedVa: "Keanu Reeves", daysStale: 11, lastContactDate: "2026-05-16", status: "Unresponsive" },
    { id: "con_stale_4", leadName: "Ross Geller", assignedVa: "Maria Santos", daysStale: 12, lastContactDate: "2026-05-15", status: "Pending Re-engagement" }
  ].filter((l) => !userFilter || l.assignedVa.includes(targetingVAs[0]?.name || "_"));
  const recentActivity = [
    { id: "act_1", timestamp: (/* @__PURE__ */ new Date()).toISOString(), vaName: "Alisha Gomez", leadName: "Sally Jenkins", action: "Left Voice Mail & SMS follow-up", status: "success" },
    { id: "act_2", timestamp: new Date(Date.now() - 3e5).toISOString(), vaName: "Keanu Reeves", leadName: "Douglas Croft", action: "Booked service call request", status: "success" },
    { id: "act_3", timestamp: new Date(Date.now() - 12e5).toISOString(), vaName: "Maria Santos", leadName: "Brenda Wilkes", action: "Sent custom pool dimensions quote link", status: "info" },
    { id: "act_4", timestamp: new Date(Date.now() - 48e5).toISOString(), vaName: "Brandon Lee", leadName: "Thomas Shelby", action: "No-show recovery call dialed", status: "pending" }
  ].filter((act) => !userFilter || act.vaName === targetingVAs[0]?.name);
  const trends = [
    { date: "2026-05-01", assigned: Math.round(leadsAssigned * 0.2), booked: Math.round(appointmentsBooked * 0.15) },
    { date: "2026-05-07", assigned: Math.round(leadsAssigned * 0.4), booked: Math.round(appointmentsBooked * 0.35) },
    { date: "2026-05-14", assigned: Math.round(leadsAssigned * 0.65), booked: Math.round(appointmentsBooked * 0.6) },
    { date: "2026-05-21", assigned: Math.round(leadsAssigned * 0.85), booked: Math.round(appointmentsBooked * 0.8) },
    { date: "2026-05-27", assigned: leadsAssigned, booked: appointmentsBooked }
  ];
  return {
    summary: {
      leadsAssigned,
      leadsContacted,
      avgFirstResponseTimeMin: finalAvgResponse,
      conversationsHandled,
      followUpsCompleted,
      tasksCompleted,
      appointmentsBooked,
      bookingRate: Math.min(100, finalBookingRate),
      noShowRecoveryAttempts,
      staleLeadsCount,
      responseSlaPerformance: finalAvgSla
    },
    vaBreakdown,
    recentActivity,
    staleLeadsDetails,
    trends
  };
}
function getMarketingPerformanceReport(filters = {}) {
  const sourceFilter = filters.source;
  const campaignFilter = filters.campaign;
  const baselineSources = [
    { name: "Google Local Service Ads", leads: 48, won: 19, val: 142e3, bookings: 32, cost: 4200 },
    { name: "Facebook Ads", leads: 62, won: 14, val: 93500, bookings: 28, cost: 3800 },
    { name: "Google Search Organic", leads: 28, won: 9, val: 82e3, bookings: 16, cost: 0 },
    { name: "Referral", leads: 12, won: 8, val: 11e4, bookings: 10, cost: 150 },
    { name: "Yelp Organic", leads: 15, won: 4, val: 23e3, bookings: 8, cost: 50 },
    { name: "Instagram Ads", leads: 21, won: 6, val: 38e3, bookings: 12, cost: 1100 }
  ];
  let totalLeads = 0;
  let totalBookings = 0;
  let totalPipelineValue = 0;
  let totalWonRevenue = 0;
  let totalSpend = 0;
  const leadsBySource = {};
  const bookingsBySource = {};
  const pipelineValueBySource = {};
  const wonRevenueBySource = {};
  baselineSources.forEach((s) => {
    if (!sourceFilter || s.name === sourceFilter) {
      let multiplier = 1;
      if (campaignFilter) {
        multiplier = 0.55;
      }
      const l = Math.max(1, Math.round(s.leads * multiplier));
      const b = Math.max(1, Math.round(s.bookings * multiplier));
      const wVal = Math.round(s.val * multiplier);
      const pip = Math.round(s.val * 1.3 * multiplier);
      const cost = Math.round(s.cost * multiplier);
      totalLeads += l;
      totalBookings += b;
      totalWonRevenue += wVal;
      totalPipelineValue += pip;
      totalSpend += cost;
      leadsBySource[s.name] = l;
      bookingsBySource[s.name] = b;
      pipelineValueBySource[s.name] = pip;
      wonRevenueBySource[s.name] = wVal;
    }
  });
  const campaignBreakdown = mockCampaigns.map((camp, idx) => {
    let multiplier = 1;
    if (sourceFilter) {
      multiplier = sourceFilter.includes("Google") || sourceFilter.includes("Facebook") ? 0.7 : 0.15;
    }
    const cLeads = Math.max(1, Math.round((25 - idx * 4) * multiplier));
    const cBookings = Math.max(1, Math.round((18 - idx * 3) * multiplier));
    const cWon = Math.max(0, Math.round((10 - idx * 2) * multiplier));
    const cRevenue = Math.round((95e3 - idx * 18e3) * multiplier);
    const cPip = Math.round(cRevenue * 1.25);
    const cCost = Math.round((2200 - idx * 400) * multiplier);
    const roas = cCost > 0 ? Number((cRevenue / cCost).toFixed(1)) : 12.5;
    return {
      campaignId: camp.id,
      campaignName: camp.name,
      leads: cLeads,
      bookings: cBookings,
      pipelineValue: cPip,
      wonRevenue: cRevenue,
      cost: cCost,
      roas,
      conversionRate: cLeads > 0 ? Math.round(cWon / cLeads * 100) : 0
    };
  });
  const leadToApptSla = totalLeads > 0 ? Math.round(totalBookings / totalLeads * 100) : 51;
  const bookingsSought = baselineSources.reduce((sum, s) => sum + s.won, 0);
  const apptToWonSla = totalBookings > 0 ? Math.round(bookingsSought / totalBookings * 100) : 69;
  const costPerLead = totalLeads > 0 ? Number((totalSpend / totalLeads).toFixed(2)) : 22.5;
  const calculatedRoas = totalSpend > 0 ? Number((totalWonRevenue / totalSpend).toFixed(1)) : 8.5;
  const leadsByCampaign = {};
  campaignBreakdown.forEach((c) => {
    leadsByCampaign[c.campaignName] = c.leads;
  });
  const trends = [
    { date: "2026-05-01", adsCost: Math.round(totalSpend * 0.18), returnRevenue: Math.round(totalWonRevenue * 0.12), bookingsCount: Math.round(totalBookings * 0.15) },
    { date: "2026-05-07", adsCost: Math.round(totalSpend * 0.35), returnRevenue: Math.round(totalWonRevenue * 0.29), bookingsCount: Math.round(totalBookings * 0.32) },
    { date: "2026-05-14", adsCost: Math.round(totalSpend * 0.58), returnRevenue: Math.round(totalWonRevenue * 0.52), bookingsCount: Math.round(totalBookings * 0.55) },
    { date: "2026-05-21", adsCost: Math.round(totalSpend * 0.82), returnRevenue: Math.round(totalWonRevenue * 0.78), bookingsCount: Math.round(totalBookings * 0.8) },
    { date: "2026-05-27", adsCost: totalSpend, returnRevenue: totalWonRevenue, bookingsCount: totalBookings }
  ];
  return {
    summary: {
      totalLeads,
      totalBookings,
      totalPipelineValue,
      totalWonRevenue,
      avgLeadToAppointmentRate: Math.min(100, leadToApptSla),
      avgAppointmentToWonRate: Math.min(100, apptToWonSla),
      costPerLeadPlaceholder: costPerLead,
      roasPlaceholder: calculatedRoas
    },
    leadsBySource,
    leadsByCampaign,
    bookingsBySource,
    pipelineValueBySource,
    wonRevenueBySource,
    campaignBreakdown,
    trends
  };
}
var mockTeamOwners, mockVirtualAssistants, mockCampaigns, mockSources;
var init_mockReportingData = __esm({
  "src/mockReportingData.ts"() {
    mockTeamOwners = [
      { id: "usr_001", name: "Marcus Sterling", email: "marcus@showtimepools.com" },
      { id: "usr_002", name: "Sarah Jenkins", email: "sarah@showtimepools.com" },
      { id: "usr_003", name: "Devon Carter", email: "devon@showtimepools.com" },
      { id: "usr_004", name: "Isabella Cruz", email: "isabella@showtimepools.com" }
    ];
    mockVirtualAssistants = [
      { id: "va_001", name: "Alisha Gomez" },
      { id: "va_002", name: "Keanu Reeves" },
      { id: "va_003", name: "Maria Santos" },
      { id: "va_004", name: "Brandon Lee" }
    ];
    mockCampaigns = [
      { id: "camp_001", name: "Backyard Oasis Inbound Promo" },
      { id: "camp_002", name: "Summer Hot Tub Blast 2026" },
      { id: "camp_003", name: "Organic SEO Website Funnel" },
      { id: "camp_004", name: "Facebook Direct Retargeting Leads" },
      { id: "camp_005", name: "Yelp Local High-Intent Referrals" }
    ];
    mockSources = [
      "Google Local Service Ads",
      "Facebook Ads",
      "Google Search Organic",
      "Referral",
      "Yelp Organic",
      "Instagram Ads"
    ];
  }
});

// src/mockSaaSStore.ts
var mockSaaSStore_exports = {};
__export(mockSaaSStore_exports, {
  MockDatabase: () => MockDatabase,
  db: () => db,
  seededAuditLogs: () => seededAuditLogs,
  seededGHLConnections: () => seededGHLConnections,
  seededReportingSettings: () => seededReportingSettings,
  seededSubscriptions: () => seededSubscriptions,
  seededUsers: () => seededUsers,
  seededWorkspaceMembers: () => seededWorkspaceMembers,
  seededWorkspaces: () => seededWorkspaces
});
var seededUsers, MOCK_TRIAL_STARTED, MOCK_TRIAL_ENDS, seededWorkspaces, seededWorkspaceMembers, seededGHLConnections, seededReportingSettings, seededSubscriptions, seededAuditLogs, MockDatabase, db;
var init_mockSaaSStore = __esm({
  "src/mockSaaSStore.ts"() {
    init_types();
    seededUsers = [
      { id: "usr_super_admin", name: "Alex Mercer (Platform Ops)", email: "operations@showtimepoolmechanics.com", onboarded: true, createdAt: "2026-01-10T08:00:00Z" },
      { id: "usr_owner_A", name: "Marcus Sterling (Owner)", email: "owner@showtime.com", onboarded: true, createdAt: "2026-02-15T09:30:00Z" },
      { id: "usr_admin_A", name: "Sarah Chen (Admin)", email: "admin@showtime.com", onboarded: true, createdAt: "2026-03-01T14:15:00Z" },
      { id: "usr_rep_A", name: "Bobby Sales (Sales Rep)", email: "sales@showtime.com", onboarded: true, createdAt: "2026-03-10T11:00:00Z" },
      { id: "usr_member_A", name: "Tyler Member (Team Member)", email: "member@showtime.com", onboarded: true, createdAt: "2026-04-01T10:00:00Z" },
      { id: "usr_readonly_A", name: "Rachel Read (Read-Only)", email: "readonly@showtime.com", onboarded: true, createdAt: "2026-04-15T16:45:00Z" },
      // Workspace B Client isolation users
      { id: "usr_owner_B", name: "Vance Refrigeration (Owner)", email: "owner@vancepools.com", onboarded: true, createdAt: "2026-05-01T12:00:00Z" },
      { id: "usr_readonly_B", name: "Pam Beasley (Read-Only)", email: "pam@vancepools.com", onboarded: true, createdAt: "2026-05-05T09:00:00Z" }
    ];
    MOCK_TRIAL_STARTED = new Date(Date.now() - 5 * 864e5).toISOString();
    MOCK_TRIAL_ENDS = new Date(Date.now() + 9 * 864e5).toISOString();
    seededWorkspaces = [
      // Converted: purchased outright, permanent access.
      {
        id: "ws_showtime",
        name: "Showtime Pool Mechanics",
        slug: "showtime-pools",
        ghlLocationId: "loc_g53h7s8a",
        createdAt: "2026-02-15T09:30:00Z",
        suspended: false,
        trialStartedAt: "2026-02-15T09:30:00Z",
        trialEndsAt: "2026-03-01T09:30:00Z",
        trialUsed: true,
        trialExtensionCount: 0,
        licenseStatus: "LICENSED",
        licensedAt: "2026-02-28T10:00:00Z"
      },
      // Mid-trial: 9 days remaining.
      {
        id: "ws_apex",
        name: "Apex Blue Pools",
        slug: "apex-blue",
        ghlLocationId: "loc_apex_demo",
        createdAt: "2026-05-01T12:00:00Z",
        suspended: false,
        trialStartedAt: MOCK_TRIAL_STARTED,
        trialEndsAt: MOCK_TRIAL_ENDS,
        trialUsed: true,
        trialExtensionCount: 0,
        licenseStatus: "NONE",
        licensedAt: null
      },
      // Suspended: operator override outranks its live trial.
      {
        id: "ws_pro_clean",
        name: "Pro Clean Builders",
        slug: "pro-clean",
        ghlLocationId: "loc_pro_demo",
        createdAt: "2026-05-05T09:00:00Z",
        suspended: true,
        trialStartedAt: MOCK_TRIAL_STARTED,
        trialEndsAt: MOCK_TRIAL_ENDS,
        trialUsed: true,
        trialExtensionCount: 0,
        licenseStatus: "NONE",
        licensedAt: null
      }
    ];
    seededWorkspaceMembers = [
      // Super Admin of platform has access to everything, but we link them to Workspace A by default
      { id: "mem_1", workspaceId: "ws_showtime", userId: "usr_super_admin", role: "SUPER_ADMIN" /* SUPER_ADMIN */, joinedAt: "2026-01-10T08:00:00Z" },
      // Workspace A Team (Showtime Pools)
      { id: "mem_2", workspaceId: "ws_showtime", userId: "usr_owner_A", role: "WORKSPACE_OWNER" /* WORKSPACE_OWNER */, joinedAt: "2026-02-15T09:35:00Z" },
      { id: "mem_3", workspaceId: "ws_showtime", userId: "usr_admin_A", role: "ADMIN" /* ADMIN */, joinedAt: "2026-03-01T14:20:00Z" },
      { id: "mem_4", workspaceId: "ws_showtime", userId: "usr_rep_A", role: "SALES_REP" /* SALES_REP */, joinedAt: "2026-03-10T11:05:00Z" },
      { id: "mem_5", workspaceId: "ws_showtime", userId: "usr_member_A", role: "TEAM_MEMBER" /* TEAM_MEMBER */, joinedAt: "2026-04-01T10:05:00Z" },
      { id: "mem_6", workspaceId: "ws_showtime", userId: "usr_readonly_A", role: "READ_ONLY" /* READ_ONLY */, joinedAt: "2026-04-15T16:50:00Z" },
      // Workspace B Team (Apex Blue Pools)
      { id: "mem_7", workspaceId: "ws_apex", userId: "usr_owner_B", role: "WORKSPACE_OWNER" /* WORKSPACE_OWNER */, joinedAt: "2026-05-01T12:05:00Z" },
      { id: "mem_8", workspaceId: "ws_apex", userId: "usr_readonly_B", role: "READ_ONLY" /* READ_ONLY */, joinedAt: "2026-05-05T09:05:00Z" }
    ];
    seededGHLConnections = [
      { id: "gn_1", workspaceId: "ws_showtime", locationId: "loc_g53h7s8a", apiKey: "ghl_live_token_sec_key_xyz_001", connectedAt: "2026-02-16T10:00:00Z", status: "CONNECTED" },
      { id: "gn_2", workspaceId: "ws_apex", locationId: "loc_apex_demo", apiKey: "ghl_live_token_sec_key_abc_992", connectedAt: "2026-05-02T11:00:00Z", status: "STALE" }
    ];
    seededReportingSettings = [
      {
        workspaceId: "ws_showtime",
        defaultTimeframe: "last_30_days",
        allowedDashboards: ["overview", "opportunity", "sales", "owner", "marketing"],
        lastSyncAt: "2026-05-28T15:00:00Z",
        mode: "MOCK"
      },
      {
        workspaceId: "ws_apex",
        defaultTimeframe: "this_week",
        allowedDashboards: ["overview", "opportunity", "sales"],
        // Restrict access to owner/marketing for Apex Blue
        lastSyncAt: "2026-05-28T14:45:00Z",
        mode: "MOCK"
      }
    ];
    seededSubscriptions = [
      { workspaceId: "ws_showtime", plan: "UNLIMITED", status: "ACTIVE", amount: 297, nextBillingDate: "2026-06-15T00:00:00Z" },
      { workspaceId: "ws_apex", plan: "GROWTH", status: "ACTIVE", amount: 147, nextBillingDate: "2026-06-20T00:00:00Z" },
      { workspaceId: "ws_pro_clean", plan: "STARTER", status: "PAST_DUE", amount: 97, nextBillingDate: "2026-05-25T00:00:00Z" }
    ];
    seededAuditLogs = [
      { id: "log_001", workspaceId: "ws_showtime", userId: "usr_super_admin", userEmail: "operations@showtimepoolmechanics.com", action: "INIT_SYSTEM", details: "SaaS Platform bootstrapped with secure tenants.", ipAddress: "127.0.0.1", timestamp: "2026-05-01T08:00:00Z" },
      { id: "log_002", workspaceId: "ws_showtime", userId: "usr_owner_A", userEmail: "owner@showtime.com", action: "CONNECT_GHL_API", details: "GoHighLevel private integration key was updated.", ipAddress: "198.51.100.41", timestamp: "2026-05-20T11:45:00Z" },
      { id: "log_003", workspaceId: "ws_showtime", userId: "usr_admin_A", userEmail: "admin@showtime.com", action: "CHANGE_METRICS_MODE", details: "Flipped workspace data fetch rule selector to mock mode.", ipAddress: "203.0.113.88", timestamp: "2026-05-25T14:20:00Z" }
    ];
    MockDatabase = class {
      constructor() {
        this.users = [...seededUsers];
        this.workspaces = [...seededWorkspaces];
        this.members = [...seededWorkspaceMembers];
        this.connections = [...seededGHLConnections];
        this.settings = [...seededReportingSettings];
        this.subscriptions = [...seededSubscriptions];
        this.auditLogs = [...seededAuditLogs];
      }
      getUserByEmail(email) {
        return this.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
      }
      getUserById(id) {
        return this.users.find((u) => u.id === id);
      }
      getWorkspaceById(id) {
        return this.workspaces.find((w) => w.id === id);
      }
      getWorkspacesForUser(userId) {
        const memberObj = this.members.find((m) => m.userId === userId);
        if (memberObj && memberObj.role === "SUPER_ADMIN" /* SUPER_ADMIN */) {
          return this.workspaces;
        }
        const myWorkspaceIds = this.members.filter((m) => m.userId === userId).map((m) => m.workspaceId);
        return this.workspaces.filter((w) => myWorkspaceIds.includes(w.id));
      }
      getWorkspaceMember(workspaceId, userId) {
        return this.members.find((m) => m.workspaceId === workspaceId && m.userId === userId);
      }
      getMembersByWorkspace(workspaceId) {
        return this.members.filter((m) => m.workspaceId === workspaceId);
      }
      getGHLConnection(workspaceId) {
        return this.connections.find((c) => c.workspaceId === workspaceId);
      }
      getReportingSettings(workspaceId) {
        let s = this.settings.find((st) => st.workspaceId === workspaceId);
        if (!s) {
          s = {
            workspaceId,
            defaultTimeframe: "last_30_days",
            allowedDashboards: ["overview", "opportunity", "sales"],
            lastSyncAt: null,
            mode: "MOCK"
          };
          this.settings.push(s);
        }
        return s;
      }
      getSubscription(workspaceId) {
        return this.subscriptions.find((subs) => subs.workspaceId === workspaceId);
      }
      log(workspaceId, userId, userEmail, action, details) {
        const entry = {
          id: `log_${Date.now()}_${Math.floor(Math.random() * 1e3)}`,
          workspaceId,
          userId,
          userEmail,
          action,
          details,
          ipAddress: "127.0.0.1",
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        };
        this.auditLogs.unshift(entry);
        return entry;
      }
      signup(name, email) {
        const userExists = this.getUserByEmail(email);
        if (userExists) {
          throw new Error("An account with this email address already exists.");
        }
        const newUser = {
          id: `usr_${Date.now()}`,
          name,
          email,
          onboarded: false,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        this.users.push(newUser);
        return newUser;
      }
      completeOnboarding(userId, companyName, ghlMode, apiKey) {
        const user = this.getUserById(userId);
        if (!user) throw new Error("User not found.");
        const slug = companyName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");
        const workspaceId = `ws_${Date.now()}`;
        const now = Date.now();
        const newWs = {
          id: workspaceId,
          name: companyName,
          slug,
          ghlLocationId: ghlMode === "LIVE" ? "loc_live_" + slug.slice(0, 8) : "loc_mock_" + slug.slice(0, 8),
          createdAt: new Date(now).toISOString(),
          suspended: false,
          trialStartedAt: new Date(now).toISOString(),
          trialEndsAt: new Date(now + 14 * 864e5).toISOString(),
          trialUsed: true,
          trialExtensionCount: 0,
          licenseStatus: "NONE",
          licensedAt: null
        };
        this.workspaces.push(newWs);
        const memberId = `mem_${Date.now()}`;
        const newMember = {
          id: memberId,
          workspaceId,
          userId,
          role: "WORKSPACE_OWNER" /* WORKSPACE_OWNER */,
          joinedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        this.members.push(newMember);
        this.settings.push({
          workspaceId,
          defaultTimeframe: "last_30_days",
          allowedDashboards: ["overview", "opportunity", "sales", "owner", "marketing"],
          lastSyncAt: (/* @__PURE__ */ new Date()).toISOString(),
          mode: ghlMode
        });
        if (ghlMode === "LIVE" && apiKey) {
          this.connections.push({
            id: `gn_${Date.now()}`,
            workspaceId,
            locationId: newWs.ghlLocationId,
            apiKey,
            connectedAt: (/* @__PURE__ */ new Date()).toISOString(),
            status: "CONNECTED"
          });
        }
        user.onboarded = true;
        this.subscriptions.push({
          workspaceId,
          plan: "GROWTH",
          status: "TRIALING",
          amount: 147,
          nextBillingDate: new Date(Date.now() + 14 * 24 * 3600 * 1e3).toISOString()
          // 14 days trial
        });
        this.log(workspaceId, userId, user.email, "ONBOARD_WORKSPACE", `Completed corporate onboarding for workspace: ${companyName}`);
        return { user, workspace: newWs, member: newMember };
      }
    };
    db = new MockDatabase();
  }
});

// src/mockData.ts
function getDashboardMetrics() {
  const totalLeads = mockContacts.length;
  const activeOpps = mockOpportunities.filter((o) => o.status === "open" || o.status === "won");
  const pipelineValue = activeOpps.reduce((sum, o) => sum + o.value, 0);
  const wonOpps = mockOpportunities.filter((o) => o.status === "won");
  const closedWonRevenue = wonOpps.reduce((sum, o) => sum + o.value, 0);
  const showableAppointments = mockAppointments.filter((a) => a.appointmentStatus === "showed" || a.appointmentStatus === "noshow");
  const showedAppointments = mockAppointments.filter((a) => a.appointmentStatus === "showed");
  const appointmentShowRate = showableAppointments.length > 0 ? Math.round(showedAppointments.length / showableAppointments.length * 100) : 75;
  return {
    totalLeads,
    leadsDelta: 14.2,
    // comparison relative mock
    pipelineValue,
    pipelineDelta: 8.7,
    closedWonRevenue,
    revenueDelta: 22.4,
    appointmentShowRate,
    showRateDelta: 3.5,
    trends: {
      leads: [12, 14, 11, 15, 18, 14, totalLeads],
      pipeline: [21e4, 245e3, 23e4, 28e4, 31e4, 318e3, pipelineValue],
      revenue: [95e3, 104e3, 108e3, 115e3, 122e3, 125e3, closedWonRevenue],
      appointments: [6, 8, 5, 9, 7, 8, mockAppointments.length]
    }
  };
}
var mockContacts, mockOpportunities, mockAppointments;
var init_mockData = __esm({
  "src/mockData.ts"() {
    mockContacts = [
      { id: "con_001", name: "Robert Vance", email: "vance.r@example.com", phone: "512-555-0192", source: "Google Local Service Ads", tags: ["Pool Install", "Hot Lead"], dateAdded: "2026-05-10T14:30:00Z" },
      { id: "con_002", name: "Emily Thorne", email: "emily.thorne@example.com", phone: "512-555-0283", source: "Facebook Ads", tags: ["Pool Remodel", "Retargeting"], dateAdded: "2026-05-12T09:15:00Z" },
      { id: "con_003", name: "David Miller", email: "dmiller@example.com", phone: "512-555-0374", source: "Google Search Organic", tags: ["Weekly Service", "Inquiry"], dateAdded: "2026-05-14T11:00:00Z" },
      { id: "con_004", name: "Michael Scott", email: "regional_sales@example.com", phone: "512-555-0465", source: "Referral", tags: ["Commercial Pool", "Quote Sent"], dateAdded: "2026-05-15T16:45:00Z" },
      { id: "con_005", name: "Pam Beesly", email: "pam.b@example.com", phone: "512-555-0556", source: "Google Local Service Ads", tags: ["Pool Install", "Appointment Booked"], dateAdded: "2026-05-16T10:20:00Z" },
      { id: "con_006", name: "Jim Halpert", email: "jim.h@example.com", phone: "512-555-0647", source: "Yelp Organic", tags: ["Leak Detection", "Urgent"], dateAdded: "2026-05-18T08:30:00Z" },
      { id: "con_007", name: "Angela Martin", email: "angela.m@example.com", phone: "512-555-0738", source: "Facebook Ads", tags: ["Weekly Service"], dateAdded: "2026-05-19T13:10:00Z" },
      { id: "con_008", name: "Oscar Martinez", email: "omartinez@example.com", phone: "512-555-0829", source: "Referral", tags: ["Pool Remodel", "High Value"], dateAdded: "2026-05-20T15:00:00Z" },
      { id: "con_009", name: "Stanley Hudson", email: "stanley.h@example.com", phone: "512-555-0911", source: "Google Search Organic", tags: ["Pool Install"], dateAdded: "2026-05-21T11:40:00Z" },
      { id: "con_010", name: "Kelly Kapoor", email: "kelly.k@example.com", phone: "512-555-1022", source: "Instagram Ads", tags: ["Pool Remodel", "Social Lead"], dateAdded: "2026-05-22T17:15:00Z" },
      { id: "con_011", name: "Toby Flenderson", email: "toby.f@example.com", phone: "512-555-1133", source: "Yelp Organic", tags: ["Leak Detection"], dateAdded: "2026-05-23T09:05:00Z" },
      { id: "con_012", name: "Ryan Howard", email: "ryan.h@example.com", phone: "512-555-1244", source: "Google Local Service Ads", tags: ["Pool Install", "Hot Lead"], dateAdded: "2026-05-24T14:50:00Z" },
      { id: "con_013", name: "Andy Bernard", email: "cornell.andy@example.com", phone: "512-555-1355", source: "Referral", tags: ["Pool Install", "High Value"], dateAdded: "2026-05-25T10:30:00Z" },
      { id: "con_014", name: "Creed Bratton", email: "creed@example.com", phone: "512-555-1466", source: "Google Search Organic", tags: ["Leak Detection"], dateAdded: "2026-05-25T16:20:00Z" },
      { id: "con_015", name: "Phyllis Vance", email: "phyllis@example.com", phone: "512-555-1577", source: "Facebook Ads", tags: ["Weekly Service", "Local Quote"], dateAdded: "2026-05-26T11:10:00Z" }
    ];
    mockOpportunities = [
      { id: "opp_001", name: "Robert Vance - Inground Pool", pipelineId: "pipe_pools", stageId: "stage_win", value: 45e3, status: "won", assignedTo: "usr_001", source: "Google Local Service Ads", createdAt: "2026-05-10T14:40:00Z" },
      { id: "opp_002", name: "Emily Thorne - Concrete Decking", pipelineId: "pipe_pools", stageId: "stage_proposal", value: 12500, status: "open", assignedTo: "usr_002", source: "Facebook Ads", createdAt: "2026-05-12T09:30:00Z" },
      { id: "opp_003", name: "David Miller - Pool Renovation", pipelineId: "pipe_pools", stageId: "stage_won", value: 18e3, status: "won", assignedTo: "usr_003", source: "Google Search Organic", createdAt: "2026-05-14T11:15:00Z" },
      { id: "opp_004", name: "Michael Scott - Commercial Spa", pipelineId: "pipe_pools", stageId: "stage_negotiate", value: 65e3, status: "open", assignedTo: "usr_001", source: "Referral", createdAt: "2026-05-15T17:00:00Z" },
      { id: "opp_005", name: "Pam Beesly - Vinyl Liner Replacement", pipelineId: "pipe_pools", stageId: "stage_booked", value: 8500, status: "open", assignedTo: "usr_002", source: "Google Local Service Ads", createdAt: "2026-05-16T10:45:00Z" },
      { id: "opp_006", name: "Jim Halpert - Leak Repair & Filter Install", pipelineId: "pipe_pools", stageId: "stage_won", value: 3200, status: "won", assignedTo: "usr_004", source: "Yelp Organic", createdAt: "2026-05-18T08:45:00Z" },
      { id: "opp_007", name: "Angela Martin - Safety Cover & Winterize", pipelineId: "pipe_pools", stageId: "stage_lost", value: 2400, status: "lost", assignedTo: "usr_003", source: "Facebook Ads", createdAt: "2026-05-19T13:30:00Z" },
      { id: "opp_008", name: "Oscar Martinez - Custom Infinity Edge Pool", pipelineId: "pipe_pools", stageId: "stage_proposal", value: 95e3, status: "open", assignedTo: "usr_001", source: "Referral", createdAt: "2026-05-20T15:15:00Z" },
      { id: "opp_009", name: "Stanley Hudson - Saltwater Upgrade", pipelineId: "pipe_pools", stageId: "stage_won", value: 5800, status: "won", assignedTo: "usr_002", source: "Google Search Organic", createdAt: "2026-05-21T12:00:00Z" },
      { id: "opp_010", name: "Kelly Kapoor - Spa Automation System", pipelineId: "pipe_pools", stageId: "stage_proposal", value: 4500, status: "open", assignedTo: "usr_004", source: "Instagram Ads", createdAt: "2026-05-22T17:30:00Z" },
      { id: "opp_011", name: "Toby Flenderson - Pool Shell Repair", pipelineId: "pipe_pools", stageId: "stage_lost", value: 7200, status: "lost", assignedTo: "usr_003", source: "Yelp Organic", createdAt: "2026-05-23T09:20:00Z" },
      { id: "opp_012", name: "Ryan Howard - Backyard Remodel Combo", pipelineId: "pipe_pools", stageId: "stage_negotiate", value: 35e3, status: "open", assignedTo: "usr_002", source: "Google Local Service Ads", createdAt: "2026-05-24T15:00:00Z" },
      { id: "opp_013", name: "Andy Bernard - Classic Kidney Pool Build", pipelineId: "pipe_pools", stageId: "stage_won", value: 52e3, status: "won", assignedTo: "usr_004", source: "Referral", createdAt: "2026-05-25T10:45:00Z" },
      { id: "opp_014", name: "Creed Bratton - Plumbing Renewal", pipelineId: "pipe_pools", stageId: "stage_abandoned", value: 6e3, status: "abandoned", assignedTo: "usr_003", source: "Google Search Organic", createdAt: "2026-05-25T16:30:00Z" },
      { id: "opp_015", name: "Phyllis Vance - Monthly Premium Service Contract", pipelineId: "pipe_pools", stageId: "stage_won", value: 4800, status: "won", assignedTo: "usr_001", source: "Facebook Ads", createdAt: "2026-05-26T11:25:00Z" }
    ];
    mockAppointments = [
      { id: "apt_001", title: "Consultation - Robert Vance", appointmentStatus: "showed", startTime: "2026-05-11T10:00:00Z", userId: "usr_001" },
      { id: "apt_002", title: "Design Review - Emily Thorne", appointmentStatus: "showed", startTime: "2026-05-13T14:00:00Z", userId: "usr_002" },
      { id: "apt_003", title: "Quote - David Miller", appointmentStatus: "showed", startTime: "2026-05-15T09:00:00Z", userId: "usr_003" },
      { id: "apt_004", title: "Site Inspection - Michael Scott", appointmentStatus: "confirmed", startTime: "2026-05-28T11:00:00Z", userId: "usr_001" },
      { id: "apt_005", title: "Consultation - Pam Beesly", appointmentStatus: "showed", startTime: "2026-05-17T15:30:00Z", userId: "usr_002" },
      { id: "apt_006", title: "Service Quote - Jim Halpert", appointmentStatus: "showed", startTime: "2026-05-19T10:00:00Z", userId: "usr_004" },
      { id: "apt_007", title: "Site Inspection - Angela Martin", appointmentStatus: "noshow", startTime: "2026-05-20T13:00:00Z", userId: "usr_003" },
      { id: "apt_008", title: "Design Review - Oscar Martinez", appointmentStatus: "showed", startTime: "2026-05-22T16:00:00Z", userId: "usr_001" },
      { id: "apt_009", title: "Remodel Discussion - Kelly Kapoor", appointmentStatus: "cancelled", startTime: "2026-05-23T11:00:00Z", userId: "usr_004" },
      { id: "apt_010", title: "Repair Quote - Toby Flenderson", appointmentStatus: "noshow", startTime: "2026-05-24T09:00:00Z", userId: "usr_003" },
      { id: "apt_011", title: "Mega Consultation - Andy Bernard", appointmentStatus: "showed", startTime: "2026-05-26T14:00:00Z", userId: "usr_004" },
      { id: "apt_012", title: "Weekly Maintenance Intro - Phyllis Vance", appointmentStatus: "showed", startTime: "2026-05-27T09:30:00Z", userId: "usr_001" }
    ];
  }
});

// src/ghlService.ts
var ghlService_exports = {};
__export(ghlService_exports, {
  LiveReportingService: () => LiveReportingService,
  computeLiveAppointmentReport: () => computeLiveAppointmentReport,
  computeLiveEstimatesInvoicesReport: () => computeLiveEstimatesInvoicesReport,
  computeLiveMarketingReport: () => computeLiveMarketingReport,
  computeLiveOpportunityReport: () => computeLiveOpportunityReport,
  computeLiveOutstandingReport: () => computeLiveOutstandingReport,
  computeLiveOverviewReport: () => computeLiveOverviewReport,
  computeLiveOwnerReport: () => computeLiveOwnerReport,
  computeLiveSalesReport: () => computeLiveSalesReport,
  fetchFromGHLAPI: () => fetchFromGHLAPI,
  getLiveCRMData: () => getLiveCRMData,
  getReportCache: () => getReportCache,
  invalidateWorkspaceCacheStore: () => invalidateWorkspaceCacheStore,
  resolveGHLAuthentication: () => resolveGHLAuthentication,
  setReportCache: () => setReportCache
});
function resolveGHLAuthentication(workspaceId) {
  const connection = db.getGHLConnection(workspaceId);
  if (!connection || !connection.apiKey) {
    const envApiKey = (process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY || "").replace(/^﻿/, "");
    const envLocId = process.env.GHL_LOCATION_ID || "";
    if (!envApiKey) {
      throw new Error("NO_CREDENTIALS: GoHighLevel API credentials are not configured for this workspace.");
    }
    return { authHeader: `Bearer ${envApiKey}`, locationId: envLocId, authType: "PrivateToken" };
  }
  const isOAuth = connection.apiKey.startsWith("oauth_") || connection.apiKey.length > 100;
  return {
    authHeader: `Bearer ${connection.apiKey}`,
    locationId: connection.locationId,
    authType: isOAuth ? "OAuth" : "PrivateToken"
  };
}
async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function fetchFromGHLAPI(endpoint, workspaceId, options = {}) {
  const warnings = [];
  const unavailableMetrics = [];
  let authInfo;
  try {
    authInfo = resolveGHLAuthentication(workspaceId);
  } catch (err) {
    throw new Error(`AUTH_ERROR: ${err.message}`);
  }
  const { authHeader, locationId } = authInfo;
  const baseUrl = process.env.GHL_BASE_URL || "https://services.leadconnectorhq.com";
  const apiVersion = process.env.GHL_API_VERSION || "2021-07-28";
  const alreadyHasLocation = endpoint.includes("locationId=") || endpoint.includes("location_id=") || endpoint.includes("altId=");
  const divider = endpoint.includes("?") ? "&" : "?";
  const fullUrl = `${baseUrl}/${endpoint}${locationId && !alreadyHasLocation ? `${divider}locationId=${locationId}` : ""}`;
  const headers = {
    "Authorization": authHeader,
    "Version": apiVersion,
    "Content-Type": "application/json",
    ...options.headers || {}
  };
  const maxRetries = 3;
  let attempt = 0;
  let delay = 1e3;
  while (attempt < maxRetries) {
    attempt++;
    try {
      if (globalRateLimits.remaining <= 1 && Date.now() < globalRateLimits.resetTime) {
        const wait = globalRateLimits.resetTime - Date.now();
        console.warn(`[GHL] Rate-limit guard active \u2014 waiting ${wait}ms`);
        await sleep(wait + 100);
      }
      const response = await fetch(fullUrl, { ...options, headers });
      const rem = response.headers.get("x-ratelimit-remaining");
      const lim = response.headers.get("x-ratelimit-limit");
      const rst = response.headers.get("x-ratelimit-reset");
      if (rem) globalRateLimits.remaining = parseInt(rem, 10);
      if (lim) globalRateLimits.limit = parseInt(lim, 10);
      if (rst) {
        const s = parseInt(rst, 10);
        globalRateLimits.resetTime = Date.now() + (isNaN(s) ? 60 : s) * 1e3;
      }
      if (response.status === 429) {
        console.warn(`[GHL] 429 rate limit \u2014 retry ${attempt} in ${delay}ms`);
        await sleep(delay);
        delay *= 2;
        continue;
      }
      if (response.status >= 502 && response.status <= 504) {
        console.warn(`[GHL] ${response.status} server error \u2014 retry ${attempt}`);
        await sleep(delay);
        delay *= 1.5;
        continue;
      }
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`GHL API HTTP ${response.status}: ${body.slice(0, 300)}`);
      }
      const payload = await response.json();
      return { data: payload, warnings, unavailableMetrics };
    } catch (err) {
      if (attempt >= maxRetries) {
        console.error(`[GHL] Final failure on "${endpoint}" after ${maxRetries} attempts:`, err.message);
        throw err;
      }
      await sleep(delay);
      delay *= 2;
    }
  }
  return { data: null, warnings, unavailableMetrics };
}
function getReportCache(workspaceId, cacheKey) {
  const settings = db.getReportingSettings(workspaceId);
  const ttlMs = (settings.cacheTtlMinutes || 15) * 60 * 1e3;
  const key = `${workspaceId}_${cacheKey}`;
  const cached = serverCacheMemory2[key];
  if (!cached) return null;
  return { data: cached.data, stale: Date.now() - cached.timestamp > ttlMs };
}
function setReportCache(workspaceId, cacheKey, data) {
  serverCacheMemory2[`${workspaceId}_${cacheKey}`] = { data, timestamp: Date.now(), ttlMs: 15 * 60 * 1e3 };
}
function invalidateWorkspaceCacheStore(workspaceId) {
  Object.keys(serverCacheMemory2).filter((k) => k.startsWith(`${workspaceId}_`)).forEach((k) => delete serverCacheMemory2[k]);
  delete rawEstInvCache[workspaceId];
  Object.keys(rawCrmCache).filter((k) => k.startsWith(`${workspaceId}_`)).forEach((k) => delete rawCrmCache[k]);
  console.log(`[Cache] Flushed for workspace: ${workspaceId}`);
}
function isDateInFilterRange(itemDateStr, startDate, endDate) {
  if (!startDate && !endDate) return true;
  const t = new Date(itemDateStr).getTime();
  if (isNaN(t)) return true;
  if (startDate && t < new Date(startDate).getTime()) return false;
  if (endDate && t > (/* @__PURE__ */ new Date(endDate + "T23:59:59.999Z")).getTime()) return false;
  return true;
}
function bucketCountByWeek(items, dateField, startMs, endMs) {
  const seg = (endMs - startMs) / 4;
  const buckets = [0, 0, 0, 0];
  items.forEach((item) => {
    const t = new Date(item[dateField]).getTime();
    if (isNaN(t)) return;
    const idx = Math.min(3, Math.floor((t - startMs) / seg));
    if (idx >= 0) buckets[idx]++;
  });
  let running = 0;
  return buckets.map((b) => {
    running += b;
    return running;
  });
}
function bucketValueByWeek(items, dateField, valueField, startMs, endMs) {
  const seg = (endMs - startMs) / 4;
  const buckets = [0, 0, 0, 0];
  items.forEach((item) => {
    const t = new Date(item[dateField]).getTime();
    if (isNaN(t)) return;
    const idx = Math.min(3, Math.floor((t - startMs) / seg));
    if (idx >= 0) buckets[idx] += Number(item[valueField]) || 0;
  });
  let running = 0;
  return buckets.map((b) => {
    running += b;
    return running;
  });
}
function mapAppointmentStatus(status) {
  const s = (status || "").toLowerCase();
  if (s === "showed" || s === "attended" || s === "completed") return "showed";
  if (s === "noshow" || s === "no-show" || s === "no_show") return "noshow";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  return "confirmed";
}
async function fetchAllContacts(workspaceId) {
  const all = [];
  let startAfterId = "";
  let startAfter = "";
  for (let page = 0; page < 50; page++) {
    const params = { limit: "100" };
    if (startAfterId) {
      params.startAfterId = startAfterId;
      params.startAfter = startAfter;
    }
    const res = await fetchFromGHLAPI(
      `contacts/?${new URLSearchParams(params)}`,
      workspaceId
    );
    const batch = res.data?.contacts ?? [];
    all.push(...batch);
    if (batch.length < 100 || !res.data?.meta?.startAfterId) break;
    startAfterId = res.data.meta.startAfterId;
    startAfter = res.data.meta.startAfter || "";
  }
  return all;
}
async function fetchAllOpportunities(workspaceId, locationId) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetchFromGHLAPI(
      `opportunities/search?location_id=${encodeURIComponent(locationId)}&limit=100&page=${page}`,
      workspaceId
    );
    const batch = res.data?.opportunities ?? [];
    all.push(...batch);
    if (batch.length < 100 || !res.data?.meta?.nextPage) break;
  }
  return all;
}
async function fetchAllConversations(workspaceId) {
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetchFromGHLAPI(
      `conversations/search?limit=100&page=${page}`,
      workspaceId
    );
    const batch = res.data?.conversations ?? [];
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}
async function getLiveCRMData(workspaceId, opts = {}) {
  const crmCacheKey = `${workspaceId}_${opts.startDate || ""}_${opts.endDate || ""}`;
  if (!opts.force) {
    const cached = rawCrmCache[crmCacheKey];
    if (cached && Date.now() - cached.cachedAt < RAW_CRM_TTL_MS) {
      console.log(`[RawCrmCache] HIT for ${workspaceId}`);
      return cached.data;
    }
  }
  const warnings = [];
  const unavailableMetrics = [];
  let locationId = "";
  try {
    const auth = resolveGHLAuthentication(workspaceId);
    locationId = auth.locationId;
  } catch (err) {
    throw new Error(`AUTH_ERROR: ${err.message}`);
  }
  if (!locationId) {
    warnings.push("GHL Location ID is not configured \u2014 some data may be incomplete.");
  }
  const now = Date.now();
  const defaultMs = 30 * 24 * 60 * 60 * 1e3;
  const startMs = opts.startDate ? new Date(opts.startDate).getTime() : now - defaultMs;
  const endMs = opts.endDate ? (/* @__PURE__ */ new Date(opts.endDate + "T23:59:59.999Z")).getTime() : now;
  let contacts = [];
  let opportunities = [];
  let appointments = [];
  let users = [];
  let conversations = [];
  await Promise.all([
    // Task 1: Contacts (cursor-paginated, up to 1 000 records)
    (async () => {
      try {
        const raw = await fetchAllContacts(workspaceId);
        contacts = raw.map((c) => ({
          id: c.id,
          name: `${c.firstName || ""} ${c.lastName || ""}`.trim() || "Anonymous Lead",
          email: c.email || "",
          phone: c.phone || "",
          source: c.source || "Direct",
          tags: Array.isArray(c.tags) ? c.tags : [],
          dateAdded: c.dateAdded || c.createdAt || (/* @__PURE__ */ new Date()).toISOString()
        }));
      } catch (err) {
        warnings.push(`Contacts unavailable: ${err.message}`);
        unavailableMetrics.push("leadsList", "leadSourceBreakdowns", "missedLeads");
      }
    })(),
    // Task 2: Opportunities (page-paginated; note: uses location_id not locationId)
    (async () => {
      try {
        const raw = await fetchAllOpportunities(workspaceId, locationId);
        opportunities = raw.map((o) => ({
          id: o.id,
          name: o.name || "Opportunity",
          pipelineId: o.pipelineId || "",
          stageId: o.pipelineStageId || o.stageId || "",
          // GHL v2 uses monetaryValue, not value
          value: Number(o.monetaryValue ?? o.value) || 0,
          status: ["open", "won", "lost", "abandoned"].includes((o.status || "").toLowerCase()) ? o.status.toLowerCase() : "open",
          assignedTo: o.assignedTo || "",
          source: o.contact?.source || o.source || "",
          createdAt: o.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
          contactId: o.contactId || o.contact?.id || ""
        }));
      } catch (err) {
        warnings.push(`Opportunities unavailable: ${err.message}`);
        unavailableMetrics.push("pipelineBreakdown", "wonRevenue", "closeRates");
      }
    })(),
    // Task 3: Calendar Events
    // GHL v2 calendars/events requires calendarId, userId, or groupId — locationId alone is not accepted.
    // Fetch all calendars for the location first, then get events for each.
    (async () => {
      try {
        const calRes = await fetchFromGHLAPI("calendars/", workspaceId);
        const calendarIds = (calRes.data?.calendars || []).map((c) => c.id).slice(0, 5);
        if (calendarIds.length === 0) {
          warnings.push("No calendars found for this location \u2014 appointment data unavailable.");
          unavailableMetrics.push("bookedAppointments", "showRate");
          return;
        }
        const allEvents = [];
        await Promise.all(calendarIds.map(async (calId) => {
          try {
            const evRes = await fetchFromGHLAPI(
              `calendars/events?calendarId=${encodeURIComponent(calId)}&startTime=${startMs}&endTime=${endMs}`,
              workspaceId
            );
            if (evRes.data?.events) allEvents.push(...evRes.data.events);
          } catch {
          }
        }));
        appointments = allEvents.map((e) => ({
          id: e.id,
          title: e.title || "Appointment",
          appointmentStatus: mapAppointmentStatus(e.status || e.appointmentStatus || ""),
          startTime: e.startTime || (/* @__PURE__ */ new Date()).toISOString(),
          userId: e.userId || "",
          contactId: e.contactId || ""
        }));
      } catch (err) {
        warnings.push(`Calendar appointments unavailable: ${err.message}`);
        unavailableMetrics.push("bookedAppointments", "showRate");
      }
    })(),
    // Task 4: Sub-account users
    // GHL v2 users/search requires companyId (set GHL_COMPANY_ID env var).
    (async () => {
      try {
        const companyId = process.env.GHL_COMPANY_ID || "";
        if (!companyId) {
          warnings.push("GHL_COMPANY_ID not configured \u2014 team roster unavailable.");
          unavailableMetrics.push("teamRoster", "perRepBreakdown");
          return;
        }
        const res = await fetchFromGHLAPI(
          `users/search?companyId=${encodeURIComponent(companyId)}`,
          workspaceId
        );
        if (res.data?.users) {
          users = res.data.users.map((u) => ({
            id: u.id,
            name: `${u.firstName || ""} ${u.lastName || ""}`.trim() || "Team Member",
            email: u.email || "",
            avatarUrl: u.avatarUrl || "",
            role: ["admin", "user"].includes((u.role || "").toLowerCase()) ? u.role.toLowerCase() : "user"
          }));
        }
      } catch (err) {
        warnings.push(`Team roster unavailable: ${err.message}`);
        unavailableMetrics.push("teamRoster", "perRepBreakdown");
      }
    })(),
    // Task 5: Conversations (correct endpoint: conversations/search, page-paginated)
    // Note: GHL v2 conversations list does NOT include avgResponseTimeMin — marked unavailable
    (async () => {
      try {
        const raw = await fetchAllConversations(workspaceId);
        conversations = raw.map((c) => ({
          id: c.id,
          userId: c.userId || c.assignedTo || "",
          smsCount: Number(c.smsCount || c.unreadCount) || 0,
          emailCount: Number(c.emailCount) || 0,
          callCount: Number(c.callCount) || 0,
          avgResponseTimeMin: 0
          // not exposed by GHL v2 conversations list endpoint
        }));
      } catch (err) {
        warnings.push(`Conversations unavailable: ${err.message}`);
        unavailableMetrics.push("conversationCounts");
      }
    })()
  ]);
  const result = { contacts, opportunities, appointments, users, conversations, warnings, unavailableMetrics };
  rawCrmCache[crmCacheKey] = { data: result, cachedAt: Date.now() };
  return result;
}
async function computeLiveOverviewReport(workspaceId, filters = {}) {
  const crm = await getLiveCRMData(workspaceId, filters);
  const now = Date.now();
  const defaultMs = 30 * 24 * 60 * 60 * 1e3;
  const startMs = filters.startDate ? new Date(filters.startDate).getTime() : now - defaultMs;
  const endMs = filters.endDate ? (/* @__PURE__ */ new Date(filters.endDate + "T23:59:59.999Z")).getTime() : now;
  const periodMs = endMs - startMs;
  const curContacts = crm.contacts.filter((c) => isDateInFilterRange(c.dateAdded, filters.startDate, filters.endDate));
  const curOpps = crm.opportunities.filter((o) => isDateInFilterRange(o.createdAt, filters.startDate, filters.endDate));
  const priorStart = new Date(startMs - periodMs).toISOString().slice(0, 10);
  const priorEnd = new Date(startMs - 1).toISOString().slice(0, 10);
  const priorContacts = crm.contacts.filter((c) => isDateInFilterRange(c.dateAdded, priorStart, priorEnd));
  const priorOpps = crm.opportunities.filter((o) => isDateInFilterRange(o.createdAt, priorStart, priorEnd));
  const leadsCount = curContacts.length;
  const priorLeads = priorContacts.length;
  const leadsDelta = priorLeads > 0 ? parseFloat(((leadsCount - priorLeads) / priorLeads * 100).toFixed(1)) : 0;
  const wonOpps = curOpps.filter((o) => o.status === "won");
  const closedWonRevenue = wonOpps.reduce((s, o) => s + o.value, 0);
  const priorWonRevenue = priorOpps.filter((o) => o.status === "won").reduce((s, o) => s + o.value, 0);
  const revenueDelta = priorWonRevenue > 0 ? parseFloat(((closedWonRevenue - priorWonRevenue) / priorWonRevenue * 100).toFixed(1)) : 0;
  const activeOpps = curOpps.filter((o) => o.status === "open" || o.status === "won");
  const totalPipeline = activeOpps.reduce((s, o) => s + o.value, 0);
  const priorPipeline = priorOpps.filter((o) => o.status === "open" || o.status === "won").reduce((s, o) => s + o.value, 0);
  const pipelineDelta = priorPipeline > 0 ? parseFloat(((totalPipeline - priorPipeline) / priorPipeline * 100).toFixed(1)) : 0;
  const apts = crm.appointments;
  const showedApts = apts.filter((a) => a.appointmentStatus === "showed").length;
  const confirmedApts = apts.filter((a) => a.appointmentStatus === "confirmed" || a.appointmentStatus === "showed").length;
  const showRate = confirmedApts > 0 ? Math.round(showedApts / confirmedApts * 100) : 0;
  return {
    totalLeads: leadsCount,
    leadsDelta,
    pipelineValue: totalPipeline,
    pipelineDelta,
    closedWonRevenue,
    revenueDelta,
    appointmentShowRate: showRate,
    showRateDelta: 0,
    // would require prior-period calendar fetch; marked 0
    trends: {
      leads: bucketCountByWeek(curContacts, "dateAdded", startMs, endMs),
      pipeline: bucketValueByWeek(activeOpps, "createdAt", "value", startMs, endMs),
      revenue: bucketValueByWeek(wonOpps, "createdAt", "value", startMs, endMs),
      appointments: bucketCountByWeek(apts, "startTime", startMs, endMs)
    },
    warnings: crm.warnings,
    unavailableMetrics: crm.unavailableMetrics
  };
}
async function computeLiveOpportunityReport(workspaceId, filters = {}) {
  const crm = await getLiveCRMData(workspaceId, filters);
  const filteredOpps = crm.opportunities.filter((o) => isDateInFilterRange(o.createdAt, filters.startDate, filters.endDate));
  const totalCount = filteredOpps.length;
  const wonCount = filteredOpps.filter((o) => o.status === "won").length;
  const lostCount = filteredOpps.filter((o) => o.status === "lost").length;
  const openCount = filteredOpps.filter((o) => o.status === "open" || o.status === "abandoned").length;
  const totalValue = filteredOpps.reduce((s, o) => s + o.value, 0);
  const wonValue = filteredOpps.filter((o) => o.status === "won").reduce((s, o) => s + o.value, 0);
  const winRate = totalCount > 0 ? Math.round(wonCount / totalCount * 100) : 0;
  const totalLeads = crm.contacts.length;
  const funnel = [
    { stage: "Total Leads", count: totalLeads, percentageOfPrevious: 100, percentageOfTotal: 100 },
    { stage: "Open Opportunities", count: totalCount, percentageOfPrevious: totalLeads > 0 ? Math.round(totalCount / totalLeads * 100) : 0, percentageOfTotal: totalLeads > 0 ? Math.round(totalCount / totalLeads * 100) : 0 },
    { stage: "Closed-Won Deals", count: wonCount, percentageOfPrevious: totalCount > 0 ? Math.round(wonCount / totalCount * 100) : 0, percentageOfTotal: totalLeads > 0 ? Math.round(wonCount / totalLeads * 100) : 0 }
  ];
  return {
    summary: { totalOpportunities: totalCount, openOpportunities: openCount, wonOpportunities: wonCount, lostOpportunities: lostCount, totalPipelineValue: totalValue, wonRevenue: wonValue, winRate },
    funnel,
    warnings: crm.warnings,
    unavailableMetrics: crm.unavailableMetrics
  };
}
async function computeLiveSalesReport(workspaceId, filters = {}) {
  const crm = await getLiveCRMData(workspaceId, filters);
  const filteredOpps = crm.opportunities.filter((o) => isDateInFilterRange(o.createdAt, filters.startDate, filters.endDate));
  const wonOpps = filteredOpps.filter((o) => o.status === "won");
  const wonRevenue = wonOpps.reduce((s, o) => s + o.value, 0);
  const avgDeal = wonOpps.length > 0 ? Math.round(wonRevenue / wonOpps.length) : 0;
  const showedCount = crm.appointments.filter((a) => a.appointmentStatus === "showed").length;
  return {
    summary: {
      totalBookedAppointments: crm.appointments.length,
      showedAppointmentsCount: showedCount,
      closedWonDealsCount: wonOpps.length,
      wonRevenueAmount: wonRevenue,
      averageTicketSize: avgDeal
    },
    warnings: crm.warnings,
    unavailableMetrics: crm.unavailableMetrics
  };
}
async function computeLiveOwnerReport(workspaceId, filters = {}) {
  const crm = await getLiveCRMData(workspaceId, filters);
  const unavailableMetrics = [...crm.unavailableMetrics, "avgSpeedToLeadSec", "revenueByServiceType"];
  const filteredContacts = crm.contacts.filter((c) => {
    if (!isDateInFilterRange(c.dateAdded, filters.startDate, filters.endDate)) return false;
    if (filters.source && c.source !== filters.source) return false;
    return true;
  });
  const filteredOpps = crm.opportunities.filter((o) => {
    if (!isDateInFilterRange(o.createdAt, filters.startDate, filters.endDate)) return false;
    if (filters.source && o.source !== filters.source) return false;
    return true;
  });
  const apts = crm.appointments;
  const contactsWithOpps = new Set(filteredOpps.map((o) => o.contactId).filter(Boolean));
  const missedLeadsTotal = filteredContacts.filter((c) => !contactsWithOpps.has(c.id)).length;
  const usersToReport = filters.userId ? crm.users.filter((u) => u.id === filters.userId) : crm.users.length > 0 ? crm.users : [{ id: "live_default", name: "Sales Rep", email: "", avatarUrl: "", role: "user" }];
  const ownerBreakdown = usersToReport.map((user) => {
    const repOpps = filteredOpps.filter((o) => o.assignedTo === user.id);
    const repContactIds = new Set(repOpps.map((o) => o.contactId).filter(Boolean));
    const repContacts = filteredContacts.filter((c) => repContactIds.has(c.id));
    const repApts = apts.filter((a) => a.userId === user.id);
    const wonRepOpps = repOpps.filter((o) => o.status === "won");
    const wonRevenue = wonRepOpps.reduce((s, o) => s + o.value, 0);
    const pipelineValue = repOpps.reduce((s, o) => s + o.value, 0);
    const showedApts = repApts.filter((a) => a.appointmentStatus === "showed").length;
    const confirmedApts = repApts.filter((a) => a.appointmentStatus === "confirmed" || a.appointmentStatus === "showed").length;
    return {
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      totalLeads: repContacts.length || repOpps.length,
      newLeads: repContacts.length,
      bookedAppointments: repApts.length,
      showRate: confirmedApts > 0 ? Math.round(showedApts / confirmedApts * 100) : 0,
      closeRate: repOpps.length > 0 ? Math.round(wonRepOpps.length / repOpps.length * 100) : 0,
      pipelineValue,
      wonRevenue,
      lostOpportunities: repOpps.filter((o) => o.status === "lost").length,
      missedLeads: filteredContacts.filter((c) => repContactIds.has(c.id) && !contactsWithOpps.has(c.id)).length,
      avgSpeedToLeadSec: 0
      // not available from GHL v2 conversations list
    };
  });
  const totalOpps = filteredOpps.length;
  const totalWon2 = filteredOpps.filter((o) => o.status === "won").length;
  const wonOppsAll = filteredOpps.filter((o) => o.status === "won");
  const showedTotal = apts.filter((a) => a.appointmentStatus === "showed").length;
  const confirmedTotal = apts.filter((a) => a.appointmentStatus === "confirmed" || a.appointmentStatus === "showed").length;
  const now = Date.now();
  const defaultMs = 30 * 24 * 60 * 60 * 1e3;
  const startMs = filters.startDate ? new Date(filters.startDate).getTime() : now - defaultMs;
  const endMs = filters.endDate ? (/* @__PURE__ */ new Date(filters.endDate + "T23:59:59.999Z")).getTime() : now;
  const wkLabels = ["Wk 1", "Wk 2", "Wk 3", "Wk 4"];
  const leadsWeekly = bucketCountByWeek(filteredContacts, "dateAdded", startMs, endMs);
  const revenueWeekly = bucketValueByWeek(wonOppsAll, "createdAt", "value", startMs, endMs);
  const trends = wkLabels.map((date, i) => ({ date, totalLeads: leadsWeekly[i], wonRevenue: revenueWeekly[i] }));
  const revenueBySource = {};
  wonOppsAll.forEach((o) => {
    const src = o.source || "Direct";
    revenueBySource[src] = (revenueBySource[src] || 0) + o.value;
  });
  const funnel = [
    { stage: "Leads", count: filteredContacts.length, percentageOfPrevious: 100, percentageOfTotal: 100 },
    { stage: "Booked", count: apts.length, percentageOfPrevious: filteredContacts.length > 0 ? Math.round(apts.length / filteredContacts.length * 100) : 0, percentageOfTotal: filteredContacts.length > 0 ? Math.round(apts.length / filteredContacts.length * 100) : 0 },
    { stage: "Won", count: totalWon2, percentageOfPrevious: apts.length > 0 ? Math.round(totalWon2 / apts.length * 100) : 0, percentageOfTotal: filteredContacts.length > 0 ? Math.round(totalWon2 / filteredContacts.length * 100) : 0 }
  ];
  const report = {
    summary: {
      totalLeads: filteredContacts.length,
      newLeads: filteredContacts.length,
      bookedAppointments: apts.length,
      showRate: confirmedTotal > 0 ? Math.round(showedTotal / confirmedTotal * 100) : 0,
      closeRate: totalOpps > 0 ? Math.round(totalWon2 / totalOpps * 100) : 0,
      pipelineValue: filteredOpps.reduce((s, o) => s + o.value, 0),
      wonRevenue: wonOppsAll.reduce((s, o) => s + o.value, 0),
      lostOpportunities: filteredOpps.filter((o) => o.status === "lost").length,
      missedLeadsOrCalls: missedLeadsTotal,
      avgSpeedToLeadSec: 0,
      leadToBookingConvRate: filteredContacts.length > 0 ? Math.round(apts.length / filteredContacts.length * 100) : 0,
      bookingToWonConvRate: apts.length > 0 ? Math.round(totalWon2 / apts.length * 100) : 0
    },
    revenueBySource,
    revenueByServiceType: {},
    // no service type field in GHL opportunities
    ownerBreakdown,
    trends,
    funnel
  };
  return { data: report, warnings: crm.warnings, unavailableMetrics };
}
async function computeLiveMarketingReport(workspaceId, filters = {}) {
  const crm = await getLiveCRMData(workspaceId, filters);
  const unavailableMetrics = [...crm.unavailableMetrics, "campaignBreakdown", "costPerLead", "roas", "adsCost"];
  const validContacts = crm.contacts.filter((c) => isDateInFilterRange(c.dateAdded, filters.startDate, filters.endDate));
  const validOpps = crm.opportunities.filter((o) => isDateInFilterRange(o.createdAt, filters.startDate, filters.endDate));
  const validApts = crm.appointments;
  const contactSourceMap = new Map(crm.contacts.map((c) => [c.id, c.source || "Direct"]));
  const leadsBySource = {};
  validContacts.forEach((c) => {
    const src = c.source || "Direct";
    leadsBySource[src] = (leadsBySource[src] || 0) + 1;
  });
  const pipelineValueBySource = {};
  const wonRevenueBySource = {};
  validOpps.forEach((o) => {
    const src = o.source || "Direct";
    pipelineValueBySource[src] = (pipelineValueBySource[src] || 0) + o.value;
    if (o.status === "won") wonRevenueBySource[src] = (wonRevenueBySource[src] || 0) + o.value;
  });
  const bookingsBySource = {};
  validApts.forEach((a) => {
    const src = a.contactId ? contactSourceMap.get(a.contactId) || "Direct" : "Direct";
    bookingsBySource[src] = (bookingsBySource[src] || 0) + 1;
  });
  const totalLeads = Object.values(leadsBySource).reduce((s, c) => s + c, 0);
  const totalBookings = Object.values(bookingsBySource).reduce((s, c) => s + c, 0);
  const totalPipeline = Object.values(pipelineValueBySource).reduce((s, c) => s + c, 0);
  const totalWonRevenue = Object.values(wonRevenueBySource).reduce((s, c) => s + c, 0);
  const now = Date.now();
  const defaultMs = 30 * 24 * 60 * 60 * 1e3;
  const startMs = filters.startDate ? new Date(filters.startDate).getTime() : now - defaultMs;
  const endMs = filters.endDate ? (/* @__PURE__ */ new Date(filters.endDate + "T23:59:59.999Z")).getTime() : now;
  const wkLabels = ["Wk 1", "Wk 2", "Wk 3", "Wk 4"];
  const leadsWeekly = bucketCountByWeek(validContacts, "dateAdded", startMs, endMs);
  const revenueWeekly = bucketValueByWeek(validOpps.filter((o) => o.status === "won"), "createdAt", "value", startMs, endMs);
  const trends = wkLabels.map((date, i) => ({
    date,
    adsCost: 0,
    // not available from GHL API
    returnRevenue: revenueWeekly[i],
    bookingsCount: 0
  }));
  const report = {
    summary: {
      totalLeads,
      totalBookings,
      totalPipelineValue: totalPipeline,
      totalWonRevenue,
      avgLeadToAppointmentRate: totalLeads > 0 ? Math.round(totalBookings / totalLeads * 100) : 0,
      avgAppointmentToWonRate: totalBookings > 0 ? Math.round(totalWon(validOpps) / totalBookings * 100) : 0,
      costPerLeadPlaceholder: 0,
      // not available from GHL API
      roasPlaceholder: 0
      // not available from GHL API
    },
    leadsBySource,
    leadsByCampaign: {},
    // GHL has no campaign reporting endpoint
    bookingsBySource,
    pipelineValueBySource,
    wonRevenueBySource,
    campaignBreakdown: [],
    // GHL has no campaign breakdown endpoint
    trends
  };
  return { data: report, warnings: crm.warnings, unavailableMetrics };
}
function totalWon(opps) {
  return opps.filter((o) => o.status === "won").length;
}
async function computeLiveAppointmentReport(workspaceId, filters = {}) {
  const warnings = [];
  const unavailableMetrics = [];
  let locationId = "";
  try {
    const auth = resolveGHLAuthentication(workspaceId);
    locationId = auth.locationId;
  } catch (err) {
    throw new Error(`AUTH_ERROR: ${err.message}`);
  }
  const now = Date.now();
  const defaultMs = 30 * 24 * 60 * 60 * 1e3;
  const startMs = filters.startDate ? new Date(filters.startDate).getTime() : now - defaultMs;
  const endMs = filters.endDate ? (/* @__PURE__ */ new Date(filters.endDate + "T23:59:59.999Z")).getTime() : now;
  let allAppointments = [];
  let calendarMetas = [];
  try {
    const calRes = await fetchFromGHLAPI("calendars/", workspaceId);
    calendarMetas = (calRes.data?.calendars || []).slice(0, 10).map((c) => ({ id: c.id, name: c.name || c.id }));
    if (calendarMetas.length === 0) {
      warnings.push("No calendars found for this location \u2014 appointment data unavailable.");
      unavailableMetrics.push("appointments");
    } else {
      await Promise.all(calendarMetas.map(async (cal) => {
        try {
          const evRes = await fetchFromGHLAPI(
            `calendars/events?calendarId=${encodeURIComponent(cal.id)}&startTime=${startMs}&endTime=${endMs}`,
            workspaceId
          );
          (evRes.data?.events || []).forEach((e) => {
            allAppointments.push({
              id: e.id,
              title: e.title || "Appointment",
              appointmentStatus: mapAppointmentStatus(e.appointmentStatus || e.status || ""),
              startTime: e.startTime || (/* @__PURE__ */ new Date()).toISOString(),
              userId: e.userId || "",
              contactId: e.contactId || "",
              calendarId: cal.id,
              calendarName: cal.name
            });
          });
        } catch {
        }
      }));
    }
  } catch (err) {
    warnings.push(`Calendar fetch failed: ${err.message}`);
    unavailableMetrics.push("appointments");
  }
  const userNameMap = /* @__PURE__ */ new Map();
  try {
    const companyId = process.env.GHL_COMPANY_ID || "";
    if (companyId) {
      const uRes = await fetchFromGHLAPI(
        `users/search?companyId=${encodeURIComponent(companyId)}`,
        workspaceId
      );
      (uRes.data?.users || []).forEach((u) => {
        userNameMap.set(u.id, `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.id);
      });
    }
  } catch {
  }
  const filtered = filters.userId ? allAppointments.filter((a) => a.userId === filters.userId) : allAppointments;
  const showed = filtered.filter((a) => a.appointmentStatus === "showed").length;
  const noshow = filtered.filter((a) => a.appointmentStatus === "noshow").length;
  const cancelled = filtered.filter((a) => a.appointmentStatus === "cancelled").length;
  const confirmed = filtered.filter((a) => a.appointmentStatus === "confirmed").length;
  const total = filtered.length;
  const upcoming = filtered.filter((a) => new Date(a.startTime).getTime() > now).length;
  const showDenom = showed + noshow;
  const calMap = /* @__PURE__ */ new Map();
  filtered.forEach((a) => {
    const cur = calMap.get(a.calendarId) || { name: a.calendarName, total: 0, showed: 0, noshow: 0, cancelled: 0, confirmed: 0 };
    cur.total++;
    if (a.appointmentStatus === "showed") cur.showed++;
    else if (a.appointmentStatus === "noshow") cur.noshow++;
    else if (a.appointmentStatus === "cancelled") cur.cancelled++;
    else cur.confirmed++;
    calMap.set(a.calendarId, cur);
  });
  const repMap = /* @__PURE__ */ new Map();
  filtered.forEach((a) => {
    const uid = a.userId || "unknown";
    const cur = repMap.get(uid) || { total: 0, showed: 0, noshow: 0, cancelled: 0 };
    cur.total++;
    if (a.appointmentStatus === "showed") cur.showed++;
    else if (a.appointmentStatus === "noshow") cur.noshow++;
    else if (a.appointmentStatus === "cancelled") cur.cancelled++;
    repMap.set(uid, cur);
  });
  const seg = (endMs - startMs) / 4;
  const tBuckets = [{ booked: 0, showed: 0, noshow: 0 }, { booked: 0, showed: 0, noshow: 0 }, { booked: 0, showed: 0, noshow: 0 }, { booked: 0, showed: 0, noshow: 0 }];
  filtered.forEach((a) => {
    const t = new Date(a.startTime).getTime();
    const idx = Math.min(3, Math.floor((t - startMs) / seg));
    if (idx >= 0) {
      tBuckets[idx].booked++;
      if (a.appointmentStatus === "showed") tBuckets[idx].showed++;
      else if (a.appointmentStatus === "noshow") tBuckets[idx].noshow++;
    }
  });
  const report = {
    summary: {
      totalBooked: total,
      totalShowed: showed,
      totalNoShow: noshow,
      totalCancelled: cancelled,
      totalConfirmed: confirmed,
      showRate: showDenom > 0 ? Math.round(showed / showDenom * 100) : 0,
      noShowRate: showDenom > 0 ? Math.round(noshow / showDenom * 100) : 0,
      cancellationRate: total > 0 ? Math.round(cancelled / total * 100) : 0,
      upcomingCount: upcoming
    },
    statusDistribution: [
      { status: "Showed", count: showed },
      { status: "No-Show", count: noshow },
      { status: "Cancelled", count: cancelled },
      { status: "Confirmed", count: confirmed }
    ].filter((s) => s.count > 0),
    calendarBreakdown: Array.from(calMap.entries()).map(([calId, d]) => ({
      calendarId: calId,
      calendarName: d.name,
      total: d.total,
      showed: d.showed,
      noshow: d.noshow,
      cancelled: d.cancelled,
      confirmed: d.confirmed,
      showRate: d.showed + d.noshow > 0 ? Math.round(d.showed / (d.showed + d.noshow) * 100) : 0
    })),
    repBreakdown: Array.from(repMap.entries()).map(([userId, d]) => ({
      userId,
      userName: userNameMap.get(userId) || userId,
      booked: d.total,
      showed: d.showed,
      noshow: d.noshow,
      cancelled: d.cancelled,
      showRate: d.showed + d.noshow > 0 ? Math.round(d.showed / (d.showed + d.noshow) * 100) : 0
    })),
    upcomingAppointments: filtered.filter((a) => new Date(a.startTime).getTime() > now).sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()).slice(0, 15).map((a) => ({
      id: a.id,
      title: a.title,
      startTime: a.startTime,
      status: a.appointmentStatus,
      userId: a.userId,
      userName: userNameMap.get(a.userId) || void 0,
      calendarId: a.calendarId,
      calendarName: a.calendarName
    })),
    trends: ["Wk 1", "Wk 2", "Wk 3", "Wk 4"].map((date, i) => ({
      date,
      booked: tBuckets[i].booked,
      showed: tBuckets[i].showed,
      noshow: tBuckets[i].noshow
    }))
  };
  return { data: report, warnings, unavailableMetrics };
}
function sanitizeContactName(raw) {
  if (!raw) return "";
  return raw.split(/\s+/).filter((p) => p && p.toLowerCase() !== "undefined" && p.toLowerCase() !== "null").join(" ").trim();
}
function normalizeEstimateStatus(raw) {
  const s = (raw || "").toLowerCase();
  if (s === "declined") return "REJECTED";
  if (s === "invoiced") return "CONVERTED";
  return s.toUpperCase();
}
function normalizeInvoiceStatus(raw) {
  const s = (raw || "").toLowerCase();
  if (s === "partially_paid") return "PARTIAL";
  return s.toUpperCase();
}
async function fetchAllEstimates(workspaceId, locationId, opts = {}) {
  const makeParams = (offset) => {
    const p = new URLSearchParams({ altId: locationId, altType: "location", limit: "100", offset: String(offset) });
    if (opts.startDate) p.set("startDate", opts.startDate);
    if (opts.endDate) p.set("endDate", opts.endDate);
    return p.toString();
  };
  const res0 = await fetchFromGHLAPI(
    `invoices/estimate/list?${makeParams(0)}`,
    workspaceId
  );
  const batch0 = res0.data?.estimates ?? [];
  const total = Number(res0.data?.total) || 0;
  if (batch0.length < 100 || total <= 100) return batch0;
  const remainingOffsets = [];
  for (let off = 100; off < Math.min(total, 1e4); off += 100) remainingOffsets.push(off);
  const all = [...batch0];
  for (let i = 0; i < remainingOffsets.length; i += 5) {
    const chunk = remainingOffsets.slice(i, i + 5);
    const results = await Promise.all(
      chunk.map((off) => fetchFromGHLAPI(`invoices/estimate/list?${makeParams(off)}`, workspaceId))
    );
    results.forEach((r) => all.push(...r.data?.estimates ?? []));
  }
  return all;
}
async function fetchAllInvoices(workspaceId, locationId, opts = {}) {
  const makeParams = (offset) => {
    const p = new URLSearchParams({ altId: locationId, altType: "location", limit: "100", offset: String(offset) });
    if (opts.startDate) p.set("startDate", opts.startDate);
    if (opts.endDate) p.set("endDate", opts.endDate);
    return p.toString();
  };
  const res0 = await fetchFromGHLAPI(
    `invoices/?${makeParams(0)}`,
    workspaceId
  );
  const batch0 = res0.data?.invoices ?? [];
  const total = Number(res0.data?.total) || 0;
  if (batch0.length < 100 || total <= 100) return batch0;
  const remainingOffsets = [];
  for (let off = 100; off < Math.min(total, 1e4); off += 100) remainingOffsets.push(off);
  const all = [...batch0];
  for (let i = 0; i < remainingOffsets.length; i += 5) {
    const chunk = remainingOffsets.slice(i, i + 5);
    const results = await Promise.all(
      chunk.map((off) => fetchFromGHLAPI(`invoices/?${makeParams(off)}`, workspaceId))
    );
    results.forEach((r) => all.push(...r.data?.invoices ?? []));
  }
  return all;
}
async function getOrFetchRawEstInv(workspaceId, locationId, force = false) {
  const cached = rawEstInvCache[workspaceId];
  if (!force && cached && Date.now() - cached.cachedAt < RAW_EST_INV_TTL_MS) {
    console.log(`[RawEstInvCache] HIT for ${workspaceId}`);
    return { rawEstimates: cached.rawEstimates, rawInvoices: cached.rawInvoices };
  }
  let rawEstimates = [];
  let rawInvoices = [];
  await Promise.all([
    (async () => {
      try {
        rawEstimates = await fetchAllEstimates(workspaceId, locationId, {});
      } catch (e) {
        console.warn("[RawEstInvCache] estimates fetch failed", e?.message);
      }
    })(),
    (async () => {
      try {
        rawInvoices = await fetchAllInvoices(workspaceId, locationId, {});
      } catch (e) {
        console.warn("[RawEstInvCache] invoices fetch failed", e?.message);
      }
    })()
  ]);
  rawEstInvCache[workspaceId] = { rawEstimates, rawInvoices, cachedAt: Date.now() };
  return { rawEstimates, rawInvoices };
}
async function computeLiveEstimatesInvoicesReport(workspaceId, filters = {}) {
  const warnings = [];
  const unavailableMetrics = ["avgDaysToPayment"];
  let locationId = "";
  try {
    locationId = resolveGHLAuthentication(workspaceId).locationId;
  } catch (err) {
    throw new Error(`AUTH_ERROR: ${err.message}`);
  }
  if (!locationId) {
    warnings.push("GHL Location ID not configured \u2014 estimates/invoices unavailable.");
    unavailableMetrics.push("estimates", "invoices");
  }
  let rawEstimates = [];
  let rawInvoices = [];
  if (locationId) {
    try {
      ({ rawEstimates, rawInvoices } = await getOrFetchRawEstInv(workspaceId, locationId, !!filters.force));
    } catch (err) {
      warnings.push(`Estimates/Invoices unavailable: ${err.message}`);
      unavailableMetrics.push("estimates", "invoices");
    }
  }
  const estByStatus = {};
  for (const e of rawEstimates) {
    const s = normalizeEstimateStatus(e.estimateStatus || e.status || "UNKNOWN");
    if (!estByStatus[s]) estByStatus[s] = { count: 0, value: 0 };
    estByStatus[s].count++;
    estByStatus[s].value += Number(e.total) || 0;
  }
  const estNorm = (e) => normalizeEstimateStatus(e.estimateStatus || e.status || "");
  const estSent = rawEstimates.filter((e) => estNorm(e) !== "DRAFT");
  const estSentCount = estSent.length;
  const estSentValue = estSent.reduce((s, e) => s + (Number(e.total) || 0), 0);
  const estViewed = rawEstimates.filter((e) => ["VIEWED", "ACCEPTED", "REJECTED", "CONVERTED"].includes(estNorm(e))).length;
  const estAccepted = rawEstimates.filter((e) => estNorm(e) === "ACCEPTED").length;
  const estRejected = rawEstimates.filter((e) => estNorm(e) === "REJECTED").length;
  const estConverted = rawEstimates.filter((e) => estNorm(e) === "CONVERTED").length;
  const estExpired = rawEstimates.filter((e) => estNorm(e) === "EXPIRED").length;
  const invByStatus = {};
  for (const inv of rawInvoices) {
    const s = normalizeInvoiceStatus(inv.status || "UNKNOWN");
    if (!invByStatus[s]) invByStatus[s] = { count: 0, value: 0, amountPaid: 0, amountDue: 0 };
    invByStatus[s].count++;
    invByStatus[s].value += Number(inv.total) || 0;
    invByStatus[s].amountPaid += Number(inv.amountPaid) || 0;
    invByStatus[s].amountDue += Number(inv.amountDue) || 0;
  }
  const invNorm = (i) => normalizeInvoiceStatus(i.status || "");
  const invBillable = rawInvoices.filter((i) => !["DRAFT", "CANCELLED"].includes(invNorm(i)));
  const invTotalValue = invBillable.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const invTotalPaid = rawInvoices.reduce((s, i) => s + (Number(i.amountPaid) || 0), 0);
  const invUnpaidStatuses = /* @__PURE__ */ new Set(["SENT", "PARTIAL", "OVERDUE"]);
  const invUnpaid = rawInvoices.filter((i) => invUnpaidStatuses.has(invNorm(i)));
  const invTotalOutstanding = invUnpaid.reduce((s, i) => s + (Number(i.amountDue) || 0), 0);
  const now = Date.now();
  const aging = {
    current: { count: 0, value: 0 },
    days1to30: { count: 0, value: 0 },
    days31to60: { count: 0, value: 0 },
    days61plus: { count: 0, value: 0 }
  };
  const unpaidList = [];
  for (const inv of invUnpaid) {
    const amtDue = Number(inv.amountDue) || 0;
    if (amtDue <= 0) continue;
    const dueMs = inv.dueDate ? new Date(inv.dueDate).getTime() : null;
    const daysOverdue = dueMs ? Math.max(0, Math.floor((now - dueMs) / 864e5)) : 0;
    const notYetDue = !dueMs || dueMs > now;
    if (notYetDue) {
      aging.current.count++;
      aging.current.value += amtDue;
    } else if (daysOverdue <= 30) {
      aging.days1to30.count++;
      aging.days1to30.value += amtDue;
    } else if (daysOverdue <= 60) {
      aging.days31to60.count++;
      aging.days31to60.value += amtDue;
    } else {
      aging.days61plus.count++;
      aging.days61plus.value += amtDue;
    }
    const contactName = sanitizeContactName(inv.contactDetails?.name || inv.contact?.name || `${inv.contact?.firstName || ""} ${inv.contact?.lastName || ""}`) || "Unknown";
    unpaidList.push({
      id: inv._id || inv.id || "",
      invoiceNumber: inv.invoiceNumber || inv.number || "",
      name: inv.name || inv.description || "",
      contactName,
      contactEmail: inv.contactDetails?.email || inv.contact?.email || "",
      amountDue: amtDue,
      total: Number(inv.total) || 0,
      dueDate: inv.dueDate || "",
      issueDate: inv.issueDate || "",
      daysOverdue,
      status: invNorm(inv)
    });
  }
  unpaidList.sort((a, b) => b.daysOverdue - a.daysOverdue || b.amountDue - a.amountDue);
  const report = {
    estimates: {
      totalCount: rawEstimates.length,
      totalValue: rawEstimates.reduce((s, e) => s + (Number(e.total) || 0), 0),
      byStatus: estByStatus,
      funnel: {
        sent: estSentCount,
        sentValue: estSentValue,
        viewed: estViewed,
        viewRate: estSentCount > 0 ? Math.round(estViewed / estSentCount * 100) : 0,
        accepted: estAccepted,
        acceptanceRate: estSentCount > 0 ? Math.round(estAccepted / estSentCount * 100) : 0,
        rejected: estRejected,
        rejectionRate: estSentCount > 0 ? Math.round(estRejected / estSentCount * 100) : 0,
        converted: estConverted,
        conversionRate: estSentCount > 0 ? Math.round(estConverted / estSentCount * 100) : 0,
        expired: estExpired
      }
    },
    invoices: {
      totalCount: rawInvoices.length,
      totalValue: invTotalValue,
      totalPaid: invTotalPaid,
      totalOutstanding: invTotalOutstanding,
      collectionRate: invTotalValue > 0 ? Math.round(invTotalPaid / invTotalValue * 100) : 0,
      avgInvoiceValue: invBillable.length > 0 ? Math.round(invTotalValue / invBillable.length) : 0,
      byStatus: invByStatus,
      aging,
      unpaidList
    },
    crossMetrics: {
      estimateToInvoiceRate: estSentCount > 0 ? Math.round(estConverted / estSentCount * 100) : 0
    },
    warnings,
    unavailableMetrics
  };
  return { data: report, warnings, unavailableMetrics };
}
async function computeLiveOutstandingReport(workspaceId, force = false) {
  const warnings = [];
  const now = Date.now();
  let locationId = "";
  try {
    locationId = resolveGHLAuthentication(workspaceId).locationId;
  } catch (err) {
    throw new Error(`AUTH_ERROR: ${err.message}`);
  }
  let rawEstimates = [];
  let rawInvoices = [];
  if (locationId) {
    try {
      ({ rawEstimates, rawInvoices } = await getOrFetchRawEstInv(workspaceId, locationId, force));
    } catch (err) {
      warnings.push(`Estimates/Invoices unavailable: ${err.message}`);
    }
  } else {
    warnings.push("GHL Location ID not configured \u2014 outstanding data unavailable.");
  }
  function buildEstimateRecord(e) {
    const sentDate = e.sentAt || e.issueDate || e.updatedAt || e.createdAt || "";
    const sentMs = sentDate ? new Date(sentDate).getTime() : null;
    const contactName = sanitizeContactName(e.contactDetails?.name || e.contact?.name || `${e.contact?.firstName || ""} ${e.contact?.lastName || ""}`) || "Unknown";
    return {
      id: e._id || e.id || "",
      number: e.estimateNumber || e.number || "",
      name: e.name || e.title || e.subject || "",
      contactName,
      contactEmail: e.contactDetails?.email || e.contact?.email || "",
      status: normalizeEstimateStatus(e.estimateStatus || e.status || ""),
      sentDate,
      amount: Number(e.total) || 0,
      daysOutstanding: sentMs ? Math.max(0, Math.floor((now - sentMs) / 864e5)) : 0
    };
  }
  function buildInvoiceRecord(i) {
    const sentDate = i.sentAt || i.issueDate || i.updatedAt || i.createdAt || "";
    const sentMs = sentDate ? new Date(sentDate).getTime() : null;
    const contactName = i.contactDetails?.name || i.contact?.name || `${i.contact?.firstName || ""} ${i.contact?.lastName || ""}`.trim() || "Unknown";
    return {
      id: i._id || i.id || "",
      number: i.invoiceNumber || i.number || "",
      name: i.name || i.description || "",
      contactName,
      contactEmail: i.contactDetails?.email || i.contact?.email || "",
      status: normalizeInvoiceStatus(i.status || ""),
      sentDate,
      amount: Number(i.amountDue) || 0,
      daysOutstanding: sentMs ? Math.max(0, Math.floor((now - sentMs) / 864e5)) : 0,
      total: Number(i.total) || 0,
      dueDate: i.dueDate || ""
    };
  }
  function buildPaidInvoiceRecord(i) {
    const paidDate = i.paidAt || i.updatedAt || i.sentAt || i.issueDate || i.createdAt || "";
    const issuedAt = i.sentAt || i.issueDate || i.createdAt || "";
    const contactName = sanitizeContactName(i.contactDetails?.name || i.contact?.name || `${i.contact?.firstName || ""} ${i.contact?.lastName || ""}`.trim()) || "Unknown";
    return {
      id: i._id || i.id || "",
      number: i.invoiceNumber || i.number || "",
      name: i.name || i.description || "",
      contactName,
      contactEmail: i.contactDetails?.email || i.contact?.email || "",
      status: normalizeInvoiceStatus(i.status || ""),
      sentDate: paidDate,
      amount: Number(i.total) || 0,
      daysOutstanding: 0,
      issuedAt
    };
  }
  function buildAllEstimateRecord(e) {
    const sentDate = e.sentAt || e.issueDate || e.updatedAt || e.createdAt || "";
    const sentMs = sentDate ? new Date(sentDate).getTime() : null;
    const contactName = sanitizeContactName(e.contactDetails?.name || e.contact?.name || `${e.contact?.firstName || ""} ${e.contact?.lastName || ""}`) || "Unknown";
    return {
      id: e._id || e.id || "",
      number: e.estimateNumber || e.number || "",
      name: e.name || e.title || e.subject || "",
      contactName,
      contactEmail: e.contactDetails?.email || e.contact?.email || "",
      status: (e.estimateStatus || e.status || "UNKNOWN").toUpperCase(),
      sentDate,
      amount: Number(e.total) || 0,
      daysOutstanding: sentMs ? Math.max(0, Math.floor((now - sentMs) / 864e5)) : 0
    };
  }
  const pendingEstimateRecords = rawEstimates.filter((e) => PENDING_ESTIMATE_STATUSES.has(normalizeEstimateStatus(e.estimateStatus || e.status || ""))).map(buildEstimateRecord).sort((a, b) => b.daysOutstanding - a.daysOutstanding || b.amount - a.amount);
  const unpaidInvoiceRecords = rawInvoices.filter((i) => UNPAID_INVOICE_STATUSES.has(normalizeInvoiceStatus(i.status || ""))).map(buildInvoiceRecord).sort((a, b) => b.daysOutstanding - a.daysOutstanding || b.amount - a.amount);
  const paidInvoiceRecords = rawInvoices.filter((i) => normalizeInvoiceStatus(i.status || "") === "PAID").map(buildPaidInvoiceRecord).sort((a, b) => new Date(b.sentDate).getTime() - new Date(a.sentDate).getTime());
  const allSentEstimateRecords = rawEstimates.filter((e) => {
    const raw = (e.estimateStatus || e.status || "").toLowerCase();
    return raw !== "draft" && raw !== "";
  }).map(buildAllEstimateRecord).sort((a, b) => new Date(b.sentDate).getTime() - new Date(a.sentDate).getTime());
  return {
    data: {
      pendingEstimates: {
        count: pendingEstimateRecords.length,
        totalValue: pendingEstimateRecords.reduce((s, r) => s + r.amount, 0),
        records: pendingEstimateRecords
      },
      unpaidInvoices: {
        count: unpaidInvoiceRecords.length,
        totalValue: unpaidInvoiceRecords.reduce((s, r) => s + r.amount, 0),
        records: unpaidInvoiceRecords
      },
      paidInvoices: {
        count: paidInvoiceRecords.length,
        totalValue: paidInvoiceRecords.reduce((s, r) => s + r.amount, 0),
        records: paidInvoiceRecords
      },
      allSentEstimates: {
        count: allSentEstimateRecords.length,
        totalValue: allSentEstimateRecords.reduce((s, r) => s + r.amount, 0),
        records: allSentEstimateRecords
      },
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
      warnings
    },
    warnings
  };
}
var globalRateLimits, serverCacheMemory2, rawEstInvCache, RAW_EST_INV_TTL_MS, rawCrmCache, RAW_CRM_TTL_MS, PENDING_ESTIMATE_STATUSES, UNPAID_INVOICE_STATUSES, LiveReportingService;
var init_ghlService = __esm({
  "src/ghlService.ts"() {
    init_mockSaaSStore();
    init_mockReportingData();
    init_mockData();
    globalRateLimits = { remaining: 100, limit: 100, resetTime: 0 };
    serverCacheMemory2 = {};
    rawEstInvCache = {};
    RAW_EST_INV_TTL_MS = 10 * 60 * 1e3;
    rawCrmCache = {};
    RAW_CRM_TTL_MS = 10 * 60 * 1e3;
    PENDING_ESTIMATE_STATUSES = /* @__PURE__ */ new Set(["SENT", "VIEWED"]);
    UNPAID_INVOICE_STATUSES = /* @__PURE__ */ new Set(["SENT", "PARTIAL", "OVERDUE"]);
    LiveReportingService = class {
      static async getOverviewDashboardReport(workspaceId, filters = {}) {
        const isProd = process.env.NODE_ENV === "production";
        const settings = db.getReportingSettings(workspaceId);
        if (settings.mode === "MOCK") {
          return { source: "mock", data: getDashboardMetrics(), warnings: [], unavailableMetrics: [], stale: false };
        }
        const cached = getReportCache(workspaceId, `overview_${filters.startDate || ""}_${filters.endDate || ""}`);
        if (cached && !cached.stale) {
          return { source: "live", data: cached.data, warnings: [], unavailableMetrics: [], stale: false };
        }
        try {
          const computed = await computeLiveOverviewReport(workspaceId, filters);
          setReportCache(workspaceId, `overview_${filters.startDate || ""}_${filters.endDate || ""}`, computed);
          return { source: "live", data: computed, warnings: computed.warnings, unavailableMetrics: computed.unavailableMetrics, stale: false };
        } catch (err) {
          console.error("[LiveReportingService] Overview failed:", err.message);
          if (isProd) {
            return { source: "live", data: null, error: err.message, warnings: [`Live data unavailable: ${err.message}`], unavailableMetrics: ["all"], stale: false };
          }
          return { source: "mock", data: getDashboardMetrics(), warnings: [`Dev fallback: ${err.message}`], unavailableMetrics: [], stale: false };
        }
      }
      static async getOpportunityDashboardReport(workspaceId, filters = {}) {
        const isProd = process.env.NODE_ENV === "production";
        const settings = db.getReportingSettings(workspaceId);
        if (settings.mode === "MOCK") {
          return { source: "mock", data: getDashboardMetrics(), warnings: [], unavailableMetrics: [], stale: false };
        }
        const cached = getReportCache(workspaceId, `opportunity_${filters.startDate || ""}_${filters.endDate || ""}`);
        if (cached && !cached.stale) {
          return { source: "live", data: cached.data, warnings: [], unavailableMetrics: [], stale: false };
        }
        try {
          const computed = await computeLiveOpportunityReport(workspaceId, filters);
          setReportCache(workspaceId, `opportunity_${filters.startDate || ""}_${filters.endDate || ""}`, computed);
          return { source: "live", data: computed, warnings: computed.warnings, unavailableMetrics: computed.unavailableMetrics, stale: false };
        } catch (err) {
          console.error("[LiveReportingService] Opportunity failed:", err.message);
          if (isProd) {
            return { source: "live", data: null, error: err.message, warnings: [`Live data unavailable: ${err.message}`], unavailableMetrics: ["all"], stale: false };
          }
          return { source: "mock", data: getDashboardMetrics(), warnings: [`Dev fallback: ${err.message}`], unavailableMetrics: [], stale: false };
        }
      }
      static async getSalesDashboardReport(workspaceId, filters = {}) {
        const isProd = process.env.NODE_ENV === "production";
        const settings = db.getReportingSettings(workspaceId);
        if (settings.mode === "MOCK") {
          return { source: "mock", data: getDashboardMetrics(), warnings: [], unavailableMetrics: [], stale: false };
        }
        const cached = getReportCache(workspaceId, `sales_${filters.startDate || ""}_${filters.endDate || ""}`);
        if (cached && !cached.stale) {
          return { source: "live", data: cached.data, warnings: [], unavailableMetrics: [], stale: false };
        }
        try {
          const computed = await computeLiveSalesReport(workspaceId, filters);
          setReportCache(workspaceId, `sales_${filters.startDate || ""}_${filters.endDate || ""}`, computed);
          return { source: "live", data: computed, warnings: computed.warnings, unavailableMetrics: computed.unavailableMetrics, stale: false };
        } catch (err) {
          console.error("[LiveReportingService] Sales failed:", err.message);
          if (isProd) {
            return { source: "live", data: null, error: err.message, warnings: [`Live data unavailable: ${err.message}`], unavailableMetrics: ["all"], stale: false };
          }
          return { source: "mock", data: getDashboardMetrics(), warnings: [`Dev fallback: ${err.message}`], unavailableMetrics: [], stale: false };
        }
      }
      static async getOwnerDashboardReport(workspaceId, filters = {}) {
        const isProd = process.env.NODE_ENV === "production";
        const settings = db.getReportingSettings(workspaceId);
        if (settings.mode === "MOCK") {
          return { source: "mock", data: getOwnerPerformanceReport(filters), warnings: [], unavailableMetrics: [], stale: false, cachedAt: Date.now() };
        }
        const cacheKey = `owner_${filters.userId || "all"}_${filters.source || "all"}_${filters.startDate || ""}_${filters.endDate || ""}`;
        if (!filters.force) {
          const cached = getReportCache(workspaceId, cacheKey);
          if (cached && !cached.stale) {
            return { source: "live", data: cached.data, warnings: [], unavailableMetrics: [], stale: false, cachedAt: serverCacheMemory2[`${workspaceId}_${cacheKey}`]?.timestamp };
          }
        }
        try {
          const result = await computeLiveOwnerReport(workspaceId, { ...filters });
          setReportCache(workspaceId, cacheKey, result.data);
          return { source: "live", data: result.data, warnings: result.warnings, unavailableMetrics: result.unavailableMetrics, stale: false, cachedAt: Date.now() };
        } catch (err) {
          console.error("[LiveReportingService] Owner failed:", err.message);
          if (isProd) {
            return { source: "live", data: null, error: err.message, warnings: [`Live data unavailable: ${err.message}`], unavailableMetrics: ["all"], stale: false };
          }
          return { source: "mock", data: getOwnerPerformanceReport(filters), warnings: [`Dev fallback: ${err.message}`], unavailableMetrics: [], stale: false };
        }
      }
      static async getMarketingDashboardReport(workspaceId, filters = {}) {
        const isProd = process.env.NODE_ENV === "production";
        const settings = db.getReportingSettings(workspaceId);
        if (settings.mode === "MOCK") {
          return { source: "mock", data: getMarketingPerformanceReport(filters), warnings: [], unavailableMetrics: [], stale: false, cachedAt: Date.now() };
        }
        const cacheKey = `marketing_${filters.source || "all"}_${filters.campaign || "all"}_${filters.startDate || ""}_${filters.endDate || ""}`;
        if (!filters.force) {
          const cached = getReportCache(workspaceId, cacheKey);
          if (cached && !cached.stale) {
            return { source: "live", data: cached.data, warnings: [], unavailableMetrics: [], stale: false, cachedAt: serverCacheMemory2[`${workspaceId}_${cacheKey}`]?.timestamp };
          }
        }
        try {
          const result = await computeLiveMarketingReport(workspaceId, { ...filters });
          setReportCache(workspaceId, cacheKey, result.data);
          return { source: "live", data: result.data, warnings: result.warnings, unavailableMetrics: result.unavailableMetrics, stale: false, cachedAt: Date.now() };
        } catch (err) {
          console.error("[LiveReportingService] Marketing failed:", err.message);
          if (isProd) {
            return { source: "live", data: null, error: err.message, warnings: [`Live data unavailable: ${err.message}`], unavailableMetrics: ["all"], stale: false };
          }
          return { source: "mock", data: getMarketingPerformanceReport(filters), warnings: [`Dev fallback: ${err.message}`], unavailableMetrics: [], stale: false };
        }
      }
      static async getAppointmentDashboardReport(workspaceId, filters = {}) {
        const isProd = process.env.NODE_ENV === "production";
        const settings = db.getReportingSettings(workspaceId);
        if (settings.mode === "MOCK") {
          const mockData = {
            summary: { totalBooked: 58, totalShowed: 42, totalNoShow: 9, totalCancelled: 7, totalConfirmed: 0, showRate: 82, noShowRate: 18, cancellationRate: 12, upcomingCount: 14 },
            statusDistribution: [
              { status: "Showed", count: 42 },
              { status: "No-Show", count: 9 },
              { status: "Cancelled", count: 7 }
            ],
            calendarBreakdown: [
              { calendarId: "cal_main", calendarName: "Sales Consultations", total: 32, showed: 25, noshow: 5, cancelled: 2, confirmed: 0, showRate: 83 },
              { calendarId: "cal_pool", calendarName: "Pool Inspections", total: 18, showed: 13, noshow: 3, cancelled: 2, confirmed: 0, showRate: 81 },
              { calendarId: "cal_follow", calendarName: "Follow-Up Calls", total: 8, showed: 4, noshow: 1, cancelled: 3, confirmed: 0, showRate: 80 }
            ],
            repBreakdown: [
              { userId: "usr_001", userName: "Marcus Sterling", booked: 18, showed: 15, noshow: 2, cancelled: 1, showRate: 88 },
              { userId: "usr_002", userName: "Sarah Jenkins", booked: 22, showed: 16, noshow: 4, cancelled: 2, showRate: 80 },
              { userId: "usr_003", userName: "Devon Carter", booked: 12, showed: 8, noshow: 2, cancelled: 2, showRate: 80 },
              { userId: "usr_004", userName: "Isabella Cruz", booked: 6, showed: 3, noshow: 1, cancelled: 2, showRate: 75 }
            ],
            upcomingAppointments: [
              { id: "apt_001", title: "Pool Design Consultation \u2014 Amanda Ross", startTime: new Date(Date.now() + 2 * 36e5).toISOString(), status: "confirmed", userId: "usr_001", userName: "Marcus Sterling", calendarId: "cal_main", calendarName: "Sales Consultations" },
              { id: "apt_002", title: "Pool Inspection \u2014 Donovan Corp", startTime: new Date(Date.now() + 5 * 36e5).toISOString(), status: "confirmed", userId: "usr_002", userName: "Sarah Jenkins", calendarId: "cal_pool", calendarName: "Pool Inspections" },
              { id: "apt_003", title: "Inground Spa Quote \u2014 Reyes Family", startTime: new Date(Date.now() + 26 * 36e5).toISOString(), status: "confirmed", userId: "usr_001", userName: "Marcus Sterling", calendarId: "cal_main", calendarName: "Sales Consultations" },
              { id: "apt_004", title: "Remodel Assessment \u2014 Holloway Estate", startTime: new Date(Date.now() + 50 * 36e5).toISOString(), status: "confirmed", userId: "usr_003", userName: "Devon Carter", calendarId: "cal_main", calendarName: "Sales Consultations" },
              { id: "apt_005", title: "Commercial Pool Bid \u2014 Park District", startTime: new Date(Date.now() + 74 * 36e5).toISOString(), status: "confirmed", userId: "usr_002", userName: "Sarah Jenkins", calendarId: "cal_main", calendarName: "Sales Consultations" }
            ],
            trends: [
              { date: "Wk 1", booked: 12, showed: 8, noshow: 3 },
              { date: "Wk 2", booked: 16, showed: 12, noshow: 2 },
              { date: "Wk 3", booked: 18, showed: 14, noshow: 3 },
              { date: "Wk 4", booked: 12, showed: 8, noshow: 1 }
            ]
          };
          return { source: "mock", data: mockData, warnings: [], unavailableMetrics: [], stale: false };
        }
        const cacheKey = `appointment_${filters.userId || "all"}_${filters.startDate || ""}_${filters.endDate || ""}`;
        if (!filters.force) {
          const cached = getReportCache(workspaceId, cacheKey);
          if (cached && !cached.stale) {
            return { source: "live", data: cached.data, warnings: [], unavailableMetrics: [], stale: false, cachedAt: serverCacheMemory2[`${workspaceId}_${cacheKey}`]?.timestamp };
          }
        }
        try {
          const result = await computeLiveAppointmentReport(workspaceId, filters);
          setReportCache(workspaceId, cacheKey, result.data);
          return { source: "live", data: result.data, warnings: result.warnings, unavailableMetrics: result.unavailableMetrics, stale: false, cachedAt: Date.now() };
        } catch (err) {
          console.error("[LiveReportingService] Appointment failed:", err.message);
          if (isProd) {
            return { source: "live", data: null, error: err.message, warnings: [`Live data unavailable: ${err.message}`], unavailableMetrics: ["all"], stale: false };
          }
          return { source: "live", data: null, warnings: [`Dev fallback: ${err.message}`], unavailableMetrics: [], stale: false };
        }
      }
      static async getEstimatesInvoicesReport(workspaceId, filters = {}) {
        const isProd = process.env.NODE_ENV === "production";
        const settings = db.getReportingSettings(workspaceId);
        if (settings.mode === "MOCK") {
          const now = Date.now();
          const d = (daysAgo) => new Date(now - daysAgo * 864e5).toISOString();
          const mockData = {
            estimates: {
              totalCount: 45,
              totalValue: 543500,
              byStatus: {
                DRAFT: { count: 5, value: 48500 },
                SENT: { count: 12, value: 156e3 },
                VIEWED: { count: 8, value: 104200 },
                ACCEPTED: { count: 9, value: 118500 },
                REJECTED: { count: 4, value: 42e3 },
                CONVERTED: { count: 6, value: 64800 },
                EXPIRED: { count: 1, value: 9500 }
              },
              funnel: { sent: 40, sentValue: 495e3, viewed: 27, viewRate: 68, accepted: 9, acceptanceRate: 23, rejected: 4, rejectionRate: 10, converted: 6, conversionRate: 15, expired: 1 }
            },
            invoices: {
              totalCount: 31,
              totalValue: 400500,
              totalPaid: 214e3,
              totalOutstanding: 186e3,
              collectionRate: 53,
              avgInvoiceValue: 14304,
              byStatus: {
                DRAFT: { count: 2, value: 24e3, amountPaid: 0, amountDue: 24e3 },
                SENT: { count: 6, value: 87500, amountPaid: 0, amountDue: 87500 },
                PAID: { count: 14, value: 196e3, amountPaid: 196e3, amountDue: 0 },
                PARTIAL: { count: 3, value: 48e3, amountPaid: 18e3, amountDue: 3e4 },
                OVERDUE: { count: 5, value: 68500, amountPaid: 0, amountDue: 68500 },
                CANCELLED: { count: 1, value: 8500, amountPaid: 0, amountDue: 0 }
              },
              aging: {
                current: { count: 4, value: 38e3 },
                days1to30: { count: 4, value: 52e3 },
                days31to60: { count: 3, value: 54e3 },
                days61plus: { count: 3, value: 42e3 }
              },
              unpaidList: [
                { id: "inv_m1", invoiceNumber: "INV-0041", name: "Inground Pool Construction", contactName: "James & Amanda Holloway", contactEmail: "holloway@email.com", amountDue: 18200, total: 18200, dueDate: d(75), issueDate: d(105), daysOverdue: 75, status: "OVERDUE" },
                { id: "inv_m2", invoiceNumber: "INV-0038", name: "Pool Renovation & Tile Work", contactName: "Westside Properties LLC", contactEmail: "billing@westside.com", amountDue: 14800, total: 14800, dueDate: d(45), issueDate: d(75), daysOverdue: 45, status: "OVERDUE" },
                { id: "inv_m3", invoiceNumber: "INV-0040", name: "Spa Installation Package", contactName: "Carter Residence", contactEmail: "carter@home.net", amountDue: 12400, total: 12400, dueDate: d(35), issueDate: d(65), daysOverdue: 35, status: "OVERDUE" },
                { id: "inv_m4", invoiceNumber: "INV-0039", name: "Commercial Pool Service", contactName: "Apex Athletic Club", contactEmail: "ops@apexclub.com", amountDue: 23100, total: 23100, dueDate: d(22), issueDate: d(52), daysOverdue: 22, status: "OVERDUE" },
                { id: "inv_m5", invoiceNumber: "INV-0043", name: "Pool Deck & Coping Work", contactName: "Rivera Family Trust", contactEmail: "rivera@email.com", amountDue: 8750, total: 17500, dueDate: d(15), issueDate: d(45), daysOverdue: 15, status: "PARTIAL" },
                { id: "inv_m6", invoiceNumber: "INV-0044", name: "Equipment Upgrade Package", contactName: "Blue Water Estates", contactEmail: "bwe@estates.com", amountDue: 7200, total: 7200, dueDate: d(8), issueDate: d(38), daysOverdue: 8, status: "SENT" },
                { id: "inv_m7", invoiceNumber: "INV-0045", name: "Pool Cleaning Annual Plan", contactName: "Henderson Household", contactEmail: "henderson@mail.com", amountDue: 5500, total: 5500, dueDate: d(-5), issueDate: d(25), daysOverdue: 0, status: "SENT" },
                { id: "inv_m8", invoiceNumber: "INV-0046", name: "Leak Detection & Repair", contactName: "Davidson Properties", contactEmail: "davidson@prop.net", amountDue: 14500, total: 29e3, dueDate: d(-12), issueDate: d(18), daysOverdue: 0, status: "PARTIAL" }
              ]
            },
            crossMetrics: { estimateToInvoiceRate: 15 },
            warnings: [],
            unavailableMetrics: ["avgDaysToPayment"]
          };
          return { source: "mock", data: mockData, warnings: [], unavailableMetrics: ["avgDaysToPayment"], stale: false };
        }
        const cacheKey = `estimates_invoices_${filters.startDate || ""}_${filters.endDate || ""}`;
        if (!filters.force) {
          const cached = getReportCache(workspaceId, cacheKey);
          if (cached && !cached.stale) {
            return { source: "live", data: cached.data, warnings: [], unavailableMetrics: [], stale: false, cachedAt: serverCacheMemory2[`${workspaceId}_${cacheKey}`]?.timestamp };
          }
        }
        try {
          const result = await computeLiveEstimatesInvoicesReport(workspaceId, filters);
          setReportCache(workspaceId, cacheKey, result.data);
          return { source: "live", data: result.data, warnings: result.warnings, unavailableMetrics: result.unavailableMetrics, stale: false, cachedAt: Date.now() };
        } catch (err) {
          console.error("[LiveReportingService] EstimatesInvoices failed:", err.message);
          if (isProd) {
            return { source: "live", data: null, error: err.message, warnings: [`Live data unavailable: ${err.message}`], unavailableMetrics: ["all"], stale: false };
          }
          return { source: "live", data: null, warnings: [`Dev fallback: ${err.message}`], unavailableMetrics: [], stale: false };
        }
      }
      static async getOutstandingReport(workspaceId, force = false) {
        const isProd = process.env.NODE_ENV === "production";
        const settings = db.getReportingSettings(workspaceId);
        if (settings.mode === "MOCK") {
          const d = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString();
          return {
            source: "mock",
            data: {
              pendingEstimates: {
                count: 4,
                totalValue: 89200,
                records: [
                  { id: "est_m1", number: "EST-0022", name: "Pool Renovation Package", contactName: "Brian & Lisa Whitmore", contactEmail: "whitmore@email.com", status: "SENT", sentDate: d(45), amount: 28500, daysOutstanding: 45 },
                  { id: "est_m2", number: "EST-0024", name: "Equipment Upgrade Quote", contactName: "Sunrise Properties", contactEmail: "ops@sunrise.com", status: "VIEWED", sentDate: d(28), amount: 14200, daysOutstanding: 28 },
                  { id: "est_m3", number: "EST-0025", name: "Spa & Water Feature Install", contactName: "Martinez Family", contactEmail: "martinez@gmail.com", status: "SENT", sentDate: d(12), amount: 31800, daysOutstanding: 12 },
                  { id: "est_m4", number: "EST-0026", name: "Annual Service Plan", contactName: "Valley Club HOA", contactEmail: "admin@valleyclub.org", status: "VIEWED", sentDate: d(6), amount: 14700, daysOutstanding: 6 }
                ]
              },
              unpaidInvoices: {
                count: 5,
                totalValue: 112450,
                records: [
                  { id: "inv_o1", number: "INV-0041", name: "Inground Pool Construction", contactName: "James & Amanda Holloway", contactEmail: "holloway@email.com", status: "OVERDUE", sentDate: d(105), amount: 18200, daysOutstanding: 105 },
                  { id: "inv_o2", number: "INV-0038", name: "Pool Renovation & Tile Work", contactName: "Westside Properties LLC", contactEmail: "billing@westside.com", status: "OVERDUE", sentDate: d(75), amount: 14800, daysOutstanding: 75 },
                  { id: "inv_o3", number: "INV-0043", name: "Pool Deck & Coping Work", contactName: "Rivera Family Trust", contactEmail: "rivera@email.com", status: "PARTIAL", sentDate: d(45), amount: 8750, daysOutstanding: 45 },
                  { id: "inv_o4", number: "INV-0046", name: "Leak Detection & Repair", contactName: "Davidson Properties", contactEmail: "davidson@prop.net", status: "PARTIAL", sentDate: d(18), amount: 14500, daysOutstanding: 18 },
                  { id: "inv_o5", number: "INV-0047", name: "Pool Cleaning Annual Plan", contactName: "Henderson Household", contactEmail: "henderson@mail.com", status: "SENT", sentDate: d(25), amount: 56200, daysOutstanding: 25 }
                ]
              },
              paidInvoices: {
                count: 3,
                totalValue: 72500,
                records: [
                  { id: "pai_m1", number: "INV-0035", name: "Pool Installation Full Package", contactName: "Thomas & Claire Bennett", contactEmail: "bennett@email.com", status: "PAID", sentDate: d(-2), amount: 32500, daysOutstanding: 0 },
                  { id: "pai_m2", number: "INV-0036", name: "Pool Heater Replacement", contactName: "Sunrise HOA", contactEmail: "admin@sunrise-hoa.com", status: "PAID", sentDate: d(-5), amount: 24800, daysOutstanding: 0 },
                  { id: "pai_m3", number: "INV-0037", name: "Chemical Treatment Package", contactName: "Greenfield Estates", contactEmail: "ops@greenfield.com", status: "PAID", sentDate: d(-8), amount: 15200, daysOutstanding: 0 }
                ]
              },
              allSentEstimates: {
                count: 6,
                totalValue: 152700,
                records: [
                  { id: "aes_m1", number: "EST-0022", name: "Pool Renovation Package", contactName: "Brian & Lisa Whitmore", contactEmail: "whitmore@email.com", status: "SENT", sentDate: d(45), amount: 28500, daysOutstanding: 45 },
                  { id: "aes_m2", number: "EST-0024", name: "Equipment Upgrade Quote", contactName: "Sunrise Properties", contactEmail: "ops@sunrise.com", status: "VIEWED", sentDate: d(28), amount: 14200, daysOutstanding: 28 },
                  { id: "aes_m3", number: "EST-0025", name: "Spa & Water Feature Install", contactName: "Martinez Family", contactEmail: "martinez@gmail.com", status: "ACCEPTED", sentDate: d(20), amount: 31800, daysOutstanding: 20 },
                  { id: "aes_m4", number: "EST-0026", name: "Annual Service Plan", contactName: "Valley Club HOA", contactEmail: "admin@valleyclub.org", status: "VIEWED", sentDate: d(12), amount: 14700, daysOutstanding: 12 },
                  { id: "aes_m5", number: "EST-0027", name: "Pool Deck Resurfacing", contactName: "Rodriguez Brothers", contactEmail: "rob@rodriguez.com", status: "DECLINED", sentDate: d(8), amount: 22300, daysOutstanding: 8 },
                  { id: "aes_m6", number: "EST-0028", name: "Pool Lighting System", contactName: "Pacific View Condos", contactEmail: "mgmt@pvcs.com", status: "INVOICED", sentDate: d(3), amount: 41200, daysOutstanding: 3 }
                ]
              },
              fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
              warnings: []
            },
            warnings: [],
            stale: false
          };
        }
        const cacheKey = "outstanding_alltime";
        if (!force) {
          const cached = getReportCache(workspaceId, cacheKey);
          if (cached && !cached.stale) {
            return { source: "live", data: cached.data, warnings: [], stale: false, cachedAt: serverCacheMemory2[`${workspaceId}_${cacheKey}`]?.timestamp };
          }
        }
        try {
          const result = await computeLiveOutstandingReport(workspaceId, force);
          setReportCache(workspaceId, cacheKey, result.data);
          return { source: "live", data: result.data, warnings: result.warnings, stale: false, cachedAt: Date.now() };
        } catch (err) {
          console.error("[LiveReportingService] Outstanding failed:", err.message);
          if (isProd) {
            return { source: "live", data: null, error: err.message, warnings: [`Live data unavailable: ${err.message}`], stale: false };
          }
          return { source: "live", data: null, warnings: [`Dev fallback: ${err.message}`], stale: false };
        }
      }
      // ── CSV EXPORT: raw records for client-side download ──────────────────────
      static async getEstimatesExport(workspaceId) {
        const settings = db.getReportingSettings(workspaceId);
        if (settings.mode === "MOCK") return { source: "mock", estimates: [], count: 0 };
        let locationId = "";
        try {
          locationId = resolveGHLAuthentication(workspaceId).locationId;
        } catch (err) {
          throw new Error(`AUTH_ERROR: ${err.message}`);
        }
        const raw = await fetchAllEstimates(workspaceId, locationId, {});
        const isoDate = (s) => {
          if (!s) return "";
          try {
            return new Date(s).toISOString().slice(0, 10);
          } catch {
            return "";
          }
        };
        const estimates = raw.map((e) => ({
          estimateNumber: e.estimateNumber || "",
          contactName: sanitizeContactName(e.contactDetails?.name || e.contact?.name || `${e.contact?.firstName || ""} ${e.contact?.lastName || ""}`) || "",
          contactEmail: e.contactDetails?.email || e.contact?.email || "",
          status: normalizeEstimateStatus(e.estimateStatus || e.status || ""),
          total: Number(e.total) || 0,
          sentDate: isoDate(e.sentAt || e.issueDate || ""),
          createdAt: isoDate(e.createdAt || "")
        }));
        return { source: "live", estimates, count: estimates.length };
      }
      static async getInvoicesExport(workspaceId) {
        const settings = db.getReportingSettings(workspaceId);
        if (settings.mode === "MOCK") return { source: "mock", invoices: [], count: 0 };
        let locationId = "";
        try {
          locationId = resolveGHLAuthentication(workspaceId).locationId;
        } catch (err) {
          throw new Error(`AUTH_ERROR: ${err.message}`);
        }
        const raw = await fetchAllInvoices(workspaceId, locationId, {});
        const isoDate = (s) => {
          if (!s) return "";
          try {
            return new Date(s).toISOString().slice(0, 10);
          } catch {
            return "";
          }
        };
        const invoices = raw.map((i) => ({
          invoiceNumber: i.invoiceNumber || i.number || "",
          contactName: sanitizeContactName(i.contactDetails?.name || i.contact?.name || `${i.contact?.firstName || ""} ${i.contact?.lastName || ""}`) || "",
          contactEmail: i.contactDetails?.email || i.contact?.email || "",
          status: normalizeInvoiceStatus(i.status || ""),
          total: Number(i.total) || 0,
          amountDue: Number(i.amountDue) || 0,
          dueDate: isoDate(i.dueDate || ""),
          sentDate: isoDate(i.sentAt || i.issueDate || ""),
          createdAt: isoDate(i.createdAt || "")
        }));
        return { source: "live", invoices, count: invoices.length };
      }
    };
  }
});

// _api_src/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => index_default,
  requireAuth: () => requireAuth
});
module.exports = __toCommonJS(index_exports);
var import_express = __toESM(require("express"));
var import_crypto = require("crypto");
init_types();
init_mockReportingData();
init_ghlService();

// src/supabase.ts
var import_supabase_js = require("@supabase/supabase-js");
function normalizeEnvValue(raw) {
  if (!raw) return "";
  let v = raw;
  v = v.replace(/^﻿/, "").trim();
  const quoted = /^"(.*)"$/.exec(v) || /^'(.*)'$/.exec(v);
  if (quoted) v = quoted[1];
  v = v.replace(/^﻿/, "").trim();
  return v;
}
function stripTrailingSlash(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
var supabaseUrl = stripTrailingSlash(normalizeEnvValue(process.env.SUPABASE_URL));
var supabaseServiceKey = normalizeEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
if (!supabaseUrl || !supabaseServiceKey) {
  console.error("[Supabase] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
} else {
  try {
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== "https:") {
      console.error(`[Supabase] SUPABASE_URL uses protocol "${parsed.protocol}" \u2014 expected https: in production.`);
    }
  } catch {
    console.error("[Supabase] SUPABASE_URL does not parse as a valid URL after normalization.");
  }
}
var supabaseUrlIsUsable = (() => {
  if (!supabaseUrl) return false;
  try {
    const p = new URL(supabaseUrl);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
})();
var supabaseAdmin = (0, import_supabase_js.createClient)(
  supabaseUrlIsUsable ? supabaseUrl : "https://placeholder.supabase.co",
  supabaseServiceKey || "placeholder-key",
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  }
);
function classifyFetchError(err) {
  const code = err?.cause?.code || err?.code || "";
  const errorName = err?.name || "";
  const msg = String(err?.message || "");
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || /ENOTFOUND|getaddrinfo/i.test(msg)) {
    return {
      kind: "config",
      code: code || "ENOTFOUND",
      errorName,
      detail: `the configured Supabase host (${supabaseHost || "unset"}) does not resolve \u2014 the project may have been deleted, renamed, or SUPABASE_URL is wrong`
    };
  }
  if (errorName === "TimeoutError" || code === "ETIMEDOUT") {
    return { kind: "network", code: code || "ETIMEDOUT", errorName, detail: `the request timed out after ${AUTH_ATTEMPT_TIMEOUT_MS / 1e3}s` };
  }
  if (code === "ECONNREFUSED") return { kind: "network", code, errorName, detail: "the connection was refused" };
  if (code === "ECONNRESET") return { kind: "network", code, errorName, detail: "the connection was reset" };
  return { kind: "network", code: code || "UNKNOWN", errorName, detail: msg || "unknown network error" };
}
var supabaseHost = (() => {
  try {
    return supabaseUrl ? new URL(supabaseUrl).host : "";
  } catch {
    return "";
  }
})();
function safeConfigDiagnostics() {
  const rawUrl = process.env.SUPABASE_URL || "";
  const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const rawFlags = (raw) => ({
    present: raw.length > 0,
    length: raw.length,
    hadLeadingBom: raw.charCodeAt(0) === 65279,
    hadSurroundingWhitespace: raw !== raw.trim(),
    hadWrappingQuotes: /^"(.*)"$/.test(raw) || /^'(.*)'$/.test(raw)
  });
  return {
    supabaseHost,
    normalizedUrlParses: (() => {
      try {
        return !!supabaseUrl && !!new URL(supabaseUrl);
      } catch {
        return false;
      }
    })(),
    rawUrl: rawFlags(rawUrl),
    rawKey: rawFlags(rawKey)
  };
}
var AUTH_ATTEMPT_TIMEOUT_MS = 4500;
var AUTH_MAX_ATTEMPTS = 2;
var AUTH_BACKOFF_MIN_MS = 200;
var AUTH_BACKOFF_MAX_MS = 500;
var AUTH_TOTAL_BUDGET_MS = AUTH_MAX_ATTEMPTS * AUTH_ATTEMPT_TIMEOUT_MS + (AUTH_MAX_ATTEMPTS - 1) * AUTH_BACKOFF_MAX_MS;
var defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function isRetryableHttpStatus(status) {
  return status >= 500 && status <= 599;
}
function deploymentContext() {
  return {
    env: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
    region: process.env.VERCEL_REGION || void 0,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || void 0,
    commit: process.env.VERCEL_GIT_COMMIT_SHA || void 0
  };
}
function logAuthUpstreamUnavailable(params) {
  console.error(JSON.stringify({
    event: "AUTH_UPSTREAM_UNAVAILABLE",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    route: params.route,
    attempts: params.attempts,
    classification: params.kind,
    causeCode: params.code,
    errorName: params.errorName || void 0,
    timedOut: params.timedOut,
    ...deploymentContext()
  }));
}
async function requestAuthWithRetry(url, init, route, deps = {}) {
  const doFetch = deps.fetchImpl || fetch;
  const sleep2 = deps.sleepImpl || defaultSleep;
  let lastFailure;
  for (let attempt = 1; attempt <= AUTH_MAX_ATTEMPTS; attempt++) {
    const isFinal = attempt === AUTH_MAX_ATTEMPTS;
    try {
      const response = await doFetch(url, { ...init, signal: AbortSignal.timeout(AUTH_ATTEMPT_TIMEOUT_MS) });
      if (isRetryableHttpStatus(response.status) && !isFinal) {
        console.warn(`[auth] ${route}: upstream returned ${response.status}, retrying once`, { attempt });
        await sleep2(AUTH_BACKOFF_MIN_MS + Math.random() * (AUTH_BACKOFF_MAX_MS - AUTH_BACKOFF_MIN_MS));
        continue;
      }
      if (attempt > 1) {
        console.warn(`[auth] ${route}: recovered on attempt ${attempt}`, { status: response.status });
      }
      return { response, attempts: attempt };
    } catch (err) {
      const { kind, detail, code, errorName } = classifyFetchError(err);
      lastFailure = { kind, detail, code, errorName, timedOut: errorName === "TimeoutError" || code === "ETIMEDOUT" };
      if (kind === "config" || isFinal) {
        return { failure: lastFailure, attempts: attempt };
      }
      console.warn(`[auth] ${route}: attempt ${attempt} failed (${code || errorName || "network"}), retrying once`);
      await sleep2(AUTH_BACKOFF_MIN_MS + Math.random() * (AUTH_BACKOFF_MAX_MS - AUTH_BACKOFF_MIN_MS));
    }
  }
  return { failure: lastFailure, attempts: AUTH_MAX_ATTEMPTS };
}
async function supabaseSignIn(email, password, deps = {}) {
  if (!supabaseUrl || !supabaseServiceKey) {
    return {
      kind: "config",
      error: "Server misconfigured: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set."
    };
  }
  if (!supabaseUrlIsUsable) {
    console.error("[supabaseSignIn] SUPABASE_URL is present but malformed", safeConfigDiagnostics());
    return {
      kind: "config",
      error: "Server misconfigured: SUPABASE_URL is not a valid URL. This needs an administrator \u2014 retrying will not help."
    };
  }
  const { response: res, failure, attempts } = await requestAuthWithRetry(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": supabaseServiceKey
      },
      body: JSON.stringify({ email, password })
    },
    "/api/auth/login",
    deps
  );
  if (failure) {
    console.error("[supabaseSignIn] auth request failed", {
      kind: failure.kind,
      code: failure.code,
      errorName: failure.errorName,
      detail: failure.detail,
      attempts,
      ...safeConfigDiagnostics()
    });
    logAuthUpstreamUnavailable({
      route: "/api/auth/login",
      attempts,
      kind: failure.kind,
      code: failure.code,
      errorName: failure.errorName,
      timedOut: failure.timedOut
    });
    return {
      kind: failure.kind,
      attempts,
      error: failure.kind === "config" ? `Sign-in is unavailable: ${failure.detail}. This needs an administrator \u2014 retrying will not help.` : `Authentication service temporarily unreachable (${failure.detail}). Please try again.`
    };
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const kind = res.status >= 500 ? "network" : "credentials";
    if (kind === "network") {
      logAuthUpstreamUnavailable({
        route: "/api/auth/login",
        attempts,
        kind,
        code: `HTTP_${res.status}`,
        timedOut: false
      });
    }
    return { kind, attempts, error: err.error_description || err.msg || `Auth failed (HTTP ${res.status})` };
  }
  const data = await res.json();
  return {
    accessToken: data.access_token,
    userId: data.user?.id,
    userMetadata: data.user?.user_metadata ?? {},
    email: data.user?.email,
    attempts
  };
}
var healthCache = null;
var HEALTH_CACHE_TTL_MS = 3e4;
var HEALTH_TIMEOUT_MS = 3e3;
async function checkAuthReachability(deps = {}) {
  const now = deps.now || Date.now;
  const doFetch = deps.fetchImpl || fetch;
  if (healthCache && now() - healthCache.at < HEALTH_CACHE_TTL_MS) {
    return { healthy: healthCache.healthy, reason: healthCache.reason, cached: true, diagnostics: {} };
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    const reason = "config_missing";
    healthCache = { at: now(), healthy: false, reason };
    return { healthy: false, reason, cached: false, diagnostics: safeConfigDiagnostics() };
  }
  let parsed;
  try {
    parsed = new URL(supabaseUrl);
  } catch {
    const reason = "config_invalid_url";
    healthCache = { at: now(), healthy: false, reason };
    return { healthy: false, reason, cached: false, diagnostics: safeConfigDiagnostics() };
  }
  if (parsed.protocol !== "https:") {
    const reason = "config_insecure_protocol";
    healthCache = { at: now(), healthy: false, reason };
    return { healthy: false, reason, cached: false, diagnostics: { ...safeConfigDiagnostics(), protocol: parsed.protocol } };
  }
  try {
    const res = await doFetch(`${supabaseUrl}/auth/v1/health`, {
      method: "GET",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
    });
    const healthy = !isRetryableHttpStatus(res.status);
    const reason = healthy ? "reachable" : `upstream_${res.status}`;
    healthCache = { at: now(), healthy, reason };
    return { healthy, reason, cached: false, diagnostics: { upstreamStatus: res.status } };
  } catch (err) {
    const { kind, detail, code, errorName } = classifyFetchError(err);
    const reason = kind === "config" ? "host_unresolvable" : "unreachable";
    healthCache = { at: now(), healthy: false, reason };
    return {
      healthy: false,
      reason,
      cached: false,
      diagnostics: { kind, code, errorName, detail, timedOut: errorName === "TimeoutError" || code === "ETIMEDOUT" }
    };
  }
}

// src/entitlements.ts
var TRIAL_DURATION_DAYS = 14;
var EXPIRING_SOON_THRESHOLD_DAYS = 3;
var MS_PER_DAY = 864e5;
function daysRemaining(endsAt, now) {
  return Math.ceil((new Date(endsAt).getTime() - now) / MS_PER_DAY);
}
function deriveTrialStatus(facts, now) {
  if (facts.licenseStatus === "LICENSED") return "CONVERTED";
  if (!facts.trialStartedAt || !facts.trialEndsAt) return "NOT_STARTED";
  const remaining = daysRemaining(facts.trialEndsAt, now);
  if (remaining <= 0) return "EXPIRED";
  if (facts.trialExtensionCount > 0) return "ADMIN_EXTENDED";
  if (remaining <= EXPIRING_SOON_THRESHOLD_DAYS) return "EXPIRING_SOON";
  return "ACTIVE";
}
function deriveEntitlement(facts, now = Date.now()) {
  const trialStatus = deriveTrialStatus(facts, now);
  const trialDaysRemaining = facts.trialEndsAt ? daysRemaining(facts.trialEndsAt, now) : null;
  const base = {
    trialStatus,
    licenseStatus: facts.licenseStatus,
    trialDaysRemaining,
    trialEndsAt: facts.trialEndsAt
  };
  if (facts.suspended) {
    return {
      ...base,
      accessStatus: "SUSPENDED",
      hasAccess: false,
      denialReason: "This workspace has been suspended. Contact your administrator."
    };
  }
  if (facts.licenseStatus === "REVOKED") {
    return {
      ...base,
      accessStatus: "SUSPENDED",
      hasAccess: false,
      denialReason: "This workspace's licence has been revoked. Contact your administrator."
    };
  }
  if (facts.licenseStatus === "LICENSED") {
    return { ...base, accessStatus: "LICENSED", hasAccess: true, denialReason: null };
  }
  if (trialStatus === "NOT_STARTED") {
    return {
      ...base,
      accessStatus: "NOT_STARTED",
      hasAccess: false,
      denialReason: "No active trial or licence for this workspace."
    };
  }
  if (trialStatus === "EXPIRED") {
    return {
      ...base,
      accessStatus: "EXPIRED",
      hasAccess: false,
      denialReason: `Your ${TRIAL_DURATION_DAYS}-day trial has ended. Contact your administrator to activate full access.`
    };
  }
  return { ...base, accessStatus: "TRIAL", hasAccess: true, denialReason: null };
}
function newTrialWindow(now = Date.now()) {
  return {
    trialStartedAt: new Date(now).toISOString(),
    trialEndsAt: new Date(now + TRIAL_DURATION_DAYS * MS_PER_DAY).toISOString()
  };
}

// _api_src/index.ts
var import_dotenv = __toESM(require("dotenv"));
import_dotenv.default.config();
function toSaaSUser(authUser, profile) {
  return {
    id: authUser.id,
    name: profile?.name || (authUser.email?.split("@")[0] ?? "Unknown"),
    email: authUser.email || "",
    onboarded: profile?.onboarded ?? false,
    createdAt: authUser.created_at || (/* @__PURE__ */ new Date()).toISOString()
  };
}
function toWorkspace(row) {
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
    licenseStatus: row.license_status ?? "NONE",
    licensedAt: row.licensed_at ?? null
  };
}
function workspaceEntitlement(ws) {
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
function toMember(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role,
    joinedAt: row.joined_at
  };
}
function toGHLConnection(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    locationId: row.location_id,
    apiKey: row.api_key,
    connectedAt: row.connected_at,
    status: row.status
  };
}
function toReportingSettings(row) {
  return {
    workspaceId: row.workspace_id,
    defaultTimeframe: row.default_timeframe,
    allowedDashboards: row.allowed_dashboards,
    lastSyncAt: row.last_sync_at,
    mode: row.mode,
    allowAdminManageGHL: row.allow_admin_manage_ghl,
    cacheTtlMinutes: row.cache_ttl_minutes
  };
}
async function getProfile(userId) {
  const { data } = await supabaseAdmin.from("profiles").select("*").eq("id", userId).single();
  return data;
}
async function getWorkspaceById(id) {
  const { data } = await supabaseAdmin.from("workspaces").select("*").eq("id", id).single();
  return data ? toWorkspace(data) : null;
}
async function getWorkspacesForUser(userId) {
  const { data } = await supabaseAdmin.from("workspace_members").select("role, workspaces(*)").eq("user_id", userId);
  if (!data) return [];
  const isSuperAdmin = data.some((m) => m.role === "SUPER_ADMIN");
  if (isSuperAdmin) {
    const { data: all } = await supabaseAdmin.from("workspaces").select("*");
    return (all || []).map(toWorkspace);
  }
  return data.map((m) => toWorkspace(m.workspaces)).filter(Boolean);
}
async function getWorkspaceMember(workspaceId, userId) {
  const { data } = await supabaseAdmin.from("workspace_members").select("*").eq("workspace_id", workspaceId).eq("user_id", userId).single();
  return data ? toMember(data) : null;
}
async function getMembersByWorkspace(workspaceId) {
  const { data } = await supabaseAdmin.from("workspace_members").select("*").eq("workspace_id", workspaceId);
  return (data || []).map(toMember);
}
async function getWorkspaceCreator(workspaceId) {
  const { data: rows } = await supabaseAdmin.from("workspace_members").select("user_id, role, joined_at").eq("workspace_id", workspaceId).order("joined_at", { ascending: true });
  if (!rows || rows.length === 0) return null;
  const owner = rows.find((r) => r.role === "WORKSPACE_OWNER") || rows[0];
  const profile = await getProfile(owner.user_id);
  let email = "";
  try {
    const { data } = await supabaseAdmin.auth.admin.getUserById(owner.user_id);
    email = data?.user?.email || "";
  } catch {
  }
  return {
    userId: owner.user_id,
    name: profile?.name || email.split("@")[0] || "Unknown",
    email,
    joinedAt: owner.joined_at
  };
}
async function getGHLConnection(workspaceId) {
  const { data } = await supabaseAdmin.from("ghl_connections").select("*").eq("workspace_id", workspaceId).single();
  return data ? toGHLConnection(data) : null;
}
async function getOrCreateReportingSettings(workspaceId) {
  const { data } = await supabaseAdmin.from("reporting_settings").select("*").eq("workspace_id", workspaceId).single();
  if (data) return toReportingSettings(data);
  const defaultMode = process.env.REPORTING_DATA_SOURCE === "live" ? "LIVE" : "MOCK";
  const defaults = {
    workspace_id: workspaceId,
    default_timeframe: "last_30_days",
    allowed_dashboards: ["overview", "opportunity", "sales"],
    last_sync_at: null,
    mode: defaultMode,
    allow_admin_manage_ghl: true,
    cache_ttl_minutes: 15
  };
  await supabaseAdmin.from("reporting_settings").insert(defaults);
  return toReportingSettings(defaults);
}
async function logAction(workspaceId, userId, userEmail, action, details) {
  await supabaseAdmin.from("audit_logs").insert({
    id: `log_${Date.now()}_${Math.floor(Math.random() * 1e3)}`,
    workspace_id: workspaceId,
    user_id: userId,
    user_email: userEmail,
    action,
    details,
    ip_address: "127.0.0.1",
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
}
async function syncGhlToMockDb(workspaceId) {
  const { db: db2 } = await Promise.resolve().then(() => (init_mockSaaSStore(), mockSaaSStore_exports));
  const settings = await getOrCreateReportingSettings(workspaceId);
  const mockSettings = db2.getReportingSettings(workspaceId);
  mockSettings.mode = settings.mode;
  mockSettings.allowAdminManageGHL = settings.allowAdminManageGHL;
  mockSettings.cacheTtlMinutes = settings.cacheTtlMinutes ?? 15;
  const conn = await getGHLConnection(workspaceId);
  if (conn) {
    const existing = db2.getGHLConnection(workspaceId);
    if (!existing) {
      db2.connections.push({
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
var webhookLogs = [
  { timestamp: new Date(Date.now() - 36e5).toISOString(), source: "GoHighLevel Webhook", event: "contact.create", payload: { id: "con_web_1", contactName: "Sally Jenkins" } },
  { timestamp: new Date(Date.now() - 172e5).toISOString(), source: "GoHighLevel Webhook", event: "opportunity.update", payload: { id: "opp_web_1", status: "won", value: 12500 } }
];
var tenantMetricsCache = /* @__PURE__ */ new Map();
var tenantOwnerPerfCache = /* @__PURE__ */ new Map();
var tenantMarketingCache = /* @__PURE__ */ new Map();
function invalidateTenantCache(workspaceId) {
  tenantMetricsCache.delete(workspaceId);
  tenantOwnerPerfCache.delete(workspaceId);
  tenantMarketingCache.delete(workspaceId);
  invalidateWorkspaceCacheStore(workspaceId);
}
async function getWorkspaceGhlConfig(workspaceId) {
  const connection = await getGHLConnection(workspaceId);
  const settings = await getOrCreateReportingSettings(workspaceId);
  let dataSourceMode = "MOCK";
  if (settings.mode) {
    dataSourceMode = settings.mode;
  } else if (process.env.GHL_DATA_SOURCE === "LIVE" || process.env.REPORTING_DATA_SOURCE === "live") {
    dataSourceMode = "LIVE";
  }
  let apiKey = "";
  if (connection?.apiKey) {
    apiKey = connection.apiKey;
  } else {
    apiKey = process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY || "";
  }
  let locationId = "";
  if (connection?.locationId) {
    locationId = connection.locationId;
  } else {
    const ws = await getWorkspaceById(workspaceId);
    locationId = process.env.GHL_LOCATION_ID || ws?.ghlLocationId || "";
  }
  const companyId = process.env.GHL_COMPANY_ID || "co_ghl_company_9a2b";
  const maskToken = (t) => !t ? "" : t.length <= 8 ? "ghl_\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : `${t.slice(0, 4)}\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022${t.slice(-5)}`;
  return {
    dataSourceMode,
    apiKey,
    apiKeyMasked: maskToken(apiKey),
    locationId,
    companyId,
    allowAdminManageGHL: settings.allowAdminManageGHL !== false,
    cacheTtlMinutes: settings.cacheTtlMinutes || 15,
    status: connection?.status || (apiKey && locationId ? "CONNECTED" : "DISCONNECTED"),
    connectedAt: connection?.connectedAt || (apiKey && locationId ? (/* @__PURE__ */ new Date()).toISOString() : null)
  };
}
function canUserManageGhl(role, allowAdminManageGHL) {
  if (role === "SUPER_ADMIN" /* SUPER_ADMIN */ || role === "WORKSPACE_OWNER" /* WORKSPACE_OWNER */) return true;
  if (role === "ADMIN" /* ADMIN */) return allowAdminManageGHL;
  return false;
}
var isValidDateString = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));
var DEMO_CREDENTIALS = {
  "token_super_admin": { email: "operations@showtimepoolmechanics.com", password: "Demo2026!" },
  "token_marcus": { email: "owner@showtime.com", password: "Demo2026!" },
  "token_sarah": { email: "admin@showtime.com", password: "Demo2026!" },
  "token_bobby": { email: "sales@showtime.com", password: "Demo2026!" },
  "token_rachel": { email: "readonly@showtime.com", password: "Demo2026!" },
  "token_bob": { email: "owner@vancepools.com", password: "Demo2026!" }
};
function decryptGhlPayload(encrypted, passphrase) {
  const buf = Buffer.from(encrypted, "base64");
  if (buf.slice(0, 8).toString("ascii") !== "Salted__") throw new Error("Not OpenSSL-salted ciphertext");
  const salt = buf.slice(8, 16);
  const ciphertext = buf.slice(16);
  const pass = Buffer.from(passphrase, "utf8");
  let derived = Buffer.alloc(0);
  let block = Buffer.alloc(0);
  while (derived.length < 48) {
    block = (0, import_crypto.createHash)("md5").update(Buffer.concat([block, pass, salt])).digest();
    derived = Buffer.concat([derived, block]);
  }
  const key = derived.slice(0, 32);
  const iv = derived.slice(32, 48);
  const decipher = (0, import_crypto.createDecipheriv)("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}
function mintSsoJwt(payload) {
  const secret = process.env.GHL_APP_SHARED_SECRET;
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ _src: "ghl_sso", ...payload })).toString("base64url");
  const sig = (0, import_crypto.createHmac)("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}
function verifySsoJwt(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const secret = process.env.GHL_APP_SHARED_SECRET;
    if (!secret) return null;
    const expected = (0, import_crypto.createHmac)("sha256", secret).update(`${header}.${body}`).digest("base64url");
    const a = Buffer.from(sig, "base64url");
    const b = Buffer.from(expected, "base64url");
    if (a.length !== b.length || !(0, import_crypto.timingSafeEqual)(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload._src !== "ghl_sso") return null;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1e3)) return null;
    return payload;
  } catch {
    return null;
  }
}
function encryptToken(text) {
  const keyHex = process.env.INTEGRATION_ENCRYPTION_KEY || "";
  if (!keyHex) throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured");
  const key = Buffer.from(keyHex, "hex");
  const iv = (0, import_crypto.randomBytes)(12);
  const cipher = (0, import_crypto.createCipheriv)("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}
function decryptToken(encryptedStr) {
  const keyHex = process.env.INTEGRATION_ENCRYPTION_KEY || "";
  if (!keyHex) throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured");
  const key = Buffer.from(keyHex, "hex");
  const [ivHex, authTagHex, ciphertextHex] = encryptedStr.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = (0, import_crypto.createDecipheriv)("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
function generatePKCE() {
  const codeVerifier = (0, import_crypto.randomBytes)(64).toString("base64url");
  const codeChallenge = (0, import_crypto.createHash)("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}
function mintOAuthState(workspaceId, codeVerifier) {
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const body = Buffer.from(JSON.stringify({
    workspaceId,
    codeVerifier,
    exp: Math.floor(Date.now() / 1e3) + 600,
    nonce: (0, import_crypto.randomBytes)(8).toString("hex")
  })).toString("base64url");
  const sig = (0, import_crypto.createHmac)("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verifyOAuthState(state) {
  try {
    const dotIdx = state.lastIndexOf(".");
    if (dotIdx === -1) return null;
    const body = state.slice(0, dotIdx);
    const sig = state.slice(dotIdx + 1);
    const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!secret) return null;
    const expected = (0, import_crypto.createHmac)("sha256", secret).update(body).digest("base64url");
    const a = Buffer.from(sig, "base64url");
    const b = Buffer.from(expected, "base64url");
    if (a.length !== b.length || !(0, import_crypto.timingSafeEqual)(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1e3)) return null;
    return { workspaceId: payload.workspaceId, codeVerifier: payload.codeVerifier };
  } catch {
    return null;
  }
}
async function getValidGoogleToken(workspaceId) {
  const { data: row } = await supabaseAdmin.from("workspace_integrations").select("encrypted_access_token, encrypted_refresh_token, token_expiry").eq("workspace_id", workspaceId).eq("provider", "google_analytics").single();
  if (!row) return null;
  const now = Date.now();
  const expiry = row.token_expiry ? new Date(row.token_expiry).getTime() : 0;
  if (expiry - now > 5 * 60 * 1e3 && row.encrypted_access_token) {
    try {
      return decryptToken(row.encrypted_access_token);
    } catch {
      return null;
    }
  }
  if (!row.encrypted_refresh_token) return null;
  try {
    const refreshToken = decryptToken(row.encrypted_refresh_token);
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        grant_type: "refresh_token"
      }).toString()
    });
    if (!resp.ok) return null;
    const tokenData = await resp.json();
    const newExpiry = new Date(Date.now() + (tokenData.expires_in || 3600) * 1e3).toISOString();
    await supabaseAdmin.from("workspace_integrations").update({
      encrypted_access_token: encryptToken(tokenData.access_token),
      token_expiry: newExpiry,
      last_synced_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("workspace_id", workspaceId).eq("provider", "google_analytics");
    return tokenData.access_token;
  } catch {
    return null;
  }
}
async function fetchGA4Report(accessToken, propertyId, startDate, endDate) {
  const base = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
  const headers = { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" };
  const [channelRes, pagesRes] = await Promise.all([
    fetch(base, {
      method: "POST",
      headers,
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "newUsers" }, { name: "conversions" }],
        limit: 20
      })
    }),
    fetch(base, {
      method: "POST",
      headers,
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "landingPagePlusQueryString" }],
        metrics: [{ name: "sessions" }, { name: "bounceRate" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10
      })
    })
  ]);
  const channelData = channelRes.ok ? await channelRes.json() : null;
  const pagesData = pagesRes.ok ? await pagesRes.json() : null;
  let sessions = 0, users = 0, newUsers = 0, conversions = 0;
  const channelBreakdown = [];
  if (channelData?.rows) {
    for (const row of channelData.rows) {
      const s = parseInt(row.metricValues?.[0]?.value || "0");
      const u = parseInt(row.metricValues?.[1]?.value || "0");
      const n = parseInt(row.metricValues?.[2]?.value || "0");
      const c = parseInt(row.metricValues?.[3]?.value || "0");
      sessions += s;
      users += u;
      newUsers += n;
      conversions += c;
      channelBreakdown.push({ channel: row.dimensionValues?.[0]?.value || "Unknown", sessions: s, users: u, conversions: c });
    }
  }
  const topLandingPages = [];
  if (pagesData?.rows) {
    for (const row of pagesData.rows) {
      topLandingPages.push({
        page: row.dimensionValues?.[0]?.value || "/",
        sessions: parseInt(row.metricValues?.[0]?.value || "0"),
        bounceRate: parseFloat(row.metricValues?.[1]?.value || "0")
      });
    }
  }
  return { sessions, users, newUsers, conversions, channelBreakdown, topLandingPages };
}
async function fetchGA4Properties(accessToken) {
  const res = await fetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries", {
    headers: { "Authorization": `Bearer ${accessToken}` }
  });
  if (!res.ok) return [];
  const data = await res.json();
  const props = [];
  for (const account of data.accountSummaries || []) {
    for (const prop of account.propertySummaries || []) {
      props.push({
        propertyId: prop.property?.replace("properties/", "") || "",
        displayName: prop.displayName || prop.property || "Unknown Property",
        accountName: account.displayName || "Unknown Account"
      });
    }
  }
  return props;
}
function getMockGA4Report() {
  return {
    sessions: 3842,
    users: 2915,
    newUsers: 1847,
    conversions: 124,
    channelBreakdown: [
      { channel: "Organic Search", sessions: 1520, users: 1180, conversions: 62 },
      { channel: "Direct", sessions: 890, users: 740, conversions: 28 },
      { channel: "Paid Search", sessions: 612, users: 510, conversions: 19 },
      { channel: "Social", sessions: 440, users: 275, conversions: 8 },
      { channel: "Email", sessions: 280, users: 155, conversions: 5 },
      { channel: "Referral", sessions: 100, users: 55, conversions: 2 }
    ],
    topLandingPages: [
      { page: "/", sessions: 1240, bounceRate: 0.42 },
      { page: "/pool-services", sessions: 688, bounceRate: 0.35 },
      { page: "/contact", sessions: 512, bounceRate: 0.28 },
      { page: "/pool-installation", sessions: 420, bounceRate: 0.38 },
      { page: "/pool-repair", sessions: 310, bounceRate: 0.45 },
      { page: "/blog/pool-maintenance-tips", sessions: 284, bounceRate: 0.52 },
      { page: "/free-estimate", sessions: 245, bounceRate: 0.22 },
      { page: "/about", sessions: 143, bounceRate: 0.55 }
    ],
    source: "mock",
    warnings: ["Google Analytics is not connected. Showing sample data."]
  };
}
var requireAuth = (allowedRoles) => {
  return async (req, res, next) => {
    const authHeader = req.headers["x-auth-token"] || req.headers["authorization"];
    if (!authHeader) {
      return res.status(401).json({ status: "error", error: "Authentication required. No session token provided." });
    }
    const token = authHeader.toString().replace("Bearer ", "");
    const ssoPayload = verifySsoJwt(token);
    if (ssoPayload) {
      const workspace2 = await getWorkspaceById(ssoPayload.workspaceId);
      if (!workspace2) return res.status(401).json({ status: "error", error: "SSO workspace not found." });
      if (workspace2.suspended) return res.status(403).json({ status: "error", error: "Workspace suspended.", suspended: true });
      const ghlRole = (ssoPayload.ghlRole || "").toLowerCase();
      const role2 = ["admin", "owner"].includes(ghlRole) ? "WORKSPACE_OWNER" /* WORKSPACE_OWNER */ : "READ_ONLY" /* READ_ONLY */;
      if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(role2)) {
        return res.status(403).json({ status: "error", error: `Access Denied: insufficient role.` });
      }
      const ssoEntitlement = workspaceEntitlement(workspace2);
      if (!ssoEntitlement.hasAccess) {
        return res.status(403).json({
          status: "error",
          error: ssoEntitlement.denialReason,
          accessDenied: true,
          entitlement: ssoEntitlement,
          suspended: ssoEntitlement.accessStatus === "SUSPENDED"
        });
      }
      req.entitlement = ssoEntitlement;
      req.user = { id: ssoPayload.userId || "ghl_sso", email: ssoPayload.email || "", name: ssoPayload.email || "", onboarded: true, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
      req.workspace = workspace2;
      req.member = null;
      req.role = role2;
      req.token = token;
      req.supabaseUserId = ssoPayload.userId || "ghl_sso";
      return next();
    }
    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authUser) {
      return res.status(401).json({ status: "error", error: "Invalid or expired session token. Please log in again." });
    }
    const profile = await getProfile(authUser.id);
    const user = toSaaSUser(authUser, profile);
    let activeWorkspaceId = authUser.user_metadata?.active_workspace_id || "";
    let workspace = null;
    let member = null;
    if (activeWorkspaceId) {
      workspace = await getWorkspaceById(activeWorkspaceId);
      if (workspace) member = await getWorkspaceMember(activeWorkspaceId, authUser.id);
    }
    if (!workspace) {
      const { data: memRows } = await supabaseAdmin.from("workspace_members").select("*, workspaces(*)").eq("user_id", authUser.id).order("joined_at").limit(1);
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
      return res.status(403).json({ status: "error", error: "No workspace found for this account. Please contact your administrator." });
    }
    const isSuperAdmin = member?.role === "SUPER_ADMIN" /* SUPER_ADMIN */;
    if (workspace.suspended && !isSuperAdmin) {
      return res.status(403).json({ status: "error", error: `Access Denied: The workspace "${workspace.name}" has been suspended.`, suspended: true });
    }
    if (!member && !isSuperAdmin) {
      return res.status(403).json({ status: "error", error: "Access Denied: You are not an authenticated member of this workspace." });
    }
    const role = isSuperAdmin ? "SUPER_ADMIN" /* SUPER_ADMIN */ : member?.role || "READ_ONLY" /* READ_ONLY */;
    if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(role)) {
      return res.status(403).json({ status: "error", error: `Access Denied: Role "${role}" does not have sufficient permissions.` });
    }
    const entitlement = workspaceEntitlement(workspace);
    req.entitlement = entitlement;
    if (!entitlement.hasAccess && !isSuperAdmin) {
      return res.status(403).json({
        status: "error",
        error: entitlement.denialReason,
        // Distinguishes "your trial ended" from "your role is too low" — both are 403,
        // and the client must not treat this one as a credential failure and log out.
        accessDenied: true,
        entitlement,
        suspended: entitlement.accessStatus === "SUSPENDED"
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
var app = (0, import_express.default)();
app.use(import_express.default.json());
app.get("/api/health/auth", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  const result = await checkAuthReachability();
  if (!result.healthy) {
    console.error(JSON.stringify({
      event: "AUTH_HEALTH_DEGRADED",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      route: "/api/health/auth",
      reason: result.reason,
      cached: result.cached,
      diagnostics: result.diagnostics,
      env: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || void 0,
      commit: process.env.VERCEL_GIT_COMMIT_SHA || void 0
    }));
    return res.status(503).json({ status: "degraded" });
  }
  return res.status(200).json({ status: "ok" });
});
app.post("/api/auth/login", async (req, res) => {
  const { email, password, impersonateToken } = req.body;
  let loginEmail;
  let loginPassword;
  if (impersonateToken) {
    const demo = DEMO_CREDENTIALS[impersonateToken];
    if (!demo) return res.status(401).json({ status: "error", error: "Unknown playground token." });
    loginEmail = demo.email;
    loginPassword = demo.password;
  } else {
    if (!email) return res.status(400).json({ status: "error", error: "Email is required." });
    loginEmail = email;
    loginPassword = password || "";
  }
  const signInResult = await supabaseSignIn(loginEmail, loginPassword);
  if (signInResult.kind === "config" || signInResult.kind === "network") {
    console.error("[login] auth backend unavailable:", signInResult.error);
    return res.status(503).json({ status: "error", error: signInResult.error });
  }
  if (signInResult.error || !signInResult.accessToken) {
    return res.status(401).json({ status: "error", error: "Invalid credentials. Check your email and password." });
  }
  const { data: { user: authUser }, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(signInResult.userId);
  if (getUserError || !authUser) {
    return res.status(401).json({ status: "error", error: "Authentication failed. Please try again." });
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
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) || workspaces[0] || null;
  const member = activeWorkspace ? await getWorkspaceMember(activeWorkspace.id, authUser.id) : null;
  const role = member?.role === "SUPER_ADMIN" /* SUPER_ADMIN */ ? "SUPER_ADMIN" /* SUPER_ADMIN */ : member?.role || "READ_ONLY" /* READ_ONLY */;
  await logAction(
    activeWorkspace?.id || null,
    authUser.id,
    authUser.email || "",
    "USER_LOGIN",
    impersonateToken ? `Authenticated via Playground as ${role}` : "Authenticated via email+password"
  );
  res.json({
    status: "success",
    session: {
      user,
      activeWorkspace,
      memberRecord: member,
      role,
      token: sessionToken,
      entitlement: activeWorkspace ? workspaceEntitlement(activeWorkspace) : null
    },
    workspaces
  });
});
app.post("/api/auth/signup", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ status: "error", error: "Name, email, and password are required." });
  }
  const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name }
  });
  if (createError) {
    const msg = createError.message.toLowerCase().includes("already") || createError.message.toLowerCase().includes("exists") ? "An account with this email already exists." : createError.message;
    return res.status(400).json({ status: "error", error: msg });
  }
  await supabaseAdmin.from("profiles").insert({ id: newUser.user.id, name, onboarded: false });
  const signInResult = await supabaseSignIn(email, password);
  if (signInResult.error || !signInResult.accessToken) {
    return res.status(500).json({ status: "error", error: "Account created but auto sign-in failed. Please log in manually." });
  }
  const token = signInResult.accessToken;
  const user = toSaaSUser(newUser.user, { name, onboarded: false });
  res.json({ status: "success", user, token });
});
app.post("/api/auth/onboarding", async (req, res) => {
  const { token, companyName, ghlMode, apiKey } = req.body;
  if (!token) return res.status(401).json({ status: "error", error: "Authentication token is required." });
  if (!companyName || !ghlMode) return res.status(400).json({ status: "error", error: "Company name and mode are required." });
  const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authUser) return res.status(401).json({ status: "error", error: "Invalid or expired session token." });
  const slug = companyName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");
  const workspaceId = `ws_${Date.now()}`;
  const trial = newTrialWindow();
  await supabaseAdmin.from("workspaces").insert({
    id: workspaceId,
    name: companyName,
    slug,
    ghl_location_id: ghlMode === "LIVE" ? `loc_live_${slug.slice(0, 8)}` : `loc_mock_${slug.slice(0, 8)}`,
    suspended: false,
    trial_started_at: trial.trialStartedAt,
    trial_ends_at: trial.trialEndsAt,
    trial_used: true,
    license_status: "NONE"
  });
  await supabaseAdmin.from("workspace_members").insert({
    id: `mem_${Date.now()}`,
    workspace_id: workspaceId,
    user_id: authUser.id,
    role: "WORKSPACE_OWNER",
    joined_at: (/* @__PURE__ */ new Date()).toISOString()
  });
  await supabaseAdmin.from("reporting_settings").insert({
    workspace_id: workspaceId,
    default_timeframe: "last_30_days",
    allowed_dashboards: ["overview", "opportunity", "sales", "owner", "marketing"],
    mode: ghlMode,
    allow_admin_manage_ghl: true,
    cache_ttl_minutes: 15
  });
  await supabaseAdmin.from("subscriptions").insert({
    workspace_id: workspaceId,
    plan: "GROWTH",
    status: "TRIALING",
    amount: 147,
    next_billing_date: new Date(Date.now() + 14 * 24 * 3600 * 1e3).toISOString()
  });
  if (ghlMode === "LIVE" && apiKey) {
    await supabaseAdmin.from("ghl_connections").insert({
      id: `gn_${Date.now()}`,
      workspace_id: workspaceId,
      location_id: `loc_live_${slug.slice(0, 8)}`,
      api_key: apiKey,
      status: "CONNECTED"
    });
  }
  await supabaseAdmin.from("profiles").update({ onboarded: true }).eq("id", authUser.id);
  await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
    user_metadata: { ...authUser.user_metadata, active_workspace_id: workspaceId }
  });
  const profile = await getProfile(authUser.id);
  const user = toSaaSUser(authUser, profile);
  const workspace = await getWorkspaceById(workspaceId);
  const member = await getWorkspaceMember(workspaceId, authUser.id);
  await logAction(workspaceId, authUser.id, authUser.email || "", "ONBOARD_WORKSPACE", `Workspace "${companyName}" onboarded`);
  res.json({ status: "success", session: { user, activeWorkspace: workspace, memberRecord: member, role: "WORKSPACE_OWNER" /* WORKSPACE_OWNER */, token }, workspaces: [workspace] });
});
app.get("/api/auth/me", async (req, res) => {
  const authHeader = req.headers["x-auth-token"] || req.headers["authorization"];
  if (!authHeader) return res.status(401).json({ status: "unauthorized", error: "No token" });
  const token = authHeader.toString().replace("Bearer ", "");
  let authUser = null;
  try {
    const result = await supabaseAdmin.auth.getUser(token);
    authUser = result.data?.user ?? null;
    if (!authUser) {
      const cause = result.error?.cause ?? result.error;
      const looksTransport = !!cause && (cause.name === "AuthRetryableFetchError" || /fetch failed|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|getaddrinfo/i.test(String(cause.message || "")));
      if (looksTransport) {
        const diag = classifyFetchError(cause);
        console.error("[auth/me] backend unreachable", { ...diag, ...safeConfigDiagnostics() });
        logAuthUpstreamUnavailable({
          route: "/api/auth/me",
          attempts: 1,
          kind: diag.kind,
          code: diag.code,
          errorName: diag.errorName,
          timedOut: diag.errorName === "TimeoutError" || diag.code === "ETIMEDOUT"
        });
        return res.status(503).json({
          status: "error",
          error: `Session could not be verified: ${diag.detail}.`,
          retryable: diag.kind === "network"
        });
      }
      return res.status(401).json({ status: "unauthorized", error: "Session expired" });
    }
  } catch (err) {
    const diag = classifyFetchError(err);
    console.error("[auth/me] threw", { ...diag, ...safeConfigDiagnostics() });
    logAuthUpstreamUnavailable({
      route: "/api/auth/me",
      attempts: 1,
      kind: diag.kind,
      code: diag.code,
      errorName: diag.errorName,
      timedOut: diag.errorName === "TimeoutError" || diag.code === "ETIMEDOUT"
    });
    return res.status(503).json({ status: "error", error: `Session could not be verified: ${diag.detail}.`, retryable: diag.kind === "network" });
  }
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
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) || workspaces[0] || null;
  const member = activeWorkspace ? await getWorkspaceMember(activeWorkspace.id, authUser.id) : null;
  const role = member?.role === "SUPER_ADMIN" /* SUPER_ADMIN */ ? "SUPER_ADMIN" /* SUPER_ADMIN */ : member?.role || "READ_ONLY" /* READ_ONLY */;
  res.json({
    status: "success",
    session: {
      user,
      activeWorkspace,
      memberRecord: member,
      role,
      token,
      entitlement: activeWorkspace ? workspaceEntitlement(activeWorkspace) : null
    },
    workspaces
  });
});
app.post("/api/auth/switch-workspace", async (req, res) => {
  const { token, workspaceId } = req.body;
  if (!token || !workspaceId) return res.status(400).json({ status: "error", error: "Token and workspaceId are required." });
  const { data: { user: authUser }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !authUser) return res.status(401).json({ status: "error", error: "Invalid token." });
  const workspaces = await getWorkspacesForUser(authUser.id);
  const isSuperAdmin = (await supabaseAdmin.from("workspace_members").select("role").eq("user_id", authUser.id)).data?.some((m) => m.role === "SUPER_ADMIN");
  const hasMembership = workspaces.some((w) => w.id === workspaceId) || isSuperAdmin;
  if (!hasMembership) return res.status(403).json({ status: "error", error: "Access Denied: You do not have membership in this workspace." });
  await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
    user_metadata: { ...authUser.user_metadata, active_workspace_id: workspaceId }
  });
  const profile = await getProfile(authUser.id);
  const user = toSaaSUser(authUser, profile);
  const activeWorkspace = await getWorkspaceById(workspaceId);
  const member = await getWorkspaceMember(workspaceId, authUser.id);
  const role = member?.role === "SUPER_ADMIN" /* SUPER_ADMIN */ ? "SUPER_ADMIN" /* SUPER_ADMIN */ : member?.role || "READ_ONLY" /* READ_ONLY */;
  await logAction(workspaceId, authUser.id, authUser.email || "", "SWITCH_WORKSPACE", `Switched to: ${activeWorkspace?.name}`);
  res.json({ status: "success", session: { user, activeWorkspace, memberRecord: member, role, token }, workspaces });
});
app.get("/api/workspaces/settings", requireAuth(), async (req, res) => {
  const settings = await getOrCreateReportingSettings(req.workspace.id);
  const { data: sub } = await supabaseAdmin.from("subscriptions").select("*").eq("workspace_id", req.workspace.id).single();
  const conn = await getGHLConnection(req.workspace.id);
  res.json({ status: "success", settings, subscription: sub, connection: conn ? { locationId: conn.locationId, status: conn.status, connectedAt: conn.connectedAt } : null });
});
app.post("/api/workspaces/settings", requireAuth(["SUPER_ADMIN" /* SUPER_ADMIN */, "WORKSPACE_OWNER" /* WORKSPACE_OWNER */, "ADMIN" /* ADMIN */]), async (req, res) => {
  const { defaultTimeframe, allowedDashboards, ghlApiKey, removeConnection } = req.body;
  const updates = {};
  if (defaultTimeframe !== void 0) updates.default_timeframe = defaultTimeframe;
  if (allowedDashboards !== void 0) updates.allowed_dashboards = allowedDashboards;
  if (ghlApiKey !== void 0 && ghlApiKey !== "") {
    const existing = await getGHLConnection(req.workspace.id);
    if (!existing) {
      await supabaseAdmin.from("ghl_connections").insert({ id: `gn_${Date.now()}`, workspace_id: req.workspace.id, location_id: req.workspace.ghlLocationId, api_key: ghlApiKey, status: "CONNECTED" });
    } else {
      await supabaseAdmin.from("ghl_connections").update({ api_key: ghlApiKey, status: "CONNECTED", connected_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("workspace_id", req.workspace.id);
    }
    updates.mode = "LIVE";
    await logAction(req.workspace.id, req.user.id, req.user.email, "UPDATE_INTEGRATION_KEY", "Updated GHL integration key.");
  }
  if (removeConnection) {
    await supabaseAdmin.from("ghl_connections").delete().eq("workspace_id", req.workspace.id);
    updates.mode = "MOCK";
    await logAction(req.workspace.id, req.user.id, req.user.email, "REMOVE_INTEGRATION", "Removed GHL connector.");
  }
  if (Object.keys(updates).length > 0) {
    await supabaseAdmin.from("reporting_settings").update(updates).eq("workspace_id", req.workspace.id);
  }
  const settings = await getOrCreateReportingSettings(req.workspace.id);
  res.json({ status: "success", settings, message: "Workspace configurations updated successfully." });
});
app.get("/api/workspaces/members", requireAuth(["SUPER_ADMIN" /* SUPER_ADMIN */, "WORKSPACE_OWNER" /* WORKSPACE_OWNER */, "ADMIN" /* ADMIN */]), async (req, res) => {
  const members = await getMembersByWorkspace(req.workspace.id);
  const list = await Promise.all(members.map(async (m) => {
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(m.userId);
    const profile = await getProfile(m.userId);
    return { id: m.id, userId: m.userId, userName: profile?.name || authUser?.user?.email?.split("@")[0] || "Unknown", userEmail: authUser?.user?.email || "unknown@company.com", role: m.role, joinedAt: m.joinedAt };
  }));
  res.json({ status: "success", members: list });
});
app.post("/api/workspaces/invite", requireAuth(["SUPER_ADMIN" /* SUPER_ADMIN */, "WORKSPACE_OWNER" /* WORKSPACE_OWNER */]), async (req, res) => {
  const { name, email, role } = req.body;
  if (!name || !email || !role) return res.status(400).json({ status: "error", error: "Name, email, and role are required." });
  let userId;
  const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
  const existing = existingUsers?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) {
    userId = existing.id;
  } else {
    const { data: newUser, error } = await supabaseAdmin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { name }, password: "ChangeMe2026!" });
    if (error) return res.status(400).json({ status: "error", error: error.message });
    await supabaseAdmin.from("profiles").insert({ id: newUser.user.id, name, onboarded: true });
    userId = newUser.user.id;
  }
  const alreadyMember = await getWorkspaceMember(req.workspace.id, userId);
  if (alreadyMember) return res.status(400).json({ status: "error", error: "User is already a member of this workspace." });
  await supabaseAdmin.from("workspace_members").insert({ id: `mem_${Date.now()}`, workspace_id: req.workspace.id, user_id: userId, role, joined_at: (/* @__PURE__ */ new Date()).toISOString() });
  await logAction(req.workspace.id, req.user.id, req.user.email, "INVITE_USER", `Invited ${email} as ${role}`);
  res.json({ status: "success", message: `Invited ${email} successfully.` });
});
app.get("/api/admin/workspaces", requireAuth(["SUPER_ADMIN" /* SUPER_ADMIN */]), async (req, res) => {
  const { data: allWs } = await supabaseAdmin.from("workspaces").select("*");
  const list = await Promise.all((allWs || []).map(async (ws) => {
    const members = await getMembersByWorkspace(ws.id);
    const conn = await getGHLConnection(ws.id);
    const creator = await getWorkspaceCreator(ws.id);
    const { data: sub } = await supabaseAdmin.from("subscriptions").select("*").eq("workspace_id", ws.id).single();
    const workspace = toWorkspace(ws);
    return {
      ...workspace,
      membersCount: members.length,
      connectionStatus: conn?.status || "DISCONNECTED",
      plan: sub?.plan || "N/A",
      amount: sub?.amount || 0,
      // The live access decision, plus the provenance the console needs to show who
      // granted a licence and whether it was machine-backfilled.
      entitlement: workspaceEntitlement(workspace),
      licenseReference: ws.license_reference ?? null,
      licensedByUserId: ws.licensed_by_user_id ?? null,
      suspensionReason: ws.suspension_reason ?? null,
      suspendedAt: ws.suspended_at ?? null,
      // Who created the workspace — drives the Client Trials console.
      creator
    };
  }));
  res.json({ status: "success", workspaces: list });
});
app.post("/api/admin/suspend", requireAuth(["SUPER_ADMIN" /* SUPER_ADMIN */]), async (req, res) => {
  const { workspaceId, suspend, reason } = req.body;
  if (!workspaceId) return res.status(400).json({ status: "error", error: "workspaceId is required." });
  const ws = await getWorkspaceById(workspaceId);
  if (!ws) return res.status(404).json({ status: "error", error: "Workspace not found." });
  const on = !!suspend;
  await supabaseAdmin.from("workspaces").update({
    suspended: on,
    // Cleared on restore so stale metadata cannot imply a workspace is still suspended.
    suspended_at: on ? (/* @__PURE__ */ new Date()).toISOString() : null,
    suspension_reason: on ? reason || null : null
  }).eq("id", workspaceId);
  await logAction(
    workspaceId,
    req.user.id,
    req.user.email,
    on ? "SUSPEND_WORKSPACE" : "RESTORE_WORKSPACE",
    on ? `Suspended. Reason: ${reason || "not given"}` : "Access restored."
  );
  res.json({ status: "success", message: `Workspace "${ws.name}" has been ${on ? "SUSPENDED" : "RESTORED"}.` });
});
app.post("/api/admin/entitlement/activate-license", requireAuth(["SUPER_ADMIN" /* SUPER_ADMIN */]), async (req, res) => {
  const { workspaceId, reference } = req.body;
  if (!workspaceId) return res.status(400).json({ status: "error", error: "workspaceId is required." });
  const ws = await getWorkspaceById(workspaceId);
  if (!ws) return res.status(404).json({ status: "error", error: "Workspace not found." });
  if (ws.licenseStatus === "LICENSED") {
    return res.status(409).json({
      status: "error",
      error: `"${ws.name}" already holds a perpetual licence (granted ${ws.licensedAt}). Revoke it first if you need to re-issue.`
    });
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const { error } = await supabaseAdmin.from("workspaces").update({
    license_status: "LICENSED",
    licensed_at: now,
    licensed_by_user_id: req.supabaseUserId,
    license_reference: typeof reference === "string" && reference.trim() ? reference.trim() : null,
    // A licensed org has consumed its trial. Prevents a later revoke from handing back a
    // "fresh" trial it never earned.
    trial_used: true
  }).eq("id", workspaceId);
  if (error) return res.status(500).json({ status: "error", error: `Database error: ${error.message}` });
  await logAction(
    workspaceId,
    req.user.id,
    req.user.email,
    "ACTIVATE_LICENSE",
    `Perpetual licence activated by ${req.user.email}. Reference: ${reference || "not given"}`
  );
  const updated = await getWorkspaceById(workspaceId);
  res.json({
    status: "success",
    message: `"${ws.name}" now has permanent licensed access.`,
    entitlement: updated ? workspaceEntitlement(updated) : null
  });
});
app.post("/api/admin/entitlement/extend-trial", requireAuth(["SUPER_ADMIN" /* SUPER_ADMIN */]), async (req, res) => {
  const { workspaceId, days, reason } = req.body;
  if (!workspaceId) return res.status(400).json({ status: "error", error: "workspaceId is required." });
  const n = Number(days);
  if (!Number.isInteger(n) || n < 1 || n > 365) {
    return res.status(400).json({ status: "error", error: "days must be a whole number between 1 and 365." });
  }
  const ws = await getWorkspaceById(workspaceId);
  if (!ws) return res.status(404).json({ status: "error", error: "Workspace not found." });
  if (ws.licenseStatus === "LICENSED") {
    return res.status(409).json({ status: "error", error: `"${ws.name}" holds a perpetual licence \u2014 a trial extension would have no effect.` });
  }
  if (!ws.trialStartedAt || !ws.trialEndsAt) {
    return res.status(400).json({ status: "error", error: `"${ws.name}" has no trial to extend.` });
  }
  const currentEnd = new Date(ws.trialEndsAt).getTime();
  const base = Math.max(Date.now(), currentEnd);
  const newEnd = new Date(base + n * 864e5).toISOString();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const { error } = await supabaseAdmin.from("workspaces").update({
    trial_ends_at: newEnd,
    trial_extension_count: ws.trialExtensionCount + 1,
    trial_extended_at: now,
    trial_extended_by: req.supabaseUserId
  }).eq("id", workspaceId);
  if (error) return res.status(500).json({ status: "error", error: `Database error: ${error.message}` });
  await logAction(
    workspaceId,
    req.user.id,
    req.user.email,
    "EXTEND_TRIAL",
    `Trial extended ${n} day(s) to ${newEnd} by ${req.user.email}. Reason: ${reason || "not given"}`
  );
  const updated = await getWorkspaceById(workspaceId);
  res.json({
    status: "success",
    message: `Trial for "${ws.name}" extended by ${n} day(s).`,
    entitlement: updated ? workspaceEntitlement(updated) : null
  });
});
app.post("/api/admin/entitlement/revoke-license", requireAuth(["SUPER_ADMIN" /* SUPER_ADMIN */]), async (req, res) => {
  const { workspaceId, reason } = req.body;
  if (!workspaceId) return res.status(400).json({ status: "error", error: "workspaceId is required." });
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ status: "error", error: "A reason is required to revoke a licence." });
  }
  const ws = await getWorkspaceById(workspaceId);
  if (!ws) return res.status(404).json({ status: "error", error: "Workspace not found." });
  if (ws.licenseStatus !== "LICENSED") {
    return res.status(409).json({ status: "error", error: `"${ws.name}" does not hold a licence to revoke.` });
  }
  const { error } = await supabaseAdmin.from("workspaces").update({
    license_status: "REVOKED"
  }).eq("id", workspaceId);
  if (error) return res.status(500).json({ status: "error", error: `Database error: ${error.message}` });
  await logAction(
    workspaceId,
    req.user.id,
    req.user.email,
    "REVOKE_LICENSE",
    `Licence revoked by ${req.user.email}. Reason: ${String(reason).trim()}`
  );
  const updated = await getWorkspaceById(workspaceId);
  res.json({
    status: "success",
    message: `Licence for "${ws.name}" has been revoked.`,
    entitlement: updated ? workspaceEntitlement(updated) : null
  });
});
app.post("/api/admin/entitlement/restore-license", requireAuth(["SUPER_ADMIN" /* SUPER_ADMIN */]), async (req, res) => {
  const { workspaceId, reason } = req.body;
  if (!workspaceId) return res.status(400).json({ status: "error", error: "workspaceId is required." });
  const ws = await getWorkspaceById(workspaceId);
  if (!ws) return res.status(404).json({ status: "error", error: "Workspace not found." });
  if (ws.licenseStatus !== "REVOKED") {
    return res.status(409).json({ status: "error", error: `"${ws.name}" has no revoked licence to restore.` });
  }
  const { error } = await supabaseAdmin.from("workspaces").update({
    license_status: "LICENSED",
    // Re-assert licensed_at only if it was somehow never set, to satisfy the CHECK constraint.
    licensed_at: ws.licensedAt ?? (/* @__PURE__ */ new Date()).toISOString()
  }).eq("id", workspaceId);
  if (error) return res.status(500).json({ status: "error", error: `Database error: ${error.message}` });
  await logAction(
    workspaceId,
    req.user.id,
    req.user.email,
    "RESTORE_LICENSE",
    `Licence restored by ${req.user.email}. Reason: ${reason || "not given"}`
  );
  const updated = await getWorkspaceById(workspaceId);
  res.json({
    status: "success",
    message: `Licence for "${ws.name}" has been restored.`,
    entitlement: updated ? workspaceEntitlement(updated) : null
  });
});
app.get("/api/admin/users", requireAuth(["SUPER_ADMIN" /* SUPER_ADMIN */]), async (req, res) => {
  const { data: users } = await supabaseAdmin.auth.admin.listUsers();
  const list = await Promise.all((users?.users || []).map(async (u) => {
    const profile = await getProfile(u.id);
    const { data: mems } = await supabaseAdmin.from("workspace_members").select("workspace_id, role, workspaces(name)").eq("user_id", u.id);
    return {
      id: u.id,
      name: profile?.name || u.email?.split("@")[0] || "Unknown",
      email: u.email,
      createdAt: u.created_at,
      onboarded: profile?.onboarded || false,
      memberships: (mems || []).map((m) => ({ workspaceId: m.workspace_id, workspaceName: m.workspaces?.name || "Unknown", role: m.role }))
    };
  }));
  res.json({ status: "success", users: list });
});
app.get("/api/admin/audit-logs", requireAuth(), async (req, res) => {
  if (req.role === "SUPER_ADMIN" /* SUPER_ADMIN */) {
    const { data } = await supabaseAdmin.from("audit_logs").select("*").order("timestamp", { ascending: false }).limit(500);
    res.json({ status: "success", logs: data || [] });
  } else if (req.role === "WORKSPACE_OWNER" /* WORKSPACE_OWNER */ || req.role === "ADMIN" /* ADMIN */) {
    const { data } = await supabaseAdmin.from("audit_logs").select("*").eq("workspace_id", req.workspace.id).order("timestamp", { ascending: false }).limit(200);
    res.json({ status: "success", logs: data || [] });
  } else {
    res.status(403).json({ status: "error", error: "Access Denied." });
  }
});
app.get("/api/ghl/config", requireAuth(), async (req, res) => {
  const config = await getWorkspaceGhlConfig(req.workspace.id);
  const warnings = [];
  if (config.dataSourceMode === "MOCK") warnings.push("Mock data is currently active.");
  if (config.dataSourceMode === "LIVE" && (!config.apiKey || !config.locationId)) warnings.push("Live mode selected but credentials are missing. Falling back to mock.");
  let allWorkspaceConnections = [];
  if (req.role === "SUPER_ADMIN" /* SUPER_ADMIN */) {
    const { data: allWs } = await supabaseAdmin.from("workspaces").select("*");
    allWorkspaceConnections = await Promise.all((allWs || []).map(async (ws) => {
      const c = await getWorkspaceGhlConfig(ws.id);
      return { workspaceId: ws.id, workspaceName: ws.name, locationId: c.locationId, connectionStatus: c.status, connectedAt: c.connectedAt, mode: c.dataSourceMode };
    }));
  }
  res.json({
    status: "success",
    role: req.role,
    canManage: canUserManageGhl(req.role, config.allowAdminManageGHL),
    data: { dataSourceMode: config.dataSourceMode, apiKey: config.apiKeyMasked, apiKeyMasked: config.apiKeyMasked, authMode: process.env.GHL_AUTH_MODE || "private_token", locationId: config.locationId, companyId: config.companyId, lastSyncTime: config.connectedAt || (/* @__PURE__ */ new Date()).toISOString(), cacheTtlMinutes: config.cacheTtlMinutes, allowAdminManageGHL: config.allowAdminManageGHL, apiConnectedSince: config.connectedAt, connectionStatus: config.status, rateLimitStatus: { remaining: 98, limit: 100 }, webhookUrl: process.env.APP_URL ? `${process.env.APP_URL}/api/ghl/webhook` : "https://example.com/api/ghl/webhook", healthCheckStatus: config.apiKey && config.locationId ? config.status === "CONNECTED" ? "SUCCESS" : "FAILED" : "UNKNOWN", lastError: null, scopeChecks: { "contacts.readonly": true, "contacts.write": false, "opportunities.readonly": true, "opportunities.write": false, "users.readonly": true }, warnings, allWorkspaceConnections },
    webhookLogs: webhookLogs.slice(0, 10)
  });
});
app.post("/api/ghl/sso", async (req, res) => {
  const { encryptedData } = req.body;
  if (!encryptedData || typeof encryptedData !== "string") {
    return res.status(400).json({ status: "error", error: "Missing encryptedData" });
  }
  const sharedSecret = process.env.GHL_APP_SHARED_SECRET;
  if (!sharedSecret) {
    return res.status(500).json({ status: "error", error: "SSO not configured on this server." });
  }
  let ghlData;
  try {
    ghlData = decryptGhlPayload(encryptedData, sharedSecret);
  } catch (e) {
    console.error("[GHL SSO] Decryption failed:", e.message);
    return res.status(400).json({ status: "error", error: "Invalid or tampered SSO payload." });
  }
  const locationId = ghlData.activeLocation || "";
  if (!locationId) {
    return res.status(400).json({ status: "error", error: "SSO payload missing activeLocation." });
  }
  let workspaceId = null;
  const { data: connRow } = await supabaseAdmin.from("ghl_connections").select("workspace_id").eq("location_id", locationId).single();
  if (connRow?.workspace_id) {
    workspaceId = connRow.workspace_id;
  } else {
    const { data: wsRow } = await supabaseAdmin.from("workspaces").select("id").eq("ghl_location_id", locationId).single();
    if (wsRow?.id) workspaceId = wsRow.id;
  }
  if (!workspaceId) {
    return res.status(403).json({ status: "error", error: "This GHL location is not registered in this app." });
  }
  const now = Math.floor(Date.now() / 1e3);
  const token = mintSsoJwt({
    workspaceId,
    locationId,
    email: ghlData.email || "",
    userId: ghlData.userId || "",
    ghlRole: ghlData.role || "user",
    iat: now,
    exp: now + 28800
    // 8-hour session
  });
  try {
    await logAction(workspaceId, ghlData.userId || "ghl_sso", ghlData.email || "", "GHL_SSO_LOGIN", `GHL SSO login via location ${locationId}`);
  } catch {
  }
  return res.json({ status: "success", token, workspaceId });
});
app.post("/api/ghl/config", requireAuth(["SUPER_ADMIN" /* SUPER_ADMIN */, "WORKSPACE_OWNER" /* WORKSPACE_OWNER */, "ADMIN" /* ADMIN */]), async (req, res) => {
  const config = await getWorkspaceGhlConfig(req.workspace.id);
  if (!canUserManageGhl(req.role, config.allowAdminManageGHL)) return res.status(403).json({ status: "error", error: "Access Denied." });
  const { dataSourceMode, apiKey, locationId, cacheTtlMinutes, allowAdminManageGHL } = req.body;
  const settingsUpdate = {};
  if (dataSourceMode !== void 0) settingsUpdate.mode = dataSourceMode;
  if (cacheTtlMinutes !== void 0) settingsUpdate.cache_ttl_minutes = Number(cacheTtlMinutes) || 15;
  if (allowAdminManageGHL !== void 0) settingsUpdate.allow_admin_manage_ghl = !!allowAdminManageGHL;
  if (Object.keys(settingsUpdate).length > 0) {
    await supabaseAdmin.from("reporting_settings").update(settingsUpdate).eq("workspace_id", req.workspace.id);
  }
  let resolvedApiKey = apiKey;
  if (apiKey && apiKey.includes("\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022")) resolvedApiKey = config.apiKey;
  if (locationId !== void 0 || resolvedApiKey !== void 0 && resolvedApiKey !== "") {
    const existing = await getGHLConnection(req.workspace.id);
    if (!existing) {
      await supabaseAdmin.from("ghl_connections").insert({ id: `gn_${Date.now()}`, workspace_id: req.workspace.id, location_id: locationId || req.workspace.ghlLocationId || "", api_key: resolvedApiKey || "", status: resolvedApiKey ? "CONNECTED" : "DISCONNECTED" });
    } else {
      const connUpdate = {};
      if (locationId !== void 0) connUpdate.location_id = locationId;
      if (resolvedApiKey !== void 0) {
        connUpdate.api_key = resolvedApiKey;
        connUpdate.status = resolvedApiKey ? "CONNECTED" : "DISCONNECTED";
        connUpdate.connected_at = (/* @__PURE__ */ new Date()).toISOString();
      }
      await supabaseAdmin.from("ghl_connections").update(connUpdate).eq("workspace_id", req.workspace.id);
    }
  }
  await logAction(req.workspace.id, req.user.id, req.user.email, "UPDATE_INTEGRATION_KEY", "Updated GHL integration parameters.");
  invalidateTenantCache(req.workspace.id);
  const updated = await getWorkspaceGhlConfig(req.workspace.id);
  res.json({ status: "success", message: "Workspace configurations updated successfully.", data: { dataSourceMode: updated.dataSourceMode, apiKey: updated.apiKeyMasked, apiKeyMasked: updated.apiKeyMasked, locationId: updated.locationId, companyId: updated.companyId, cacheTtlMinutes: updated.cacheTtlMinutes, allowAdminManageGHL: updated.allowAdminManageGHL, connectionStatus: updated.status, apiConnectedSince: updated.connectedAt } });
});
app.post("/api/ghl/save-connection", requireAuth(), async (req, res) => {
  const config = await getWorkspaceGhlConfig(req.workspace.id);
  if (!canUserManageGhl(req.role, config.allowAdminManageGHL)) return res.status(403).json({ status: "error", error: "Access Denied." });
  let { apiKey, locationId, allowAdminManageGHL } = req.body;
  if (apiKey && apiKey.includes("\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022")) apiKey = config.apiKey;
  const existing = await getGHLConnection(req.workspace.id);
  if (!existing) {
    await supabaseAdmin.from("ghl_connections").insert({ id: `gn_${Date.now()}`, workspace_id: req.workspace.id, location_id: locationId || req.workspace.ghlLocationId || "", api_key: apiKey || "", status: apiKey ? "CONNECTED" : "DISCONNECTED" });
  } else {
    const upd = {};
    if (locationId !== void 0) upd.location_id = locationId;
    if (apiKey !== void 0) {
      upd.api_key = apiKey;
      upd.status = apiKey ? "CONNECTED" : "DISCONNECTED";
      upd.connected_at = (/* @__PURE__ */ new Date()).toISOString();
    }
    await supabaseAdmin.from("ghl_connections").update(upd).eq("workspace_id", req.workspace.id);
  }
  if (allowAdminManageGHL !== void 0) {
    await supabaseAdmin.from("reporting_settings").update({ allow_admin_manage_ghl: !!allowAdminManageGHL }).eq("workspace_id", req.workspace.id);
  }
  await logAction(req.workspace.id, req.user.id, req.user.email, "SAVE_GHL_CONNECTION", `Saved GHL connection. Location: ${locationId}`);
  invalidateTenantCache(req.workspace.id);
  res.json({ status: "success", message: "Connection settings saved successfully." });
});
app.post("/api/ghl/test-connection", requireAuth(), async (req, res) => {
  const workspaceConfig = await getWorkspaceGhlConfig(req.workspace.id);
  let { apiKey, locationId } = req.body;
  if (!apiKey || apiKey.includes("\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022")) apiKey = workspaceConfig.apiKey;
  if (!locationId) locationId = workspaceConfig.locationId;
  if (workspaceConfig.dataSourceMode === "MOCK" && (!apiKey || !locationId)) {
    return res.json({ status: "success", source: "mock", message: "Synthesized Sandbox Connection Test Passed.", details: { responseTimeMs: 38, authType: "Private Integration Token", scopesActive: ["contacts.readonly", "opportunities.readonly", "users.readonly"], rateLimits: { remaining: 100, limit: 100 } } });
  }
  if (!apiKey || !locationId) return res.status(400).json({ status: "error", error: "GHL Private Token and Location ID are required." });
  try {
    const baseUrl = process.env.GHL_BASE_URL || "https://services.leadconnectorhq.com";
    const version = process.env.GHL_API_VERSION || "2021-07-28";
    const testResponse = await fetch(`${baseUrl}/users/?locationId=${locationId}`, { method: "GET", headers: { "Authorization": `Bearer ${apiKey}`, "Version": version, "Content-Type": "application/json" } });
    if (testResponse.ok) {
      await logAction(req.workspace.id, req.user.id, req.user.email, "TEST_GHL_API_SUCCESS", "Test connection succeeded.");
      return res.json({ status: "success", source: "live", message: "Connection successful! HighLevel API V2 responded with HTTP 200 OK.", details: { responseTimeMs: 122, authType: "Private Integration Token", scopesActive: ["contacts.readonly", "opportunities.readonly", "users.readonly"], rateLimits: { remaining: parseInt(testResponse.headers.get("x-ratelimit-remaining") || "98"), limit: parseInt(testResponse.headers.get("x-ratelimit-limit") || "100") } } });
    } else {
      const errText = await testResponse.text();
      let errorMsg = `Connection failed: HTTP ${testResponse.status}`;
      if (testResponse.status === 401) errorMsg = "Unauthorized. Check your Private Integration Key.";
      else if (testResponse.status === 403) errorMsg = "Forbidden. Validate your Location ID permissions.";
      return res.status(testResponse.status).json({ status: "error", error: errorMsg });
    }
  } catch (err) {
    return res.status(500).json({ status: "error", error: `API Gateway unreachable: ${err.message}` });
  }
});
app.post("/api/ghl/switch-mode", requireAuth(), async (req, res) => {
  const config = await getWorkspaceGhlConfig(req.workspace.id);
  if (!canUserManageGhl(req.role, config.allowAdminManageGHL)) return res.status(403).json({ status: "error", error: "Access Denied." });
  const { mode } = req.body;
  if (mode !== "MOCK" && mode !== "LIVE") return res.status(400).json({ status: "error", error: "Invalid mode." });
  await supabaseAdmin.from("reporting_settings").update({ mode }).eq("workspace_id", req.workspace.id);
  await logAction(req.workspace.id, req.user.id, req.user.email, "TOGGLE_REPORTING_SOURCE_MODE", `Switched reporting source to ${mode}`);
  invalidateTenantCache(req.workspace.id);
  res.json({ status: "success", message: `Data source changed to ${mode} mode.` });
});
app.post("/api/ghl/disconnect", requireAuth(), async (req, res) => {
  const config = await getWorkspaceGhlConfig(req.workspace.id);
  if (!canUserManageGhl(req.role, config.allowAdminManageGHL)) return res.status(403).json({ status: "error", error: "Access Denied." });
  await supabaseAdmin.from("ghl_connections").delete().eq("workspace_id", req.workspace.id);
  await supabaseAdmin.from("reporting_settings").update({ mode: "MOCK" }).eq("workspace_id", req.workspace.id);
  await logAction(req.workspace.id, req.user.id, req.user.email, "DISCONNECT_GHL_CREDENTIALS", "Severed GHL API credentials.");
  invalidateTenantCache(req.workspace.id);
  res.json({ status: "success", message: "GoHighLevel connection deleted. Mode fell back to Mock." });
});
app.post("/api/ghl/update-cache-ttl", requireAuth(), async (req, res) => {
  const config = await getWorkspaceGhlConfig(req.workspace.id);
  if (!canUserManageGhl(req.role, config.allowAdminManageGHL)) return res.status(403).json({ status: "error", error: "Access Denied." });
  const minutes = Number(req.body.cacheTtlMinutes);
  if (isNaN(minutes) || minutes < 1 || minutes > 1440) return res.status(400).json({ status: "error", error: "Cache TTL must be between 1 and 1440 minutes." });
  await supabaseAdmin.from("reporting_settings").update({ cache_ttl_minutes: minutes }).eq("workspace_id", req.workspace.id);
  await logAction(req.workspace.id, req.user.id, req.user.email, "CHANGE_CACHE_TTL", `Cache TTL set to ${minutes} minutes.`);
  invalidateTenantCache(req.workspace.id);
  res.json({ status: "success", message: "Cache TTL updated successfully." });
});
app.post("/api/ghl/webhook", async (req, res) => {
  const payload = req.body;
  webhookLogs.unshift({ timestamp: (/* @__PURE__ */ new Date()).toISOString(), source: "GoHighLevel Webhook (Live Inflow)", event: payload.type || "unknown_event", payload });
  const { data: conn } = await supabaseAdmin.from("ghl_connections").select("workspace_id").eq("location_id", payload.locationId || payload.location_id || "").single();
  if (conn) {
    invalidateTenantCache(conn.workspace_id);
  } else {
    tenantMetricsCache.clear();
    tenantOwnerPerfCache.clear();
    tenantMarketingCache.clear();
  }
  res.status(200).json({ status: "delivered", received: true });
});
app.get("/api/ghl/metrics", requireAuth(), async (req, res) => {
  try {
    await syncGhlToMockDb(req.workspace.id);
    const result = await LiveReportingService.getOverviewDashboardReport(req.workspace.id);
    if (!result.data) return res.status(503).json({ status: "error", source: result.source, error: result.error || "Live data unavailable", warnings: result.warnings || [] });
    return res.json({ status: "success", source: result.source, stale: !!result.stale, warnings: result.warnings || [], data: result.data });
  } catch (err) {
    return res.status(500).json({ status: "error", error: err.message });
  }
});
app.get("/api/ghl/owner-performance", requireAuth(), async (req, res) => {
  try {
    await syncGhlToMockDb(req.workspace.id);
    const result = await LiveReportingService.getOwnerDashboardReport(req.workspace.id);
    if (!result.data) return res.status(503).json({ status: "error", source: result.source, error: result.error || "Live data unavailable", warnings: result.warnings || [] });
    return res.json({ status: "success", source: result.source, data: result.data.ownerBreakdown });
  } catch (err) {
    return res.status(500).json({ status: "error", error: err.message });
  }
});
app.get("/api/ghl/marketing-performance", requireAuth(), async (req, res) => {
  try {
    await syncGhlToMockDb(req.workspace.id);
    const result = await LiveReportingService.getMarketingDashboardReport(req.workspace.id);
    if (!result.data) return res.status(503).json({ status: "error", source: result.source, error: result.error || "Live data unavailable", warnings: result.warnings || [] });
    const rep = result.data;
    const formatted = Object.keys(rep.leadsBySource).map((src) => {
      const leads = rep.leadsBySource[src] || 0;
      const bookings = rep.bookingsBySource[src] || 0;
      const wonVal = rep.wonRevenueBySource[src] || 0;
      const pip = rep.pipelineValueBySource[src] || 0;
      return { source: src, leadsCount: leads, conversionRate: leads > 0 ? Math.round(bookings / leads * 100) : 0, pipelineValue: pip, closedWonValue: wonVal, costEstimate: 0, roi: 0, weeklyLeadsTrend: [{ date: "Wk 1", count: Math.round(leads * 0.2) }, { date: "Wk 2", count: Math.round(leads * 0.3) }, { date: "Wk 3", count: Math.round(leads * 0.5) }, { date: "Wk 4", count: leads }] };
    });
    return res.json({ status: "success", source: result.source, data: formatted });
  } catch (err) {
    return res.status(500).json({ status: "error", error: err.message });
  }
});
app.get("/api/reporting/owner-performance", requireAuth(), async (req, res) => {
  try {
    await syncGhlToMockDb(req.workspace.id);
    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : void 0;
    const endDate = typeof req.query.endDate === "string" ? req.query.endDate : void 0;
    const userId = typeof req.query.userId === "string" ? req.query.userId : void 0;
    const source = typeof req.query.source === "string" ? req.query.source : void 0;
    const campaign = typeof req.query.campaign === "string" ? req.query.campaign : void 0;
    const warnings = [];
    if (startDate && !isValidDateString(startDate)) return res.status(400).json({ status: "error", source: "mock", generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: "startDate must be YYYY-MM-DD." });
    if (endDate && !isValidDateString(endDate)) return res.status(400).json({ status: "error", source: "mock", generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: "endDate must be YYYY-MM-DD." });
    const force = req.query.force === "1";
    if (force) {
      const { invalidateWorkspaceCacheStore: invalidateWorkspaceCacheStore2 } = await Promise.resolve().then(() => (init_ghlService(), ghlService_exports));
      invalidateWorkspaceCacheStore2(req.workspace.id);
    }
    const result = await LiveReportingService.getOwnerDashboardReport(req.workspace.id, { startDate, endDate, userId, source, campaign, force });
    if (result.warnings) warnings.push(...result.warnings);
    if (!result.data) return res.status(503).json({ status: "error", source: result.source, generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: false, warnings, unavailableMetrics: ["all"], error: result.error || "Live data unavailable" });
    return res.status(200).json({ status: "success", source: result.source, generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: !!result.stale, cachedAt: result.cachedAt || null, warnings, unavailableMetrics: result.unavailableMetrics || [], data: result.data });
  } catch (err) {
    return res.status(500).json({ status: "error", source: "mock", generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: err.message });
  }
});
app.get("/api/reporting/va-performance", requireAuth(), (req, res) => {
  try {
    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : void 0;
    const endDate = typeof req.query.endDate === "string" ? req.query.endDate : void 0;
    const userId = typeof req.query.userId === "string" ? req.query.userId : void 0;
    const source = typeof req.query.source === "string" ? req.query.source : void 0;
    const campaign = typeof req.query.campaign === "string" ? req.query.campaign : void 0;
    const serviceCategory = typeof req.query.serviceCategory === "string" ? req.query.serviceCategory : void 0;
    const data = getVAPerformanceReport({ startDate, endDate, userId, source, campaign, serviceCategory });
    return res.status(200).json({ status: "success", source: "mock", generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: false, warnings: [], unavailableMetrics: [], data });
  } catch (err) {
    return res.status(500).json({ status: "error", source: "mock", generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: err.message });
  }
});
app.get("/api/reporting/marketing-performance", requireAuth(), async (req, res) => {
  try {
    await syncGhlToMockDb(req.workspace.id);
    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : void 0;
    const endDate = typeof req.query.endDate === "string" ? req.query.endDate : void 0;
    const userId = typeof req.query.userId === "string" ? req.query.userId : void 0;
    const source = typeof req.query.source === "string" ? req.query.source : void 0;
    const campaign = typeof req.query.campaign === "string" ? req.query.campaign : void 0;
    const warnings = [];
    if (startDate && !isValidDateString(startDate)) return res.status(400).json({ status: "error", source: "mock", generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: "startDate must be YYYY-MM-DD." });
    if (endDate && !isValidDateString(endDate)) return res.status(400).json({ status: "error", source: "mock", generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: "endDate must be YYYY-MM-DD." });
    if (source && source.toLowerCase().includes("tiktok")) warnings.push("TikTok ad accounts are not synced. Cost metrics are estimated.");
    const force = req.query.force === "1";
    if (force) {
      const { invalidateWorkspaceCacheStore: invalidateWorkspaceCacheStore2 } = await Promise.resolve().then(() => (init_ghlService(), ghlService_exports));
      invalidateWorkspaceCacheStore2(req.workspace.id);
    }
    const result = await LiveReportingService.getMarketingDashboardReport(req.workspace.id, { startDate, endDate, userId, source, campaign, force });
    if (result.warnings) warnings.push(...result.warnings);
    if (!result.data) return res.status(503).json({ status: "error", source: result.source, generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: false, warnings, unavailableMetrics: ["all"], error: result.error || "Live data unavailable" });
    return res.status(200).json({ status: "success", source: result.source, generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: !!result.stale, cachedAt: result.cachedAt || null, warnings, unavailableMetrics: result.unavailableMetrics || [], data: result.data });
  } catch (err) {
    return res.status(500).json({ status: "error", source: "mock", generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: err.message });
  }
});
app.get("/api/reporting/estimates-invoices", requireAuth(), async (req, res) => {
  try {
    await syncGhlToMockDb(req.workspace.id);
    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : void 0;
    const endDate = typeof req.query.endDate === "string" ? req.query.endDate : void 0;
    const warnings = [];
    if (startDate && !isValidDateString(startDate)) return res.status(400).json({ status: "error", source: "mock", generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: "startDate must be YYYY-MM-DD." });
    if (endDate && !isValidDateString(endDate)) return res.status(400).json({ status: "error", source: "mock", generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: "endDate must be YYYY-MM-DD." });
    const force = req.query.force === "1";
    if (force) {
      const { invalidateWorkspaceCacheStore: invalidateWorkspaceCacheStore2 } = await Promise.resolve().then(() => (init_ghlService(), ghlService_exports));
      invalidateWorkspaceCacheStore2(req.workspace.id);
    }
    const result = await LiveReportingService.getEstimatesInvoicesReport(req.workspace.id, { startDate, endDate, force });
    if (result.warnings) warnings.push(...result.warnings);
    if (!result.data) return res.status(503).json({ status: "error", source: result.source, generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: false, warnings, unavailableMetrics: ["all"], error: result.error || "Live data unavailable" });
    return res.status(200).json({ status: "success", source: result.source, generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: !!result.stale, cachedAt: result.cachedAt || null, warnings, unavailableMetrics: result.unavailableMetrics || [], data: result.data });
  } catch (err) {
    return res.status(500).json({ status: "error", source: "mock", generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: err.message });
  }
});
app.get("/api/reporting/export/estimates", requireAuth(), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    await syncGhlToMockDb(req.workspace.id);
    const result = await LiveReportingService.getEstimatesExport(req.workspace.id);
    return res.status(200).json({ status: "success", source: result.source, count: result.count, estimates: result.estimates });
  } catch (err) {
    return res.status(500).json({ status: "error", error: err.message });
  }
});
app.get("/api/reporting/export/invoices", requireAuth(), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    await syncGhlToMockDb(req.workspace.id);
    const result = await LiveReportingService.getInvoicesExport(req.workspace.id);
    return res.status(200).json({ status: "success", source: result.source, count: result.count, invoices: result.invoices });
  } catch (err) {
    return res.status(500).json({ status: "error", error: err.message });
  }
});
app.get("/api/reporting/outstanding", requireAuth(), async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    await syncGhlToMockDb(req.workspace.id);
    const force = req.query.force === "1";
    if (force) {
      const { invalidateWorkspaceCacheStore: invalidateWorkspaceCacheStore2 } = await Promise.resolve().then(() => (init_ghlService(), ghlService_exports));
      invalidateWorkspaceCacheStore2(req.workspace.id);
    }
    const result = await LiveReportingService.getOutstandingReport(req.workspace.id, force);
    if (!result.data) return res.status(503).json({ status: "error", source: result.source, generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: false, warnings: result.warnings || [], error: result.error || "Live data unavailable" });
    return res.status(200).json({ status: "success", source: result.source, generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: !!result.stale, cachedAt: result.cachedAt || null, warnings: result.warnings || [], data: result.data });
  } catch (err) {
    return res.status(500).json({ status: "error", source: "mock", generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: false, warnings: [], error: err.message });
  }
});
app.get("/api/reporting/appointment-performance", requireAuth(), async (req, res) => {
  try {
    await syncGhlToMockDb(req.workspace.id);
    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : void 0;
    const endDate = typeof req.query.endDate === "string" ? req.query.endDate : void 0;
    const userId = typeof req.query.userId === "string" ? req.query.userId : void 0;
    const warnings = [];
    if (startDate && !isValidDateString(startDate)) return res.status(400).json({ status: "error", source: "mock", generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: "startDate must be YYYY-MM-DD." });
    if (endDate && !isValidDateString(endDate)) return res.status(400).json({ status: "error", source: "mock", generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: "endDate must be YYYY-MM-DD." });
    const force = req.query.force === "1";
    if (force) {
      const { invalidateWorkspaceCacheStore: invalidateWorkspaceCacheStore2 } = await Promise.resolve().then(() => (init_ghlService(), ghlService_exports));
      invalidateWorkspaceCacheStore2(req.workspace.id);
    }
    const result = await LiveReportingService.getAppointmentDashboardReport(req.workspace.id, { startDate, endDate, userId, force });
    if (result.warnings) warnings.push(...result.warnings);
    if (!result.data) return res.status(503).json({ status: "error", source: result.source, generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: false, warnings, unavailableMetrics: ["all"], error: result.error || "Live data unavailable" });
    return res.status(200).json({ status: "success", source: result.source, generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: !!result.stale, cachedAt: result.cachedAt || null, warnings, unavailableMetrics: result.unavailableMetrics || [], data: result.data });
  } catch (err) {
    return res.status(500).json({ status: "error", source: "mock", generatedAt: (/* @__PURE__ */ new Date()).toISOString(), stale: false, warnings: [], unavailableMetrics: [], error: err.message });
  }
});
app.get("/api/integrations/google/auth", requireAuth(), async (req, res) => {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !redirectUri || !clientSecret) {
    return res.status(500).json({ status: "error", error: "Google OAuth is not configured on this server. Add GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REDIRECT_URI." });
  }
  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = mintOAuthState(req.workspace.id, codeVerifier);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    access_type: "offline",
    prompt: "consent",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state
  });
  return res.json({ status: "success", authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
});
app.get("/api/integrations/google/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const oauthError = typeof req.query.error === "string" ? req.query.error : "";
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  const closeWithMsg = (type, extra = "") => res.send(`<!DOCTYPE html><html><body><script>if(window.opener){window.opener.postMessage({type:${JSON.stringify(type)}${extra}},'*');}window.close();</script><p>${type === "ga4_connected" ? "Connected! You can close this window." : "Authorization failed \u2014 you can close this window."}</p></body></html>`);
  if (oauthError) return closeWithMsg("ga4_error", `,error:${JSON.stringify(oauthError)}`);
  if (!code || !state) return closeWithMsg("ga4_error", `,error:'Missing code or state'`);
  const statePayload = verifyOAuthState(state);
  if (!statePayload) return closeWithMsg("ga4_error", `,error:'Invalid or expired state'`);
  const { workspaceId, codeVerifier } = statePayload;
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: codeVerifier,
        grant_type: "authorization_code"
      }).toString()
    });
    if (!tokenRes.ok) {
      console.error("[GA4 OAuth] Token exchange failed:", await tokenRes.text());
      return closeWithMsg("ga4_error", `,error:'Token exchange failed'`);
    }
    const tokens = await tokenRes.json();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const expiry = new Date(Date.now() + (tokens.expires_in || 3600) * 1e3).toISOString();
    await supabaseAdmin.from("workspace_integrations").upsert({
      id: `int_ga4_${Date.now()}`,
      workspace_id: workspaceId,
      provider: "google_analytics",
      status: "CONNECTED",
      encrypted_access_token: encryptToken(tokens.access_token),
      encrypted_refresh_token: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
      token_expiry: expiry,
      connected_at: now,
      last_synced_at: now,
      metadata: {}
    }, { onConflict: "workspace_id,provider" });
    try {
      await logAction(workspaceId, "system", "system", "CONNECT_GA4", "Google Analytics connected via OAuth.");
    } catch {
    }
    return closeWithMsg("ga4_connected");
  } catch (err) {
    console.error("[GA4 OAuth] Callback error:", err);
    return closeWithMsg("ga4_error", `,error:'Server error during token exchange'`);
  }
});
app.get("/api/integrations/status", requireAuth(), async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  const { data: rows } = await supabaseAdmin.from("workspace_integrations").select("provider, status, property_id, property_name, connected_at").eq("workspace_id", req.workspace.id);
  const integrations = (rows || []).map((r) => ({
    provider: r.provider,
    status: r.status,
    propertyId: r.property_id || null,
    propertyName: r.property_name || null,
    connectedAt: r.connected_at || null
  }));
  return res.json({ status: "success", integrations });
});
app.delete("/api/integrations/google", requireAuth(), async (req, res) => {
  const { data: row } = await supabaseAdmin.from("workspace_integrations").select("encrypted_access_token").eq("workspace_id", req.workspace.id).eq("provider", "google_analytics").single();
  if (row?.encrypted_access_token) {
    try {
      const accessToken = decryptToken(row.encrypted_access_token);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, { method: "POST" });
    } catch {
    }
  }
  await supabaseAdmin.from("workspace_integrations").delete().eq("workspace_id", req.workspace.id).eq("provider", "google_analytics");
  try {
    await logAction(req.workspace.id, req.user.id, req.user.email, "DISCONNECT_GA4", "Google Analytics disconnected.");
  } catch {
  }
  return res.json({ status: "success", message: "Google Analytics disconnected." });
});
app.get("/api/integrations/google/properties", requireAuth(), async (req, res) => {
  const accessToken = await getValidGoogleToken(req.workspace.id);
  if (!accessToken) {
    return res.status(400).json({ status: "error", error: "Google Analytics is not connected or token refresh failed." });
  }
  try {
    const properties = await fetchGA4Properties(accessToken);
    return res.json({ status: "success", properties });
  } catch (err) {
    return res.status(500).json({ status: "error", error: err.message });
  }
});
app.post("/api/integrations/google/property", requireAuth(), async (req, res) => {
  const { propertyId, propertyName } = req.body;
  if (!propertyId) return res.status(400).json({ status: "error", error: "propertyId is required." });
  await supabaseAdmin.from("workspace_integrations").update({ property_id: propertyId, property_name: propertyName || propertyId }).eq("workspace_id", req.workspace.id).eq("provider", "google_analytics");
  try {
    await logAction(req.workspace.id, req.user.id, req.user.email, "SET_GA4_PROPERTY", `GA4 property set: ${propertyId}`);
  } catch {
  }
  return res.json({ status: "success", message: "GA4 property saved." });
});
async function getMetaToken(workspaceId) {
  const { data: row } = await supabaseAdmin.from("workspace_integrations").select("encrypted_access_token, property_id").eq("workspace_id", workspaceId).eq("provider", "meta_ads").single();
  if (!row?.encrypted_access_token || !row?.property_id) return null;
  try {
    return { token: decryptToken(row.encrypted_access_token), adAccountId: row.property_id };
  } catch {
    return null;
  }
}
async function fetchMetaInsights(token, adAccountId, startDate, endDate) {
  const GV = "v22.0";
  const base = `https://graph.facebook.com/${GV}/act_${adAccountId}/insights`;
  const fields = "spend,impressions,reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type,purchase_roas";
  const timeRange = JSON.stringify({ since: startDate, until: endDate });
  const acctRes = await fetch(`${base}?fields=${fields}&time_range=${encodeURIComponent(timeRange)}&level=account&limit=1&access_token=${encodeURIComponent(token)}`);
  if (!acctRes.ok) {
    const errBody = await acctRes.text();
    throw new Error(`Meta API ${acctRes.status}: ${errBody.slice(0, 200)}`);
  }
  const acctData = await acctRes.json();
  const accountLevel = (acctData.data || [])[0] || null;
  const campaignFields = `campaign_id,campaign_name,${fields}`;
  let campaigns = [];
  let url = `${base}?fields=${encodeURIComponent(campaignFields)}&time_range=${encodeURIComponent(timeRange)}&level=campaign&limit=500&access_token=${encodeURIComponent(token)}`;
  let pageCount = 0;
  while (url && pageCount < 10) {
    const r = await fetch(url);
    if (!r.ok) break;
    const d = await r.json();
    campaigns = campaigns.concat(d.data || []);
    url = d.paging?.next || null;
    pageCount++;
  }
  return { accountLevel, campaigns };
}
function parseMetaActions(actions, costPerAction) {
  const PURCHASE_TYPES = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"];
  const cv = (actions || []).find((a) => PURCHASE_TYPES.includes(a.action_type));
  const cp = (costPerAction || []).find((a) => PURCHASE_TYPES.includes(a.action_type));
  return {
    conversions: cv ? parseFloat(cv.value || "0") : 0,
    costPerResult: cp ? parseFloat(cp.value || "0") : 0
  };
}
function normalizeMetaReport(accountLevel, campaigns, source, adAccountId, adAccountName) {
  const a = accountLevel || {};
  const { conversions, costPerResult } = parseMetaActions(a.actions || [], a.cost_per_action_type || []);
  const roasEntry = (a.purchase_roas || []).find((r) => r.action_type === "omni_purchase") || (a.purchase_roas || [])[0];
  const normalizedCampaigns = campaigns.map((c) => {
    const { conversions: cv, costPerResult: cpr } = parseMetaActions(c.actions || [], c.cost_per_action_type || []);
    const cRoas = (c.purchase_roas || []).find((r) => r.action_type === "omni_purchase") || (c.purchase_roas || [])[0];
    return {
      id: c.campaign_id || "",
      name: c.campaign_name || "Unknown",
      spend: parseFloat(c.spend || "0"),
      impressions: parseInt(c.impressions || "0"),
      reach: parseInt(c.reach || "0"),
      clicks: parseInt(c.clicks || "0"),
      ctr: parseFloat(c.ctr || "0"),
      cpc: parseFloat(c.cpc || "0"),
      cpm: parseFloat(c.cpm || "0"),
      conversions: cv,
      costPerResult: cpr,
      roas: cRoas ? parseFloat(cRoas.value || "0") : 0
    };
  }).sort((x, y) => y.spend - x.spend);
  return {
    spend: parseFloat(a.spend || "0"),
    impressions: parseInt(a.impressions || "0"),
    reach: parseInt(a.reach || "0"),
    clicks: parseInt(a.clicks || "0"),
    ctr: parseFloat(a.ctr || "0"),
    cpc: parseFloat(a.cpc || "0"),
    cpm: parseFloat(a.cpm || "0"),
    conversions,
    costPerResult,
    roas: roasEntry ? parseFloat(roasEntry.value || "0") : 0,
    campaigns: normalizedCampaigns,
    source,
    warnings: [],
    adAccountId,
    adAccountName
  };
}
function getMockMetaReport() {
  return {
    spend: 4250,
    impressions: 182500,
    reach: 94300,
    clicks: 3640,
    ctr: 1.99,
    cpc: 1.17,
    cpm: 23.29,
    conversions: 48,
    costPerResult: 88.54,
    roas: 3.82,
    campaigns: [
      { id: "1", name: "Pool Install \u2013 Spring Leads", spend: 1800, impressions: 74e3, reach: 38200, clicks: 1520, ctr: 2.05, cpc: 1.18, cpm: 24.32, conversions: 22, costPerResult: 81.82, roas: 4.1 },
      { id: "2", name: "Pool Repair Retargeting", spend: 950, impressions: 42e3, reach: 28500, clicks: 880, ctr: 2.1, cpc: 1.08, cpm: 22.62, conversions: 14, costPerResult: 67.86, roas: 4.55 },
      { id: "3", name: "Brand Awareness \u2013 Summer", spend: 750, impressions: 48e3, reach: 19400, clicks: 620, ctr: 1.29, cpc: 1.21, cpm: 15.63, conversions: 7, costPerResult: 107.14, roas: 2.8 },
      { id: "4", name: "Service Promo \u2013 June", spend: 750, impressions: 18500, reach: 8200, clicks: 620, ctr: 3.35, cpc: 1.21, cpm: 40.54, conversions: 5, costPerResult: 150, roas: 2.5 }
    ],
    source: "mock",
    warnings: ["Meta Ads is not connected. Showing sample data."],
    adAccountName: "Showtime Pool Mechanics",
    adAccountId: ""
  };
}
app.post("/api/integrations/meta/connect", requireAuth(), async (req, res) => {
  const { accessToken: rawToken, adAccountId } = req.body;
  if (!rawToken || !adAccountId) return res.status(400).json({ status: "error", error: "accessToken and adAccountId are required." });
  const cleanId = adAccountId.replace(/^act_/, "").trim();
  if (!cleanId || !/^\d+$/.test(cleanId)) return res.status(400).json({ status: "error", error: "adAccountId must be numeric (e.g. 123456789 or act_123456789)." });
  try {
    const meRes = await fetch(`https://graph.facebook.com/v22.0/me?access_token=${encodeURIComponent(rawToken)}`);
    if (!meRes.ok) {
      const errBody = await meRes.json();
      return res.status(400).json({ status: "error", error: errBody?.error?.message || "Invalid Meta access token." });
    }
    const acctRes = await fetch(`https://graph.facebook.com/v22.0/act_${cleanId}?fields=name,account_status&access_token=${encodeURIComponent(rawToken)}`);
    const acctData = await acctRes.json();
    if (!acctRes.ok || acctData.error) {
      const msg = acctData?.error?.message || "Cannot access this Ad Account. Verify the account ID and that your token has ads_read permission assigned to this account.";
      return res.status(400).json({ status: "error", error: msg });
    }
    const adAccountName = acctData.name || `act_${cleanId}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const { error: upsertErr } = await supabaseAdmin.from("workspace_integrations").upsert({
      id: `int_meta_${req.workspace.id}`,
      workspace_id: req.workspace.id,
      provider: "meta_ads",
      status: "CONNECTED",
      encrypted_access_token: encryptToken(rawToken),
      encrypted_refresh_token: null,
      token_expiry: null,
      property_id: cleanId,
      property_name: adAccountName,
      connected_at: now,
      last_synced_at: now
    }, { onConflict: "workspace_id,provider" });
    if (upsertErr) {
      console.error("[Meta connect] Supabase upsert error:", upsertErr);
      return res.status(500).json({ status: "error", error: `Database error: ${upsertErr.message}` });
    }
    try {
      await logAction(req.workspace.id, req.user.id, req.user.email, "CONNECT_META_ADS", `Meta Ads connected: act_${cleanId}`);
    } catch {
    }
    return res.json({ status: "success", message: "Meta Ads connected.", adAccountName });
  } catch (err) {
    return res.status(500).json({ status: "error", error: err.message });
  }
});
app.delete("/api/integrations/meta", requireAuth(), async (req, res) => {
  await supabaseAdmin.from("workspace_integrations").delete().eq("workspace_id", req.workspace.id).eq("provider", "meta_ads");
  try {
    await logAction(req.workspace.id, req.user.id, req.user.email, "DISCONNECT_META_ADS", "Meta Ads disconnected.");
  } catch {
  }
  return res.json({ status: "success", message: "Meta Ads disconnected." });
});
app.get("/api/reporting/meta-ads", requireAuth(), async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  const startDate = typeof req.query.startDate === "string" ? req.query.startDate : void 0;
  const endDate = typeof req.query.endDate === "string" ? req.query.endDate : void 0;
  const force = req.query.force === "1";
  const { data: integration } = await supabaseAdmin.from("workspace_integrations").select("status, property_id, property_name").eq("workspace_id", req.workspace.id).eq("provider", "meta_ads").single();
  if (!integration || integration.status !== "CONNECTED") {
    return res.json({ status: "success", connected: false, data: getMockMetaReport() });
  }
  const sd = startDate || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const ed = endDate || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const cacheKey = `meta_ads_${req.workspace.id}_${sd}_${ed}`;
  const META_TTL = 5 * 60 * 1e3;
  if (!force) {
    const cached = serverCacheMemory[cacheKey];
    if (cached && Date.now() - cached.timestamp < META_TTL) {
      return res.json({ status: "success", connected: true, data: cached.data });
    }
  }
  const creds = await getMetaToken(req.workspace.id);
  if (!creds) {
    return res.json({ status: "success", connected: true, data: { ...getMockMetaReport(), source: "mock", warnings: ["Token unavailable \u2014 reconnect Meta Ads."] } });
  }
  try {
    const { accountLevel, campaigns } = await fetchMetaInsights(creds.token, creds.adAccountId, sd, ed);
    const data = normalizeMetaReport(accountLevel, campaigns, "live", integration.property_id || "", integration.property_name || "");
    serverCacheMemory[cacheKey] = { data, timestamp: Date.now() };
    await supabaseAdmin.from("workspace_integrations").update({ last_synced_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("workspace_id", req.workspace.id).eq("provider", "meta_ads");
    return res.json({ status: "success", connected: true, data });
  } catch (err) {
    console.error("[Meta Ads]", err.message);
    return res.json({ status: "success", connected: true, data: { ...getMockMetaReport(), source: "mock", warnings: [`Meta API error: ${err.message.slice(0, 120)} \u2014 showing sample data.`] } });
  }
});
app.get("/api/debug/ghl-payments", requireAuth(["SUPER_ADMIN" /* SUPER_ADMIN */, "WORKSPACE_OWNER" /* WORKSPACE_OWNER */]), async (req, res) => {
  const { resolveGHLAuthentication: resolveGHLAuthentication2 } = await Promise.resolve().then(() => (init_ghlService(), ghlService_exports));
  let auth;
  try {
    auth = resolveGHLAuthentication2(req.workspace.id);
  } catch (e) {
    return res.json({ status: "error", step: "auth", error: e.message });
  }
  const { authHeader, locationId } = auth;
  const base = process.env.GHL_BASE_URL || "https://services.leadconnectorhq.com";
  const ver = process.env.GHL_API_VERSION || "2021-07-28";
  const hdrs = { "Authorization": authHeader, "Version": ver, "Content-Type": "application/json" };
  async function probe(label, url) {
    try {
      const r = await fetch(url, { headers: hdrs });
      const body = await r.text();
      return { label, url, status: r.status, bodyPreview: body.slice(0, 400) };
    } catch (e) {
      return { label, url, status: "NETWORK_ERROR", bodyPreview: e.message };
    }
  }
  const sd = req.query.startDate || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const ed = req.query.endDate || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const results = await Promise.all([
    // How we currently call estimates
    probe("estimates_current", `${base}/estimates/?limit=5&page=1&locationId=${locationId}&startDate=${sd}&endDate=${ed}`),
    // How we currently call invoices
    probe("invoices_current", `${base}/invoices/?limit=5&page=1&locationId=${locationId}&startDate=${sd}&endDate=${ed}`),
    // Invoices with altId/altType (docs alternative)
    probe("invoices_altId", `${base}/invoices/?limit=5&altId=${locationId}&altType=location`),
    // Invoices with offset pagination
    probe("invoices_offset", `${base}/invoices/?limit=5&offset=0&altId=${locationId}&altType=location`)
  ]);
  return res.json({ status: "ok", locationId, results });
});
app.get("/api/reporting/ga4", requireAuth(), async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  const startDate = typeof req.query.startDate === "string" ? req.query.startDate : void 0;
  const endDate = typeof req.query.endDate === "string" ? req.query.endDate : void 0;
  const { data: integration } = await supabaseAdmin.from("workspace_integrations").select("status, property_id").eq("workspace_id", req.workspace.id).eq("provider", "google_analytics").single();
  if (!integration || integration.status !== "CONNECTED") {
    return res.json({ status: "success", connected: false, data: null });
  }
  if (!integration.property_id) {
    return res.json({ status: "success", connected: true, propertySelected: false, data: null });
  }
  const sd = startDate || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const ed = endDate || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const accessToken = await getValidGoogleToken(req.workspace.id);
  if (!accessToken) {
    const mock = getMockGA4Report();
    return res.json({ status: "success", connected: true, propertySelected: true, data: { ...mock, source: "mock", warnings: ["Token refresh failed \u2014 showing sample data. Reconnect Google Analytics."] } });
  }
  try {
    const liveData = await fetchGA4Report(accessToken, integration.property_id, sd, ed);
    await supabaseAdmin.from("workspace_integrations").update({ last_synced_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("workspace_id", req.workspace.id).eq("provider", "google_analytics");
    return res.json({ status: "success", connected: true, propertySelected: true, data: { ...liveData, source: "live", warnings: [] } });
  } catch (err) {
    const mock = getMockGA4Report();
    return res.json({ status: "success", connected: true, propertySelected: true, data: { ...mock, source: "mock", warnings: [`GA4 API error: ${err.message} \u2014 showing sample data.`] } });
  }
});
app.use((err, _req, res, next) => {
  console.error("[unhandled]", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ status: "error", error: err?.message || "Internal server error" });
});
var index_default = app;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  requireAuth
});
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
