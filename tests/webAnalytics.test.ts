import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import {
  getWeekRange,
  getMonthRange,
  getAllTimeRange,
  getISOWeekNumber,
  toISODate,
} from '../src/web/utils/dateUtils';
import {
  getDefaultAvatarUrl,
  resolveDiscordUser,
} from '../src/web/services/discordUserService';
import { createWebApp } from '../src/web/server';

describe('Tracking Party Web Analytics & Reporting Tests', () => {
  describe('1. Date Boundaries & Timezone Calculations', () => {
    it('defines week as Monday 00:00:00 through Sunday 23:59:59.999 UTC', () => {
      // Wednesday, Oct 29, 2026
      const refDate = new Date('2026-10-29T12:00:00Z');
      const week = getWeekRange(0, refDate);

      expect(week.start.getUTCDay()).toBe(1); // Monday
      expect(week.start.getUTCHours()).toBe(0);
      expect(week.start.getUTCMinutes()).toBe(0);
      expect(week.start.getUTCSeconds()).toBe(0);

      expect(week.end.getUTCDay()).toBe(0); // Sunday
      expect(week.end.getUTCHours()).toBe(23);
      expect(week.end.getUTCMinutes()).toBe(59);
      expect(week.end.getUTCSeconds()).toBe(59);

      // Verify date span (Monday Oct 26 to Sunday Nov 1)
      expect(toISODate(week.start)).toBe('2026-10-26');
      expect(toISODate(week.end)).toBe('2026-11-01');
      expect(week.label).toBe('Oct 26 — Nov 1, 2026');
    });

    it('navigates previous and next weeks correctly with offsets', () => {
      const refDate = new Date('2026-10-29T12:00:00Z');
      const prevWeek = getWeekRange(-1, refDate);
      expect(toISODate(prevWeek.start)).toBe('2026-10-19');
      expect(toISODate(prevWeek.end)).toBe('2026-10-25');
      expect(prevWeek.offset).toBe(-1);

      const nextWeek = getWeekRange(1, refDate);
      expect(toISODate(nextWeek.start)).toBe('2026-11-02');
      expect(toISODate(nextWeek.end)).toBe('2026-11-08');
      expect(nextWeek.offset).toBe(1);
    });

    it('calculates calendar month boundaries (1st through last day) and handles month rollovers', () => {
      const refDate = new Date('2026-10-29T12:00:00Z');
      const oct = getMonthRange(0, refDate);
      expect(toISODate(oct.start)).toBe('2026-10-01');
      expect(toISODate(oct.end)).toBe('2026-10-31');
      expect(oct.month).toBe(10);
      expect(oct.monthName).toBe('October');
      expect(oct.label).toBe('October 2026');

      // Previous month (September: 30 days)
      const sep = getMonthRange(-1, refDate);
      expect(toISODate(sep.start)).toBe('2026-09-01');
      expect(toISODate(sep.end)).toBe('2026-09-30');
      expect(sep.monthName).toBe('September');

      // Year rollover: January reference minus 1 -> December previous year
      const janDate = new Date('2026-01-15T12:00:00Z');
      const prevYearDec = getMonthRange(-1, janDate);
      expect(prevYearDec.year).toBe(2025);
      expect(prevYearDec.month).toBe(12);
      expect(prevYearDec.monthName).toBe('December');
      expect(toISODate(prevYearDec.end)).toBe('2025-12-31');
    });

    it('correctly calculates ISO week numbers', () => {
      const d1 = new Date('2026-01-01T00:00:00Z');
      expect(typeof getISOWeekNumber(d1)).toBe('number');
      const d2 = new Date('2026-10-29T00:00:00Z');
      expect(getISOWeekNumber(d2)).toBe(44);
    });
  });

  describe('2. Discord User & Avatar Resolution', () => {
    it('generates consistent, clean default avatars using Discord modulo rules', () => {
      const avatar0 = getDefaultAvatarUrl('1520361178226757770');
      const avatar1 = getDefaultAvatarUrl('1520361178226757771');
      expect(avatar0).toMatch(/^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-4]\.png$/);
      expect(avatar1).toMatch(/^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-4]\.png$/);
    });

    it('returns graceful fallback profile with genuine user ID when user cannot be fetched from Discord', async () => {
      const profile = await resolveDiscordUser('998877665544332211');
      expect(profile.userId).toBe('998877665544332211');
      expect(profile.username).toBe('998877665544332211');
      expect(profile.displayName).toBe('998877665544332211');
      expect(profile.avatarUrl).toContain('cdn.discordapp.com/embed/avatars');
    });

    it('handles missing or empty user ID safely', async () => {
      const profile = await resolveDiscordUser('');
      expect(profile.username).toBe('Unknown Host');
    });
  });

  describe('3. Web API Endpoints & Health Check', () => {
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

    it('GET /health returns 200 OK and service status', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data.service).toBe('discord-raid-master');
      expect(data.timestamp).toBeDefined();
    });

    it('GET /api/analytics/overview validates period parameter', async () => {
      const badRes = await fetch(`${baseUrl}/api/analytics/overview?period=invalid`);
      expect(badRes.status).toBe(400);
      const data = await badRes.json();
      expect(data.error).toContain('Invalid period');
    });

    it('GET /api/leaderboard rejects invalid periods', async () => {
      const badRes = await fetch(`${baseUrl}/api/leaderboard?period=century`);
      expect(badRes.status).toBe(400);
    });

    it('GET /api/hosts/:userId rejects empty IDs', async () => {
      const res = await fetch(`${baseUrl}/api/hosts/%20`);
      expect(res.status).toBe(400);
    });

    it('GET /api/export/parties.csv sets proper CSV headers', async () => {
      const res = await fetch(`${baseUrl}/api/export/parties.csv`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      expect(res.headers.get('content-disposition')).toContain('attachment');
      const text = await res.text();
      expect(text).toContain('Party ID,Party Title,Host ID');
    });

    it('GET /api/export/leaderboard.csv sets proper CSV headers', async () => {
      const res = await fetch(`${baseUrl}/api/export/leaderboard.csv?period=all`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      const text = await res.text();
      expect(text).toContain('Rank,Host ID,Host Username,Display Name,Parties Hosted,Period');
    });
  });
});
