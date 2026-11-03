import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { createWebApp } from '../src/web/server';

describe('Health Check and Root Probes for Uptime Monitoring', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createWebApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address() as any;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('GET /health returns 200 OK with detailed diagnostics', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('discord-raid-master');
    expect(body.timestamp).toBeDefined();
    expect(typeof body.uptime).toBe('number');
    expect(body.database).toBeDefined();
    expect(body.discord).toBeDefined();
    expect(body.realtime).toBeDefined();
  });

  it('HEAD /health returns 200 OK without body', async () => {
    const res = await fetch(`${baseUrl}/health`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('');
  });

  it('HEAD / returns 200 OK for root domain ping', async () => {
    const res = await fetch(`${baseUrl}/`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('');
  });
});
