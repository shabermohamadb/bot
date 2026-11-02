import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import { prisma } from '../src/database/client';
import { getWeekRange, getMonthRange, toISODate } from '../src/web/utils/dateUtils';
import { getWeeklyReport, getMonthlyReport } from '../src/web/services/analyticsService';
import { createWebApp } from '../src/web/server';

describe('Weekly & Monthly Reports Comprehensive Verification', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createWebApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await prisma.$disconnect();
  });

  describe('1. Date Calculations & Calendar Math', () => {
    it('accurately computes Monday-Sunday boundaries across arbitrary offsets', () => {
      const ref = new Date('2026-11-02T12:00:00Z'); // Monday Nov 2
      const curr = getWeekRange(0, ref);
      expect(curr.start.getUTCDay()).toBe(1); // Monday
      expect(curr.end.getUTCDay()).toBe(0); // Sunday
      expect(toISODate(curr.start)).toBe('2026-11-02');
      expect(toISODate(curr.end)).toBe('2026-11-08');
      expect(curr.label).toBe('Nov 2 — 8, 2026');

      const prev = getWeekRange(-1, ref);
      expect(toISODate(prev.start)).toBe('2026-10-26');
      expect(toISODate(prev.end)).toBe('2026-11-01');
      expect(prev.label).toBe('Oct 26 — Nov 1, 2026');
    });

    it('handles year transitions in week labels cleanly', () => {
      const ref = new Date('2026-12-30T12:00:00Z'); // Wednesday Dec 30, 2026
      const week = getWeekRange(0, ref);
      expect(toISODate(week.start)).toBe('2026-12-28');
      expect(toISODate(week.end)).toBe('2027-01-03');
      expect(week.label).toBe('Dec 28, 2026 — Jan 3, 2027');
    });

    it('correctly handles variable month lengths and leap years', () => {
      // Leap year 2028 February (29 days)
      const feb2028 = getMonthRange(0, new Date('2028-02-10T12:00:00Z'));
      expect(feb2028.monthName).toBe('February');
      expect(feb2028.year).toBe(2028);
      expect(toISODate(feb2028.start)).toBe('2028-02-01');
      expect(toISODate(feb2028.end)).toBe('2028-02-29');

      // Non-leap year 2027 February (28 days)
      const feb2027 = getMonthRange(0, new Date('2027-02-10T12:00:00Z'));
      expect(toISODate(feb2027.end)).toBe('2027-02-28');

      // 30-day month (April)
      const apr2026 = getMonthRange(0, new Date('2026-04-15T12:00:00Z'));
      expect(toISODate(apr2026.end)).toBe('2026-04-30');

      // 31-day month (October)
      const oct2026 = getMonthRange(0, new Date('2026-10-15T12:00:00Z'));
      expect(toISODate(oct2026.end)).toBe('2026-10-31');
    });
  });

  describe('2. Weekly Report API & Data Accuracy', () => {
    it('GET /api/reports/weekly returns valid 200 with complete schema expected by frontend', async () => {
      const res = await fetch(`${baseUrl}/api/reports/weekly?offset=0`);
      expect(res.status).toBe(200);
      const data = await res.json();

      // Verify contract fields expected by app.js
      expect(data.weekRange).toBeDefined();
      expect(typeof data.weekRange.label).toBe('string');
      expect(data.period).toBeDefined();

      expect(data.summary).toBeDefined();
      expect(typeof data.summary.totalParties).toBe('number');
      expect(typeof data.summary.uniqueHosts).toBe('number');
      expect(typeof data.summary.busiestDay).toBe('string');
      expect(typeof data.summary.busiestDayCount).toBe('number');

      // Daily breakdown
      expect(Array.isArray(data.dailyBreakdown)).toBe(true);
      expect(data.dailyBreakdown.length).toBe(7);
      expect(data.dailyBreakdown[0]).toHaveProperty('dayName');
      expect(data.dailyBreakdown[0]).toHaveProperty('count');

      // Leaderboard
      expect(Array.isArray(data.leaderboard)).toBe(true);
      expect(Array.isArray(data.joinedLeaderboard)).toBe(true);

      // Verify top host and joined have valid avatar URLs when present
      if (data.summary.topHost) {
        expect(typeof data.summary.topHost.avatarUrl).toBe('string');
        expect(typeof data.summary.topHost.displayName).toBe('string');
      }
      if (data.summary.topJoined) {
        expect(typeof data.summary.topJoined.avatarUrl).toBe('string');
        expect(typeof data.summary.topJoined.displayName).toBe('string');
      }
    });

    it('GET /api/reports/weekly?offset=-1 navigates to previous week accurately', async () => {
      const res = await fetch(`${baseUrl}/api/reports/weekly?offset=-1`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.weekRange.offset).toBe(-1);
      expect(typeof data.weekRange.label).toBe('string');
      expect(typeof data.summary.totalParties).toBe('number');
    });

    it('Weekly report total matches actual Neon PostgreSQL count query', async () => {
      const weekRange = getWeekRange(0);
      const dbCount = await prisma.party.count({
        where: {
          createdAt: {
            gte: weekRange.start,
            lte: weekRange.end,
          },
        },
      });

      const report = await getWeeklyReport(0);
      expect(report.summary.totalParties).toBe(dbCount);
    });
  });

  describe('3. Monthly Report API & Data Accuracy', () => {
    it('GET /api/reports/monthly returns valid 200 with complete schema expected by frontend', async () => {
      const res = await fetch(`${baseUrl}/api/reports/monthly?offset=0`);
      expect(res.status).toBe(200);
      const data = await res.json();

      // Verify contract fields expected by app.js
      expect(data.monthRange).toBeDefined();
      expect(typeof data.monthRange.label).toBe('string');
      expect(data.period).toBeDefined();

      expect(data.summary).toBeDefined();
      expect(typeof data.summary.totalParties).toBe('number');
      expect(typeof data.summary.uniqueHosts).toBe('number');
      expect(typeof data.summary.busiestDay).toBe('string');
      expect(typeof data.summary.busiestDayCount).toBe('number');

      // Daily breakdown contains days of the month with dayNumber
      expect(Array.isArray(data.dailyBreakdown)).toBe(true);
      expect(data.dailyBreakdown.length).toBeGreaterThanOrEqual(28);
      expect(data.dailyBreakdown[0]).toHaveProperty('dayNumber');
      expect(data.dailyBreakdown[0]).toHaveProperty('count');

      // Leaderboards
      expect(Array.isArray(data.leaderboard)).toBe(true);
      expect(Array.isArray(data.joinedLeaderboard)).toBe(true);
    });

    it('GET /api/reports/monthly?offset=-1 navigates to previous month accurately', async () => {
      const res = await fetch(`${baseUrl}/api/reports/monthly?offset=-1`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.monthRange.offset).toBe(-1);
      expect(data.dailyBreakdown.length).toBe(31); // October has 31 days
    });

    it('Monthly report total matches actual Neon PostgreSQL count query', async () => {
      const monthRange = getMonthRange(0);
      const dbCount = await prisma.party.count({
        where: {
          createdAt: {
            gte: monthRange.start,
            lte: monthRange.end,
          },
        },
      });

      const report = await getMonthlyReport(0);
      expect(report.summary.totalParties).toBe(dbCount);
    });
  });
});
