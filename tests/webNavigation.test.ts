import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { AddressInfo } from 'net';
import { createWebApp } from '../src/web/server';

describe('Web Navigation & Tab Content Tests', () => {
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

  describe('1. HTML Navigation Structure & Sections', () => {
    it('contains all required navigation links with data-view and href attributes', () => {
      const html = fs.readFileSync(path.resolve(process.cwd(), 'public/index.html'), 'utf-8');

      // Brand link
      expect(html).toContain('class="brand" data-view="overview"');

      // 5 Main Navigation Items
      expect(html).toContain('data-view="overview"');
      expect(html).toContain('data-view="weekly"');
      expect(html).toContain('data-view="monthly"');
      expect(html).toContain('data-view="leaderboard"');
      expect(html).toContain('data-view="history"');

      // 5 Main View Sections
      expect(html).toContain('id="view-overview"');
      expect(html).toContain('id="view-weekly"');
      expect(html).toContain('id="view-monthly"');
      expect(html).toContain('id="view-leaderboard"');
      expect(html).toContain('id="view-history"');

      // Host Profile Modal Elements
      expect(html).toContain('id="hostModalOverlay"');
      expect(html).toContain('id="hostModalBody"');
      expect(html).toContain('id="modalCloseBtn"');
    });

    it('contains all internal cross-tab deep links', () => {
      const html = fs.readFileSync(path.resolve(process.cwd(), 'public/index.html'), 'utf-8');
      expect(html).toContain('href="#leaderboard"');
      expect(html).toContain('href="#history"');
    });
  });

  describe('2. Client Router Logic Simulation', () => {
    // Pure function replicating parseCurrentRoute logic from app.js
    function parseRoute(hash: string, pathname: string) {
      let raw = hash || '';
      if (raw.startsWith('#')) raw = raw.slice(1);
      if (raw.startsWith('/')) raw = raw.slice(1);

      if (raw.startsWith('host/')) {
        const parts = raw.split('/');
        return { type: 'host', userId: parts[1] || '' };
      }

      if (raw.includes('?')) raw = raw.split('?')[0];

      if (!raw) {
        let path = pathname || '';
        if (path.startsWith('/')) path = path.slice(1);
        const first = path.split('/')[0];
        if (['overview', 'weekly', 'monthly', 'leaderboard', 'history'].includes(first)) {
          raw = first;
        }
      }

      const validViews = ['overview', 'weekly', 'monthly', 'leaderboard', 'history'];
      const view = validViews.includes(raw) ? raw : 'overview';
      return { type: 'view', view };
    }

    it('resolves standard hash routes (#overview, #weekly, etc.)', () => {
      expect(parseRoute('#overview', '/')).toEqual({ type: 'view', view: 'overview' });
      expect(parseRoute('#weekly', '/')).toEqual({ type: 'view', view: 'weekly' });
      expect(parseRoute('#monthly', '/')).toEqual({ type: 'view', view: 'monthly' });
      expect(parseRoute('#leaderboard', '/')).toEqual({ type: 'view', view: 'leaderboard' });
      expect(parseRoute('#history', '/')).toEqual({ type: 'view', view: 'history' });
    });

    it('resolves slash-prefixed hash routes (#/weekly, #/monthly, etc.)', () => {
      expect(parseRoute('#/weekly', '/')).toEqual({ type: 'view', view: 'weekly' });
      expect(parseRoute('#/leaderboard', '/')).toEqual({ type: 'view', view: 'leaderboard' });
      expect(parseRoute('#/history', '/')).toEqual({ type: 'view', view: 'history' });
    });

    it('resolves clean pathname routes without hashes (/weekly, /monthly, etc.)', () => {
      expect(parseRoute('', '/weekly')).toEqual({ type: 'view', view: 'weekly' });
      expect(parseRoute('', '/monthly')).toEqual({ type: 'view', view: 'monthly' });
      expect(parseRoute('', '/leaderboard')).toEqual({ type: 'view', view: 'leaderboard' });
      expect(parseRoute('', '/history')).toEqual({ type: 'view', view: 'history' });
    });

    it('resolves host profile routes (#host/123, #/host/456)', () => {
      expect(parseRoute('#host/user-999', '/')).toEqual({ type: 'host', userId: 'user-999' });
      expect(parseRoute('#/host/user-888', '/')).toEqual({ type: 'host', userId: 'user-888' });
    });

    it('safely handles query strings and invalid routes, falling back to overview', () => {
      expect(parseRoute('#weekly?offset=-1', '/')).toEqual({ type: 'view', view: 'weekly' });
      expect(parseRoute('#unknownRoute', '/')).toEqual({ type: 'view', view: 'overview' });
      expect(parseRoute('', '/')).toEqual({ type: 'view', view: 'overview' });
    });
  });

  describe('3. SPA Server Route Handling', () => {
    it('serves index.html for root path /', async () => {
      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const text = await res.text();
      expect(text).toContain('TRACKING PARTY');
      expect(text).toContain('id="view-overview"');
    });

    it('serves index.html for SPA subpaths (/weekly, /leaderboard, /history)', async () => {
      const resWeekly = await fetch(`${baseUrl}/weekly`);
      expect(resWeekly.status).toBe(200);
      const textWeekly = await resWeekly.text();
      expect(textWeekly).toContain('id="view-weekly"');

      const resLeaderboard = await fetch(`${baseUrl}/leaderboard`);
      expect(resLeaderboard.status).toBe(200);
      const textLeaderboard = await resLeaderboard.text();
      expect(textLeaderboard).toContain('id="view-leaderboard"');

      const resHistory = await fetch(`${baseUrl}/history`);
      expect(resHistory.status).toBe(200);
      const textHistory = await resHistory.text();
      expect(textHistory).toContain('id="view-history"');
    });

    it('serves static assets (app.js, styles.css) directly', async () => {
      const resJs = await fetch(`${baseUrl}/app.js`);
      expect(resJs.status).toBe(200);
      expect(resJs.headers.get('content-type')).toContain('javascript');

      const resCss = await fetch(`${baseUrl}/styles.css`);
      expect(resCss.status).toBe(200);
      expect(resCss.headers.get('content-type')).toContain('css');
    });
  });
});

