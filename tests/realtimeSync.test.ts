import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import {
  dashboardEventBus,
  publishDashboardEvent,
} from '../src/services/dashboardEventBus';
import {
  setInCache,
  getFromCache,
  invalidateAnalyticsCache,
} from '../src/web/services/analyticsService';
import { createWebApp } from '../src/web/server';

describe('Neon Real-Time Data Sync & SSE Streaming Tests', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createWebApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
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

  describe('1. Dashboard Event Bus & Ring Buffer', () => {
    it('publishes events with unique IDs, correct types and timestamps', () => {
      const event = publishDashboardEvent('party:created', 'party-test-1', {
        title: 'T8 Tracking Expedition',
        activityType: 'T8 Group Tracking',
        hostId: 'host-123',
      });

      expect(event.id).toBeDefined();
      expect(event.type).toBe('party:created');
      expect(event.timestamp).toBeDefined();
      expect(event.partyId).toBe('party-test-1');
      expect(event.data?.title).toBe('T8 Tracking Expedition');
    });

    it('buffers recent events and returns them via getRecent(sinceIsoString)', () => {
      const startIso = new Date(Date.now() - 2000).toISOString();
      publishDashboardEvent('party:updated', 'party-test-2', {
        title: 'Updated Raid',
      });

      const recent = dashboardEventBus.getRecent(startIso);
      expect(recent.length).toBeGreaterThan(0);
      const found = recent.find((e) => e.partyId === 'party-test-2');
      expect(found).toBeDefined();
      expect(found?.type).toBe('party:updated');
    });
  });

  describe('2. In-Memory Cache with Immediate Mutation Invalidation', () => {
    it('stores and retrieves cached analytics data', () => {
      setInCache('test-key', { sample: 42 }, 10);
      const cached = getFromCache<{ sample: number }>('test-key');
      expect(cached).not.toBeNull();
      expect(cached?.sample).toBe(42);
    });

    it('automatically invalidates the cache when a mutation event is published', () => {
      setInCache('analytics:overview:week', { totalParties: 100 }, 60);
      expect(getFromCache('analytics:overview:week')).not.toBeNull();

      // Publish a party:created event
      publishDashboardEvent('party:created', 'party-test-3', {
        title: 'New Hunt',
      });

      // The cache must be immediately cleared
      expect(getFromCache('analytics:overview:week')).toBeNull();
    });

    it('manual invalidation clears the cache completely', () => {
      setInCache('key1', 'val1', 60);
      setInCache('key2', 'val2', 60);
      invalidateAnalyticsCache();
      expect(getFromCache('key1')).toBeNull();
      expect(getFromCache('key2')).toBeNull();
    });
  });

  describe('3. SSE Real-Time Endpoint (/api/realtime/stream)', () => {
    it('delivers handshake on connection and streams published events in <50ms', async () => {
      const controller = new AbortController();
      const ssePromise = new Promise<{ handshake: any; receivedEvent: any; latencyMs: number }>(
        async (resolve, reject) => {
          try {
            const res = await fetch(`${baseUrl}/api/realtime/stream`, {
              signal: controller.signal,
              headers: { Accept: 'text/event-stream' },
            });

            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toContain('text/event-stream');
            expect(res.headers.get('cache-control')).toContain('no-cache');

            const reader = res.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let handshake: any = null;
            let receivedEvent: any = null;
            let publishTime = 0;
            let receiveTime = 0;

            const readChunk = async () => {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split('\n\n');
                buffer = lines.pop() || '';

                for (const block of lines) {
                  const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
                  if (!dataLine) continue;

                  const data = JSON.parse(dataLine.slice(6));
                  if (data.type === 'connected') {
                    handshake = data;
                    publishTime = performance.now();
                    publishDashboardEvent('registration:created', 'party-sse-test', {
                      userId: 'user-789',
                      roleName: 'Shadowcaller DPS',
                    });
                  } else if (data.type === 'registration:created') {
                    receiveTime = performance.now();
                    receivedEvent = data;
                    resolve({
                      handshake,
                      receivedEvent,
                      latencyMs: receiveTime - publishTime,
                    });
                    return;
                  }
                }
              }
            };

            readChunk().catch(reject);
          } catch (err: any) {
            if (err.name !== 'AbortError') reject(err);
          }
        }
      );

      const result = await ssePromise;
      controller.abort();

      expect(result.handshake).toBeDefined();
      expect(result.handshake.clientId).toBeDefined();
      expect(result.receivedEvent).toBeDefined();
      expect(result.receivedEvent.partyId).toBe('party-sse-test');
      expect(result.receivedEvent.data?.roleName).toBe('Shadowcaller DPS');
      expect(result.latencyMs).toBeLessThan(50);
    });

    it('replays missed events when connecting with ?since= query parameter', async () => {
      const beforeTime = new Date(Date.now() - 500).toISOString();
      publishDashboardEvent('party:status_changed', 'party-catchup-1', {
        status: 'CLOSED',
      });

      const controller = new AbortController();
      const replayPromise = new Promise<any>(async (resolve, reject) => {
        try {
          const res = await fetch(`${baseUrl}/api/realtime/stream?since=${encodeURIComponent(beforeTime)}`, {
            signal: controller.signal,
            headers: { Accept: 'text/event-stream' },
          });

          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n\n');
            buffer = lines.pop() || '';

            for (const block of lines) {
              const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
              if (!dataLine) continue;

              const data = JSON.parse(dataLine.slice(6));
              if (data.type === 'party:status_changed' && data.partyId === 'party-catchup-1') {
                resolve(data);
                return;
              }
            }
          }
        } catch (err: any) {
          if (err.name !== 'AbortError') reject(err);
        }
      });

      const replayed = await replayPromise;
      controller.abort();

      expect(replayed).toBeDefined();
      expect(replayed.partyId).toBe('party-catchup-1');
      expect(replayed.data?.status).toBe('CLOSED');
    });
  });

  describe('4. Realtime Status & Polling Fallback Endpoints', () => {
    it('GET /api/realtime/status returns service health and active stats', async () => {
      const res = await fetch(`${baseUrl}/api/realtime/status`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('online');
      expect(typeof data.connectedClients).toBe('number');
      expect(typeof data.recentEventsCount).toBe('number');
      expect(data.timestamp).toBeDefined();
    });

    it('GET /api/realtime/events returns recent events for polling fallback', async () => {
      const res = await fetch(`${baseUrl}/api/realtime/events`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.events).toBeInstanceOf(Array);
      expect(data.events.length).toBeGreaterThan(0);
      expect(data.timestamp).toBeDefined();
    });
  });
});
