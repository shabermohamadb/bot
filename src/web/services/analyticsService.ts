import { prisma } from '../../database/client';
import {
  getWeekRange,
  getMonthRange,
  getAllTimeRange,
  toISODate,
  formatFullDateTime,
  WeekRange,
  MonthRange,
} from '../utils/dateUtils';
import { resolveDiscordUser, resolveDiscordUsers, DiscordUserProfile, getBotProfile } from './discordUserService';
import { generatePartyTitle } from '../../services/embedService';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  partyCount: number;
  lastActive: string | null;
  activityBreakdown: Record<string, number>;
}

export interface JoinedLeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  joinedCount: number;
  lastActive: string | null;
  preferredRole?: string;
  roleBreakdown: Record<string, number>;
}

export interface ActivityEvent {
  id: string;
  type: 'party_created' | 'member_registered' | 'party_completed' | 'party_updated';
  title: string;
  description: string;
  partyTitle: string;
  partyId: string;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  timestamp: string;
  formattedTime: string;
}

export interface PartyTypeDistribution {
  total: number;
  ava: { count: number; percent: number };
  outlands: { count: number; percent: number };
  both: { count: number; percent: number };
}

export interface OverviewMetrics {
  period: string;
  dateRange: { start: string; end: string; label: string };
  totalPartiesHosted: number;
  activeParties: number;
  totalUniqueHosts: number;
  topHost: LeaderboardEntry | null;
  topJoined?: JoinedLeaderboardEntry | null;
  totalJoined?: number;
  uniqueParticipants?: number;
  activityOverTime: Array<{ date: string; label: string; count: number }>;
  partyTypes: PartyTypeDistribution;
  recentActivity: ActivityEvent[];
  currentUser: any;
  topHosts: LeaderboardEntry[];
  recentParties: Array<any>;
  lastUpdated: string;
}

/**
 * Computes the main overview analytics metrics for a selected period.
 */
export async function getOverviewMetrics(period: 'week' | 'month' | 'all' = 'week'): Promise<OverviewMetrics> {
  const range = period === 'week' ? getWeekRange(0) : period === 'month' ? getMonthRange(0) : getAllTimeRange();

  // 1. Total parties in period
  const totalPartiesHosted = await prisma.party.count({
    where: {
      createdAt: {
        gte: range.start,
        lte: range.end,
      },
    },
  });

  // 2. Currently active parties
  const activeParties = await prisma.party.count({
    where: { status: 'OPEN' },
  });

  // 3. Unique hosts in period
  const distinctHosts = await prisma.party.groupBy({
    by: ['organizerId'],
    where: {
      createdAt: {
        gte: range.start,
        lte: range.end,
      },
    },
    _count: { id: true },
    orderBy: {
      _count: { id: 'desc' },
    },
  });

  const totalUniqueHosts = distinctHosts.length;

  // 4. Resolve top hosts with profiles
  const topHostIds = distinctHosts.slice(0, 5).map((h) => h.organizerId);
  const userMap = await resolveDiscordUsers(topHostIds);

  const topHosts: LeaderboardEntry[] = distinctHosts.slice(0, 5).map((h, index) => {
    const profile = userMap.get(h.organizerId) || {
      userId: h.organizerId,
      username: h.organizerId,
      displayName: h.organizerId,
      avatarUrl: getDefaultAvatarUrl(h.organizerId),
    };
    return {
      rank: index + 1,
      userId: h.organizerId,
      username: profile.username,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      partyCount: h._count.id,
      lastActive: null,
      activityBreakdown: {},
    };
  });

  const topHost = topHosts[0] || null;

  // 4b. Resolve top participants (most joined in period)
  const distinctParticipants = await prisma.partyRegistration.groupBy({
    by: ['userId'],
    where: {
      registeredAt: {
        gte: range.start,
        lte: range.end,
      },
    },
    _count: { id: true },
    orderBy: {
      _count: { id: 'desc' },
    },
  });

  const totalJoined = await prisma.partyRegistration.count({
    where: {
      registeredAt: {
        gte: range.start,
        lte: range.end,
      },
    },
  });

  let topJoined: JoinedLeaderboardEntry | null = null;
  if (distinctParticipants.length > 0) {
    const topParticipantId = distinctParticipants[0].userId;
    const participantProfiles = await resolveDiscordUsers([topParticipantId]);
    const profile = participantProfiles.get(topParticipantId);
    topJoined = {
      rank: 1,
      userId: topParticipantId,
      username: profile?.username || topParticipantId,
      displayName: profile?.displayName || topParticipantId,
      avatarUrl: profile?.avatarUrl || getDefaultAvatarUrl(topParticipantId),
      joinedCount: distinctParticipants[0]._count.id,
      lastActive: null,
      roleBreakdown: {},
    };
  }

  // 5. Activity over time (daily counts for the last 14 days or period)
  const daysCount = period === 'month' ? 30 : 14;
  const timeBuckets: Array<{ date: string; label: string; count: number }> = [];
  const now = new Date();

  for (let i = daysCount - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() - i);
    const dayStr = toISODate(d);
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    timeBuckets.push({ date: dayStr, label, count: 0 });
  }

  const rangeStartForChart = new Date(now);
  rangeStartForChart.setUTCDate(now.getUTCDate() - (daysCount - 1));
  rangeStartForChart.setUTCHours(0, 0, 0, 0);

  const partiesForChart = await prisma.party.findMany({
    where: {
      createdAt: {
        gte: rangeStartForChart,
      },
    },
    select: { createdAt: true },
  });

  const countMap = new Map<string, number>();
  partiesForChart.forEach((p) => {
    const day = toISODate(p.createdAt);
    countMap.set(day, (countMap.get(day) || 0) + 1);
  });

  timeBuckets.forEach((bucket) => {
    bucket.count = countMap.get(bucket.date) || 0;
  });

  // 6. Recent Parties
  const recentRawParties = await prisma.party.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
    include: {
      roles: {
        include: {
          registrations: true,
        },
      },
    },
  });

  const recentHostIds = recentRawParties.map((p) => p.organizerId);
  const recentUserMap = await resolveDiscordUsers(recentHostIds);

  const recentParties = recentRawParties.map((p) => {
    let totalSlots = 0;
    let registeredCount = 0;
    p.roles.forEach((r) => {
      totalSlots += r.capacity;
      registeredCount += r.registrations.length;
    });

    const hostProfile = recentUserMap.get(p.organizerId);
    return {
      id: p.id,
      title: generatePartyTitle(p),
      rawTitle: p.title,
      organizerId: p.organizerId,
      host: hostProfile,
      activityType: p.activityType,
      ipRequirement: p.ipRequirement,
      durationMinutes: p.durationMinutes,
      status: p.status,
      registeredCount,
      totalSlots,
      createdAt: p.createdAt.toISOString(),
      formattedDate: formatFullDateTime(p.createdAt),
    };
  });

  // 7. Party Types breakdown (AVA, Outlands, Both)
  const typeCounts = await prisma.party.groupBy({
    by: ['activityType'],
    _count: { id: true },
  });
  let avaCount = 0;
  let outlandsCount = 0;
  let bothCount = 0;
  let totalPartyTypes = 0;
  typeCounts.forEach((tc) => {
    totalPartyTypes += tc._count.id;
    if (tc.activityType === 'AVA') avaCount += tc._count.id;
    else if (tc.activityType === 'Outlands') outlandsCount += tc._count.id;
    else if (tc.activityType === 'Both') bothCount += tc._count.id;
  });
  const partyTypes: PartyTypeDistribution = {
    total: totalPartyTypes,
    ava: { count: avaCount, percent: totalPartyTypes > 0 ? Math.round((avaCount / totalPartyTypes) * 100) : 0 },
    outlands: { count: outlandsCount, percent: totalPartyTypes > 0 ? Math.round((outlandsCount / totalPartyTypes) * 100) : 0 },
    both: { count: bothCount, percent: totalPartyTypes > 0 ? Math.round((bothCount / totalPartyTypes) * 100) : 0 },
  };

  // 8. Recent Activity (Real events: parties created, members registered, parties completed)
  const recentActivity = await getRecentActivity(10);

  // 9. Current Bot / User Context
  const currentUser = getBotProfile();

  return {
    period,
    dateRange: {
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      label: range.label,
    },
    totalPartiesHosted,
    activeParties,
    totalUniqueHosts,
    topHost,
    topJoined,
    totalJoined,
    uniqueParticipants: distinctParticipants.length,
    activityOverTime: timeBuckets,
    partyTypes,
    recentActivity,
    currentUser,
    topHosts,
    recentParties,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Returns formatted relative time string e.g. "5m ago", "2h ago", "Yesterday".
 */
export function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Queries real events (party creation, registrations, closures) for the vertical activity timeline.
 */
export async function getRecentActivity(limit: number = 10): Promise<ActivityEvent[]> {
  const [recentParties, recentRegistrations] = await Promise.all([
    prisma.party.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.partyRegistration.findMany({
      take: limit,
      orderBy: { registeredAt: 'desc' },
      include: {
        role: true,
        party: true,
      },
    }),
  ]);

  const userIds = [
    ...recentParties.map((p) => p.organizerId),
    ...recentRegistrations.map((r) => r.userId),
  ];
  const userMap = await resolveDiscordUsers(userIds);
  const events: ActivityEvent[] = [];

  recentParties.forEach((p) => {
    const user = userMap.get(p.organizerId) || {
      userId: p.organizerId,
      username: p.organizerId,
      displayName: p.organizerId,
      avatarUrl: getDefaultAvatarUrl(p.organizerId),
    };
    const title = generatePartyTitle(p);
    events.push({
      id: `party-created-${p.id}`,
      type: 'party_created',
      title: 'Party Created',
      description: `organized ${title}`,
      partyTitle: title,
      partyId: p.id,
      userId: p.organizerId,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      timestamp: p.createdAt.toISOString(),
      formattedTime: formatTimeAgo(p.createdAt),
    });

    if (p.status === 'CLOSED' && p.closedAt) {
      events.push({
        id: `party-closed-${p.id}`,
        type: 'party_completed',
        title: 'Party Completed',
        description: `completed raid expedition`,
        partyTitle: title,
        partyId: p.id,
        userId: p.organizerId,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        timestamp: p.closedAt.toISOString(),
        formattedTime: formatTimeAgo(p.closedAt),
      });
    }
  });

  recentRegistrations.forEach((r) => {
    const user = userMap.get(r.userId) || {
      userId: r.userId,
      username: r.userId,
      displayName: r.userId,
      avatarUrl: getDefaultAvatarUrl(r.userId),
    };
    const partyTitle = generatePartyTitle(r.party);
    events.push({
      id: `reg-${r.id}`,
      type: 'member_registered',
      title: 'Member Registered',
      description: `joined as ${r.role.roleName} (#${r.role.roleNumber})`,
      partyTitle,
      partyId: r.partyId,
      userId: r.userId,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      timestamp: r.registeredAt.toISOString(),
      formattedTime: formatTimeAgo(r.registeredAt),
    });
  });

  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return events.slice(0, limit);
}

/**
 * Returns full party details with roles and participants for the party details modal.
 */
export async function getPartyDetails(partyId: string) {
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    include: {
      roles: {
        orderBy: { roleNumber: 'asc' },
        include: {
          registrations: {
            orderBy: { registeredAt: 'asc' },
          },
        },
      },
    },
  });

  if (!party) return null;

  const userIds = [party.organizerId];
  party.roles.forEach((r) => r.registrations.forEach((reg) => userIds.push(reg.userId)));
  const userMap = await resolveDiscordUsers(userIds);

  const hostProfile = userMap.get(party.organizerId) || {
    userId: party.organizerId,
    username: party.organizerId,
    displayName: party.organizerId,
    avatarUrl: getDefaultAvatarUrl(party.organizerId),
  };

  let totalCapacity = 0;
  let totalRegistered = 0;

  const roles = party.roles.map((r) => {
    totalCapacity += r.capacity;
    totalRegistered += r.registrations.length;
    return {
      id: r.id,
      roleNumber: r.roleNumber,
      roleName: r.roleName,
      capacity: r.capacity,
      registeredCount: r.registrations.length,
      isFull: r.registrations.length >= r.capacity,
      members: r.registrations.map((reg) => {
        const memberProfile = userMap.get(reg.userId) || {
          userId: reg.userId,
          username: reg.userId,
          displayName: reg.userId,
          avatarUrl: getDefaultAvatarUrl(reg.userId),
        };
        return {
          id: reg.id,
          userId: reg.userId,
          username: memberProfile.username,
          displayName: memberProfile.displayName,
          avatarUrl: memberProfile.avatarUrl,
          registeredAt: reg.registeredAt.toISOString(),
          formattedDate: formatFullDateTime(reg.registeredAt),
        };
      }),
    };
  });

  return {
    id: party.id,
    title: generatePartyTitle(party),
    rawTitle: party.title,
    guildId: party.guildId,
    organizerId: party.organizerId,
    host: hostProfile,
    activityType: party.activityType,
    ipRequirement: party.ipRequirement,
    durationMinutes: party.durationMinutes,
    minimumTrackingToolkit: party.minimumTrackingToolkit,
    foodCount: party.foodCount,
    foodRequirementScope: party.foodRequirementScope,
    sideTracking: party.sideTracking,
    status: party.status,
    totalCapacity,
    totalRegistered,
    roles,
    createdAt: party.createdAt.toISOString(),
    formattedDate: formatFullDateTime(party.createdAt),
    closedAt: party.closedAt ? party.closedAt.toISOString() : null,
  };
}

/**
 * Computes weekly hosting report for a given week offset (0 = current week, -1 = last week).
 */
export async function getWeeklyReport(offset: number = 0) {
  const currentWeek = getWeekRange(offset);
  const prevWeek = getWeekRange(offset - 1);

  // Current week parties
  const parties = await prisma.party.findMany({
    where: {
      createdAt: {
        gte: currentWeek.start,
        lte: currentWeek.end,
      },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      roles: {
        include: {
          registrations: true,
        },
      },
    },
  });

  // Previous week count
  const prevWeekCount = await prisma.party.count({
    where: {
      createdAt: {
        gte: prevWeek.start,
        lte: prevWeek.end,
      },
    },
  });

  const totalParties = parties.length;
  // Never invent comparison percentages when previous period had 0 data
  const diffPercentage =
    prevWeekCount > 0
      ? Math.round(((totalParties - prevWeekCount) / prevWeekCount) * 100)
      : null;

  // Group by host
  const hostCounts = new Map<string, { count: number; lastActive: Date; breakdown: Record<string, number> }>();
  // Group by day of week (Monday through Sunday)
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dailyActivity = dayNames.map((dayName, idx) => {
    const dayDate = new Date(currentWeek.start);
    dayDate.setUTCDate(currentWeek.start.getUTCDate() + idx);
    return {
      day: dayName,
      date: toISODate(dayDate),
      shortLabel: dayName.slice(0, 3),
      count: 0,
    };
  });

  parties.forEach((p) => {
    // Host counts
    const existing = hostCounts.get(p.organizerId) || {
      count: 0,
      lastActive: p.createdAt,
      breakdown: {},
    };
    existing.count += 1;
    existing.breakdown[p.activityType] = (existing.breakdown[p.activityType] || 0) + 1;
    if (p.createdAt > existing.lastActive) {
      existing.lastActive = p.createdAt;
    }
    hostCounts.set(p.organizerId, existing);

    // Day bucket
    const pDate = toISODate(p.createdAt);
    const bucket = dailyActivity.find((b) => b.date === pDate);
    if (bucket) {
      bucket.count += 1;
    }
  });

  // Busiest day: only set if at least 1 party was hosted
  let busiestDay: { day: string; date: string; count: number } | null = null;
  dailyActivity.forEach((b) => {
    if (b.count > 0 && (!busiestDay || b.count > busiestDay.count)) {
      busiestDay = { day: b.day, date: b.date, count: b.count };
    }
  });

  // Leaderboard
  const sortedHosts = Array.from(hostCounts.entries())
    .map(([userId, data]) => ({ userId, ...data }))
    .sort((a, b) => b.count - a.count || b.lastActive.getTime() - a.lastActive.getTime());

  const userProfiles = await resolveDiscordUsers(sortedHosts.map((h) => h.userId));

  const leaderboard: LeaderboardEntry[] = sortedHosts.map((h, index) => {
    const profile = userProfiles.get(h.userId);
    return {
      rank: index + 1,
      userId: h.userId,
      username: profile?.username || h.userId,
      displayName: profile?.displayName || h.userId,
      avatarUrl: profile?.avatarUrl || getDefaultAvatarUrl(h.userId),
      partyCount: h.count,
      lastActive: h.lastActive.toISOString(),
      activityBreakdown: h.breakdown,
    };
  });

  const topHost = leaderboard[0] || null;

  // Weekly Joined Leaderboard (Most Joined This Week)
  const weekRegistrations = await prisma.partyRegistration.findMany({
    where: {
      registeredAt: {
        gte: currentWeek.start,
        lte: currentWeek.end,
      },
    },
    include: {
      role: {
        select: {
          roleName: true,
        },
      },
    },
    orderBy: {
      registeredAt: 'desc',
    },
  });

  const memberCounts = new Map<string, { count: number; lastActive: Date; roleCounts: Record<string, number> }>();
  weekRegistrations.forEach((r) => {
    const existing = memberCounts.get(r.userId) || {
      count: 0,
      lastActive: r.registeredAt,
      roleCounts: {},
    };
    existing.count += 1;
    if (r.role?.roleName) {
      existing.roleCounts[r.role.roleName] = (existing.roleCounts[r.role.roleName] || 0) + 1;
    }
    if (r.registeredAt > existing.lastActive) {
      existing.lastActive = r.registeredAt;
    }
    memberCounts.set(r.userId, existing);
  });

  const sortedMembers = Array.from(memberCounts.entries())
    .map(([userId, data]) => ({ userId, ...data }))
    .sort((a, b) => b.count - a.count || b.lastActive.getTime() - a.lastActive.getTime());

  const memberProfiles = await resolveDiscordUsers(sortedMembers.map((m) => m.userId));

  const joinedLeaderboard: JoinedLeaderboardEntry[] = sortedMembers.map((m, index) => {
    const profile = memberProfiles.get(m.userId);
    let preferredRole = 'Participant';
    let maxRoleCount = 0;
    for (const [rName, rCount] of Object.entries(m.roleCounts)) {
      if (rCount > maxRoleCount) {
        maxRoleCount = rCount;
        preferredRole = rName;
      }
    }
    return {
      rank: index + 1,
      userId: m.userId,
      username: profile?.username || m.userId,
      displayName: profile?.displayName || m.userId,
      avatarUrl: profile?.avatarUrl || getDefaultAvatarUrl(m.userId),
      joinedCount: m.count,
      lastActive: m.lastActive.toISOString(),
      preferredRole,
      roleBreakdown: m.roleCounts,
    };
  });

  const topJoined = joinedLeaderboard[0] || null;

  // Format parties
  const formattedParties = parties.map((p) => {
    let totalSlots = 0;
    let registeredCount = 0;
    p.roles.forEach((r) => {
      totalSlots += r.capacity;
      registeredCount += r.registrations.length;
    });

    const host = userProfiles.get(p.organizerId);
    return {
      id: p.id,
      title: generatePartyTitle(p),
      rawTitle: p.title,
      organizerId: p.organizerId,
      host,
      activityType: p.activityType,
      ipRequirement: p.ipRequirement,
      durationMinutes: p.durationMinutes,
      status: p.status,
      registeredCount,
      totalSlots,
      createdAt: p.createdAt.toISOString(),
      formattedDate: formatFullDateTime(p.createdAt),
    };
  });

  return {
    period: currentWeek,
    previousPeriod: prevWeek,
    summary: {
      totalParties,
      uniqueHosts: hostCounts.size,
      topHost,
      topJoined,
      totalJoined: weekRegistrations.length,
      uniqueParticipants: memberCounts.size,
      busiestDay,
      prevWeekCount,
      diffPercentage,
    },
    dailyActivity,
    leaderboard,
    joinedLeaderboard,
    parties: formattedParties,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Computes monthly hosting report for a given month offset (0 = current month, -1 = last month).
 */
export async function getMonthlyReport(offset: number = 0) {
  const currentMonth = getMonthRange(offset);
  const prevMonth = getMonthRange(offset - 1);

  const parties = await prisma.party.findMany({
    where: {
      createdAt: {
        gte: currentMonth.start,
        lte: currentMonth.end,
      },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      roles: {
        include: {
          registrations: true,
        },
      },
    },
  });

  const prevMonthCount = await prisma.party.count({
    where: {
      createdAt: {
        gte: prevMonth.start,
        lte: prevMonth.end,
      },
    },
  });

  const totalParties = parties.length;
  // Never invent comparison percentages when previous period had 0 data
  const diffPercentage =
    prevMonthCount > 0
      ? Math.round(((totalParties - prevMonthCount) / prevMonthCount) * 100)
      : null;

  // Days in this month
  const totalDays = currentMonth.end.getUTCDate();
  const dailyActivity: Array<{ day: number; date: string; count: number }> = [];
  for (let i = 1; i <= totalDays; i++) {
    const dayDate = new Date(Date.UTC(currentMonth.year, currentMonth.month - 1, i));
    dailyActivity.push({
      day: i,
      date: toISODate(dayDate),
      count: 0,
    });
  }

  const hostCounts = new Map<string, { count: number; lastActive: Date; breakdown: Record<string, number> }>();
  const weekBuckets = new Map<number, number>();

  parties.forEach((p) => {
    // Host counts
    const existing = hostCounts.get(p.organizerId) || {
      count: 0,
      lastActive: p.createdAt,
      breakdown: {},
    };
    existing.count += 1;
    existing.breakdown[p.activityType] = (existing.breakdown[p.activityType] || 0) + 1;
    if (p.createdAt > existing.lastActive) {
      existing.lastActive = p.createdAt;
    }
    hostCounts.set(p.organizerId, existing);

    // Day activity
    const pDate = toISODate(p.createdAt);
    const dayItem = dailyActivity.find((d) => d.date === pDate);
    if (dayItem) {
      dayItem.count += 1;
    }

    // Week bucket (approx week 1, 2, 3, 4, 5)
    const weekIndex = Math.min(Math.floor((p.createdAt.getUTCDate() - 1) / 7) + 1, 5);
    weekBuckets.set(weekIndex, (weekBuckets.get(weekIndex) || 0) + 1);
  });

  // Busiest day & week: only set if at least 1 party was hosted
  let busiestDay: { day: number; date: string; count: number } | null = null;
  dailyActivity.forEach((d) => {
    if (d.count > 0 && (!busiestDay || d.count > busiestDay.count)) {
      busiestDay = { day: d.day, date: d.date, count: d.count };
    }
  });

  let busiestWeek: { weekLabel: string; count: number } | null = null;
  for (let w = 1; w <= 5; w++) {
    const count = weekBuckets.get(w) || 0;
    if (count > 0 && (!busiestWeek || count > busiestWeek.count)) {
      busiestWeek = { weekLabel: `Week ${w}`, count };
    }
  }

  // Leaderboard
  const sortedHosts = Array.from(hostCounts.entries())
    .map(([userId, data]) => ({ userId, ...data }))
    .sort((a, b) => b.count - a.count || b.lastActive.getTime() - a.lastActive.getTime());

  const userProfiles = await resolveDiscordUsers(sortedHosts.map((h) => h.userId));

  const leaderboard: LeaderboardEntry[] = sortedHosts.map((h, index) => {
    const profile = userProfiles.get(h.userId);
    return {
      rank: index + 1,
      userId: h.userId,
      username: profile?.username || h.userId,
      displayName: profile?.displayName || h.userId,
      avatarUrl: profile?.avatarUrl || getDefaultAvatarUrl(h.userId),
      partyCount: h.count,
      lastActive: h.lastActive.toISOString(),
      activityBreakdown: h.breakdown,
    };
  });

  const topHost = leaderboard[0] || null;

  // Monthly Joined Leaderboard (Most Joined This Month)
  const monthRegistrations = await prisma.partyRegistration.findMany({
    where: {
      registeredAt: {
        gte: currentMonth.start,
        lte: currentMonth.end,
      },
    },
    include: {
      role: {
        select: {
          roleName: true,
        },
      },
    },
    orderBy: {
      registeredAt: 'desc',
    },
  });

  const memberCounts = new Map<string, { count: number; lastActive: Date; roleCounts: Record<string, number> }>();
  monthRegistrations.forEach((r) => {
    const existing = memberCounts.get(r.userId) || {
      count: 0,
      lastActive: r.registeredAt,
      roleCounts: {},
    };
    existing.count += 1;
    if (r.role?.roleName) {
      existing.roleCounts[r.role.roleName] = (existing.roleCounts[r.role.roleName] || 0) + 1;
    }
    if (r.registeredAt > existing.lastActive) {
      existing.lastActive = r.registeredAt;
    }
    memberCounts.set(r.userId, existing);
  });

  const sortedMembers = Array.from(memberCounts.entries())
    .map(([userId, data]) => ({ userId, ...data }))
    .sort((a, b) => b.count - a.count || b.lastActive.getTime() - a.lastActive.getTime());

  const memberProfiles = await resolveDiscordUsers(sortedMembers.map((m) => m.userId));

  const joinedLeaderboard: JoinedLeaderboardEntry[] = sortedMembers.map((m, index) => {
    const profile = memberProfiles.get(m.userId);
    let preferredRole = 'Participant';
    let maxRoleCount = 0;
    for (const [rName, rCount] of Object.entries(m.roleCounts)) {
      if (rCount > maxRoleCount) {
        maxRoleCount = rCount;
        preferredRole = rName;
      }
    }
    return {
      rank: index + 1,
      userId: m.userId,
      username: profile?.username || m.userId,
      displayName: profile?.displayName || m.userId,
      avatarUrl: profile?.avatarUrl || getDefaultAvatarUrl(m.userId),
      joinedCount: m.count,
      lastActive: m.lastActive.toISOString(),
      preferredRole,
      roleBreakdown: m.roleCounts,
    };
  });

  const topJoined = joinedLeaderboard[0] || null;

  return {
    period: currentMonth,
    previousPeriod: prevMonth,
    summary: {
      totalParties,
      uniqueHosts: hostCounts.size,
      topHost,
      topJoined,
      totalJoined: monthRegistrations.length,
      uniqueParticipants: memberCounts.size,
      busiestDay,
      busiestWeek,
      prevMonthCount,
      diffPercentage,
    },
    dailyActivity,
    leaderboard,
    joinedLeaderboard,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Returns full leaderboard (hosts or joined members) with pagination, search, and period filtering.
 */
export async function getLeaderboard(
  period: 'week' | 'month' | 'all' = 'all',
  page: number = 1,
  limit: number = 20,
  search?: string,
  type: 'hosted' | 'joined' = 'hosted'
) {
  const range = period === 'week' ? getWeekRange(0) : period === 'month' ? getMonthRange(0) : getAllTimeRange();

  if (type === 'joined') {
    // Aggregate member registrations
    const regGroups = await prisma.partyRegistration.groupBy({
      by: ['userId'],
      where: {
        registeredAt: {
          gte: range.start,
          lte: range.end,
        },
      },
      _count: { id: true },
      _max: { registeredAt: true },
      orderBy: [
        { _count: { id: 'desc' } },
        { _max: { registeredAt: 'desc' } },
      ],
    });

    const allUserIds = regGroups.map((r) => r.userId);
    const userMap = await resolveDiscordUsers(allUserIds);

    let rankedList = regGroups.map((r, idx) => {
      const profile = userMap.get(r.userId);
      return {
        rank: idx + 1,
        userId: r.userId,
        username: profile?.username || r.userId,
        displayName: profile?.displayName || r.userId,
        avatarUrl: profile?.avatarUrl || getDefaultAvatarUrl(r.userId),
        joinedCount: r._count.id,
        partyCount: r._count.id, // compatibility
        lastActive: r._max.registeredAt ? r._max.registeredAt.toISOString() : null,
        activityBreakdown: {},
      };
    });

    if (search && search.trim()) {
      const s = search.trim().toLowerCase();
      rankedList = rankedList.filter(
        (m) =>
          m.username.toLowerCase().includes(s) ||
          m.displayName.toLowerCase().includes(s) ||
          m.userId.includes(s)
      );
    }

    const weekTop = (await getWeeklyReport(0)).summary.topJoined;
    const monthTop = (await getMonthlyReport(0)).summary.topJoined;

    const totalCount = rankedList.length;
    const totalPages = Math.ceil(totalCount / limit) || 1;
    const safePage = Math.max(1, Math.min(page, totalPages));
    const paginated = rankedList.slice((safePage - 1) * limit, safePage * limit);

    return {
      type: 'joined',
      period,
      dateRange: range,
      hosts: paginated, // compatibility for table renderers
      members: paginated,
      topOfWeek: weekTop,
      topOfMonth: monthTop,
      hostOfWeek: weekTop,
      hostOfMonth: monthTop,
      pagination: {
        page: safePage,
        limit,
        totalPages,
        totalHosts: totalCount,
        totalCount,
      },
      lastUpdated: new Date().toISOString(),
    };
  }

  // Aggregate host counts
  const hostGroups = await prisma.party.groupBy({
    by: ['organizerId'],
    where: {
      createdAt: {
        gte: range.start,
        lte: range.end,
      },
    },
    _count: { id: true },
    _max: { createdAt: true },
    orderBy: [
      { _count: { id: 'desc' } },
      { _max: { createdAt: 'desc' } },
    ],
  });

  // Resolve profiles for all relevant hosts
  const allHostIds = hostGroups.map((h) => h.organizerId);
  const userMap = await resolveDiscordUsers(allHostIds);

  let rankedList = hostGroups.map((h, idx) => {
    const profile = userMap.get(h.organizerId);
    return {
      rank: idx + 1,
      userId: h.organizerId,
      username: profile?.username || h.organizerId,
      displayName: profile?.displayName || h.organizerId,
      avatarUrl: profile?.avatarUrl || getDefaultAvatarUrl(h.organizerId),
      partyCount: h._count.id,
      joinedCount: 0,
      lastActive: h._max.createdAt ? h._max.createdAt.toISOString() : null,
      activityBreakdown: {},
    };
  });

  // Apply search filter if present
  if (search && search.trim()) {
    const s = search.trim().toLowerCase();
    rankedList = rankedList.filter(
      (h) =>
        h.username.toLowerCase().includes(s) ||
        h.displayName.toLowerCase().includes(s) ||
        h.userId.includes(s)
    );
  }

  // Highlights: Host of the Week and Host of the Month
  const weekTop = (await getWeeklyReport(0)).summary.topHost;
  const monthTop = (await getMonthlyReport(0)).summary.topHost;

  const totalHosts = rankedList.length;
  const totalPages = Math.ceil(totalHosts / limit) || 1;
  const safePage = Math.max(1, Math.min(page, totalPages));
  const paginated = rankedList.slice((safePage - 1) * limit, safePage * limit);

  return {
    type: 'hosted',
    period,
    dateRange: range,
    hosts: paginated,
    members: paginated,
    hostOfWeek: weekTop,
    hostOfMonth: monthTop,
    pagination: {
      page: safePage,
      limit,
      totalPages,
      totalHosts,
      totalCount: totalHosts,
    },
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Returns detailed profile for an individual host/member.
 */
export async function getHostProfile(userId: string) {
  const profile = await resolveDiscordUser(userId);
  const weekRange = getWeekRange(0);
  const monthRange = getMonthRange(0);

  // Stats queries in parallel: both hosted and joined
  const [
    allTimeCount,
    thisWeekCount,
    thisMonthCount,
    parties,
    allTimeJoined,
    thisWeekJoined,
    thisMonthJoined,
    joinedRegistrations,
  ] = await Promise.all([
    prisma.party.count({ where: { organizerId: userId } }),
    prisma.party.count({
      where: {
        organizerId: userId,
        createdAt: { gte: weekRange.start, lte: weekRange.end },
      },
    }),
    prisma.party.count({
      where: {
        organizerId: userId,
        createdAt: { gte: monthRange.start, lte: monthRange.end },
      },
    }),
    prisma.party.findMany({
      where: { organizerId: userId },
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: {
        roles: {
          include: {
            registrations: true,
          },
        },
      },
    }),
    prisma.partyRegistration.count({ where: { userId } }),
    prisma.partyRegistration.count({
      where: {
        userId,
        registeredAt: { gte: weekRange.start, lte: weekRange.end },
      },
    }),
    prisma.partyRegistration.count({
      where: {
        userId,
        registeredAt: { gte: monthRange.start, lte: monthRange.end },
      },
    }),
    prisma.partyRegistration.findMany({
      where: { userId },
      orderBy: { registeredAt: 'desc' },
      take: 25,
      include: {
        party: true,
        role: true,
      },
    }),
  ]);

  // Activity breakdown & dates
  const activityBreakdown: Record<string, number> = {};
  parties.forEach((p) => {
    activityBreakdown[p.activityType] = (activityBreakdown[p.activityType] || 0) + 1;
  });

  const firstParty = await prisma.party.findFirst({
    where: { organizerId: userId },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });

  const recentParties = parties.map((p) => {
    let totalSlots = 0;
    let registeredCount = 0;
    p.roles.forEach((r) => {
      totalSlots += r.capacity;
      registeredCount += r.registrations.length;
    });

    return {
      id: p.id,
      title: generatePartyTitle(p),
      rawTitle: p.title,
      activityType: p.activityType,
      ipRequirement: p.ipRequirement,
      durationMinutes: p.durationMinutes,
      status: p.status,
      registeredCount,
      totalSlots,
      createdAt: p.createdAt.toISOString(),
      formattedDate: formatFullDateTime(p.createdAt),
    };
  });

  const recentJoined = joinedRegistrations.map((reg) => ({
    partyId: reg.partyId,
    partyTitle: generatePartyTitle(reg.party),
    activityType: reg.party.activityType,
    roleName: reg.role?.roleName || 'Member',
    roleNumber: reg.role?.roleNumber || 1,
    registeredAt: reg.registeredAt.toISOString(),
    formattedDate: formatFullDateTime(reg.registeredAt),
    status: reg.party.status,
  }));

  return {
    host: profile,
    stats: {
      allTimeParties: allTimeCount,
      currentWeekParties: thisWeekCount,
      currentMonthParties: thisMonthCount,
      allTimeJoined,
      currentWeekJoined: thisWeekJoined,
      currentMonthJoined: thisMonthJoined,
      firstPartyDate: firstParty?.createdAt ? firstParty.createdAt.toISOString() : null,
      lastPartyDate: parties[0]?.createdAt ? parties[0].createdAt.toISOString() : null,
      activityBreakdown,
    },
    recentParties,
    recentJoined,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Returns searchable and paginated party history with filters.
 */
export async function getPartyHistory(options: {
  search?: string;
  host?: string;
  activity?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}) {
  const page = Math.max(1, options.page || 1);
  const limit = Math.min(100, Math.max(1, options.limit || 20));

  const where: any = {};

  if (options.activity && options.activity !== 'ALL') {
    where.activityType = options.activity;
  }

  if (options.status && options.status !== 'ALL') {
    where.status = options.status;
  }

  if (options.host && options.host.trim()) {
    where.organizerId = options.host.trim();
  }

  if (options.startDate || options.endDate) {
    where.createdAt = {};
    if (options.startDate) {
      where.createdAt.gte = new Date(options.startDate);
    }
    if (options.endDate) {
      const end = new Date(options.endDate);
      end.setUTCHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }

  if (options.search && options.search.trim()) {
    const s = options.search.trim();
    where.OR = [
      { title: { contains: s, mode: 'insensitive' } },
      { organizerId: { contains: s } },
    ];
  }

  const [totalCount, rawParties] = await Promise.all([
    prisma.party.count({ where }),
    prisma.party.findMany({
      where,
      orderBy: { createdAt: options.sortOrder || 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        roles: {
          include: {
            registrations: true,
          },
        },
      },
    }),
  ]);

  const hostIds = rawParties.map((p) => p.organizerId);
  const userMap = await resolveDiscordUsers(hostIds);

  const parties = rawParties.map((p) => {
    let totalSlots = 0;
    let registeredCount = 0;
    p.roles.forEach((r) => {
      totalSlots += r.capacity;
      registeredCount += r.registrations.length;
    });

    const host = userMap.get(p.organizerId);
    return {
      id: p.id,
      title: generatePartyTitle(p),
      rawTitle: p.title,
      organizerId: p.organizerId,
      host,
      activityType: p.activityType,
      ipRequirement: p.ipRequirement,
      durationMinutes: p.durationMinutes,
      status: p.status,
      registeredCount,
      totalSlots,
      createdAt: p.createdAt.toISOString(),
      formattedDate: formatFullDateTime(p.createdAt),
    };
  });

  const totalPages = Math.ceil(totalCount / limit) || 1;

  return {
    parties,
    pagination: {
      page,
      limit,
      totalPages,
      totalCount,
    },
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Exports parties data as CSV.
 */
export async function exportPartiesCSV(where: any = {}): Promise<string> {
  const parties = await prisma.party.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      roles: {
        include: {
          registrations: true,
        },
      },
    },
  });

  const hostIds = parties.map((p) => p.organizerId);
  const userMap = await resolveDiscordUsers(hostIds);

  const rows = [
    [
      'Party ID',
      'Party Title',
      'Host ID',
      'Host Name',
      'Activity',
      'IP Requirement',
      'Duration (mins)',
      'Status',
      'Registered',
      'Capacity',
      'Created At',
    ].join(','),
  ];

  for (const p of parties) {
    let totalSlots = 0;
    let registeredCount = 0;
    p.roles.forEach((r) => {
      totalSlots += r.capacity;
      registeredCount += r.registrations.length;
    });

    const host = userMap.get(p.organizerId);
    const title = generatePartyTitle(p).replace(/"/g, '""');
    const hostName = (host?.displayName || host?.username || p.organizerId).replace(/"/g, '""');

    rows.push(
      [
        `"${p.id}"`,
        `"${title}"`,
        `"${p.organizerId}"`,
        `"${hostName}"`,
        `"${p.activityType}"`,
        p.ipRequirement,
        p.durationMinutes,
        `"${p.status}"`,
        registeredCount,
        totalSlots,
        `"${p.createdAt.toISOString()}"`,
      ].join(',')
    );
  }

  return rows.join('\n');
}

/**
 * Exports leaderboard data as CSV.
 */
export async function exportLeaderboardCSV(
  period: 'week' | 'month' | 'all' = 'all',
  type: 'hosted' | 'joined' = 'hosted'
): Promise<string> {
  const data = await getLeaderboard(period, 1, 1000, undefined, type);

  if (type === 'joined') {
    const rows = [['Rank', 'Member ID', 'Member Username', 'Display Name', 'Parties Joined', 'Period'].join(',')];
    const list = data.members || data.hosts;
    for (const m of list) {
      const username = m.username.replace(/"/g, '""');
      const displayName = m.displayName.replace(/"/g, '""');
      const count = (m as any).joinedCount ?? m.partyCount;
      rows.push([m.rank, `"${m.userId}"`, `"${username}"`, `"${displayName}"`, count, `"${period}"`].join(','));
    }
    return rows.join('\n');
  }

  const rows = [['Rank', 'Host ID', 'Host Username', 'Display Name', 'Parties Hosted', 'Period'].join(',')];

  for (const h of data.hosts) {
    const username = h.username.replace(/"/g, '""');
    const displayName = h.displayName.replace(/"/g, '""');
    rows.push([h.rank, `"${h.userId}"`, `"${username}"`, `"${displayName}"`, h.partyCount, `"${period}"`].join(','));
  }

  return rows.join('\n');
}

function getDefaultAvatarUrl(userId: string): string {
  try {
    const idBig = BigInt(userId || '0');
    return `https://cdn.discordapp.com/embed/avatars/${Number(idBig % 5n)}.png`;
  } catch {
    return 'https://cdn.discordapp.com/embed/avatars/0.png';
  }
}

