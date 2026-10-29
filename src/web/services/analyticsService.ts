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
import { resolveDiscordUser, resolveDiscordUsers, DiscordUserProfile } from './discordUserService';
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

export interface OverviewMetrics {
  period: string;
  dateRange: { start: string; end: string; label: string };
  totalPartiesHosted: number;
  activeParties: number;
  totalUniqueHosts: number;
  topHost: LeaderboardEntry | null;
  activityOverTime: Array<{ date: string; label: string; count: number }>;
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
    activityOverTime: timeBuckets,
    topHosts,
    recentParties,
    lastUpdated: new Date().toISOString(),
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
      busiestDay,
      prevWeekCount,
      diffPercentage,
    },
    dailyActivity,
    leaderboard,
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

  return {
    period: currentMonth,
    previousPeriod: prevMonth,
    summary: {
      totalParties,
      uniqueHosts: hostCounts.size,
      topHost,
      busiestDay,
      busiestWeek,
      prevMonthCount,
      diffPercentage,
    },
    dailyActivity,
    leaderboard,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Returns full host leaderboard with pagination, search, and period filtering.
 */
export async function getLeaderboard(
  period: 'week' | 'month' | 'all' = 'all',
  page: number = 1,
  limit: number = 20,
  search?: string
) {
  const range = period === 'week' ? getWeekRange(0) : period === 'month' ? getMonthRange(0) : getAllTimeRange();

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
    period,
    dateRange: range,
    hosts: paginated,
    hostOfWeek: weekTop,
    hostOfMonth: monthTop,
    pagination: {
      page: safePage,
      limit,
      totalPages,
      totalHosts,
    },
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Returns detailed profile for an individual host.
 */
export async function getHostProfile(userId: string) {
  const profile = await resolveDiscordUser(userId);
  const weekRange = getWeekRange(0);
  const monthRange = getMonthRange(0);

  // Stats queries in parallel
  const [allTimeCount, thisWeekCount, thisMonthCount, parties] = await Promise.all([
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

  return {
    host: profile,
    stats: {
      allTimeParties: allTimeCount,
      currentWeekParties: thisWeekCount,
      currentMonthParties: thisMonthCount,
      firstPartyDate: firstParty?.createdAt ? firstParty.createdAt.toISOString() : null,
      lastPartyDate: parties[0]?.createdAt ? parties[0].createdAt.toISOString() : null,
      activityBreakdown,
    },
    recentParties,
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
export async function exportLeaderboardCSV(period: 'week' | 'month' | 'all' = 'all'): Promise<string> {
  const data = await getLeaderboard(period, 1, 1000);
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

