import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import { createWebApp } from '../src/web/server';
import { getWeeklyReport, getLeaderboard, getHostProfile, exportLeaderboardCSV } from '../src/web/services/analyticsService';

describe('Joined Leaderboard & Weekly Member Participation Tests', () => {
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
  });

  describe('1. Analytics Service - Weekly Report Joined Leaderboard', () => {
    it('returns joinedLeaderboard and summary participant metrics', async () => {
      const data = await getWeeklyReport(0);

      expect(data).toBeDefined();
      expect(Array.isArray(data.joinedLeaderboard)).toBe(true);
      expect(Array.isArray(data.leaderboard)).toBe(true);
      expect(typeof data.summary.totalJoined).toBe('number');
      expect(typeof data.summary.uniqueParticipants).toBe('number');

      if (data.joinedLeaderboard.length > 0) {
        const top = data.joinedLeaderboard[0];
        expect(top.rank).toBe(1);
        expect(top.userId).toBeDefined();
        expect(typeof top.joinedCount).toBe('number');
        expect(top.joinedCount).toBeGreaterThan(0);
        expect(top.displayName).toBeDefined();
        expect(top.avatarUrl).toBeDefined();
        expect(data.summary.topJoined).toBeDefined();
        expect(data.summary.topJoined?.userId).toBe(top.userId);
      }
    });

    it('ranks members in descending order of parties joined', async () => {
      const data = await getWeeklyReport(0);
      for (let i = 0; i < data.joinedLeaderboard.length - 1; i++) {
        expect(data.joinedLeaderboard[i].joinedCount).toBeGreaterThanOrEqual(
          data.joinedLeaderboard[i + 1].joinedCount
        );
      }
    });
  });

  describe('2. Analytics Service - Joined Leaderboard API', () => {
    it('returns joined leaderboard with type="joined"', async () => {
      const data = await getLeaderboard('week', 1, 20, undefined, 'joined');
      expect(data.type).toBe('joined');
      expect(data.period).toBe('week');
      expect(Array.isArray(data.members)).toBe(true);
      expect(data.pagination).toBeDefined();
      expect(data.pagination.page).toBe(1);

      if (data.members.length > 0) {
        const first = data.members[0];
        expect(first.rank).toBe(1);
        expect(first.joinedCount).toBeGreaterThan(0);
        expect(first.userId).toBeDefined();
      }
    });

    it('supports searching joined members by username or ID', async () => {
      const allJoined = await getLeaderboard('all', 1, 20, undefined, 'joined');
      if (allJoined.members.length > 0) {
        const target = allJoined.members[0];
        const searchRes = await getLeaderboard('all', 1, 20, target.userId, 'joined');
        expect(searchRes.members.length).toBeGreaterThan(0);
        expect(searchRes.members.some((m: any) => m.userId === target.userId)).toBe(true);
      }
    });
  });

  describe('3. Web API Endpoints for Joined Leaderboard', () => {
    it('GET /api/leaderboard?type=joined&period=week returns 200 and members list', async () => {
      const res = await fetch(`${baseUrl}/api/leaderboard?type=joined&period=week`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.type).toBe('joined');
      expect(data.period).toBe('week');
      expect(Array.isArray(data.members)).toBe(true);
      expect(Array.isArray(data.hosts)).toBe(true);
    });

    it('GET /api/leaderboard rejects invalid type parameters', async () => {
      const res = await fetch(`${baseUrl}/api/leaderboard?type=invalid_type`);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid type');
    });

    it('GET /api/export/leaderboard.csv?type=joined&period=week exports member CSV', async () => {
      const res = await fetch(`${baseUrl}/api/export/leaderboard.csv?type=joined&period=week`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      expect(res.headers.get('content-disposition')).toContain('joined_leaderboard_week.csv');
      const text = await res.text();
      expect(text).toContain('Rank,Member ID,Member Username,Display Name,Parties Joined,Period');
    });

    it('GET /api/hosts/:userId returns joined stats and recentJoined array', async () => {
      const allJoined = await getLeaderboard('all', 1, 20, undefined, 'joined');
      if (allJoined.members.length > 0) {
        const targetUserId = allJoined.members[0].userId;
        const res = await fetch(`${baseUrl}/api/hosts/${targetUserId}`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.host).toBeDefined();
        expect(data.stats).toBeDefined();
        expect(typeof data.stats.allTimeJoined).toBe('number');
        expect(typeof data.stats.currentWeekJoined).toBe('number');
        expect(Array.isArray(data.recentJoined)).toBe(true);
      }
    });
  });
});
