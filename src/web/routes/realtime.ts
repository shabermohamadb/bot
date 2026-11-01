import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { dashboardEventBus, DashboardEvent } from '../../services/dashboardEventBus';
import { logger } from '../../utils/logger';

export const realtimeRouter = Router();

interface ConnectedClient {
  id: string;
  ip: string;
  res: Response;
  connectedAt: Date;
}

const connectedClients = new Map<string, ConnectedClient>();

/**
 * Server-Sent Events (SSE) Stream
 * Subscribes the client to live database mutation events without third-party services.
 */
realtimeRouter.get('/api/realtime/stream', (req: Request, res: Response) => {
  const clientId = randomUUID();
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

  // Set mandatory SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable proxy buffering on Nginx / Render
  });

  // Flush headers immediately
  res.flushHeaders?.();

  // Register client
  const client: ConnectedClient = {
    id: clientId,
    ip: clientIp,
    res,
    connectedAt: new Date(),
  };
  connectedClients.set(clientId, client);

  logger.debug({ clientId, totalClients: connectedClients.size }, 'SSE client connected to realtime stream');

  // Send initial handshake
  const handshake = {
    type: 'connected',
    clientId,
    timestamp: new Date().toISOString(),
    totalActiveClients: connectedClients.size,
  };
  res.write(`data: ${JSON.stringify(handshake)}\n\n`);

  // If client requested replay since a timestamp, send missed events
  const since = req.query.since as string | undefined;
  if (since) {
    const catchupEvents = dashboardEventBus.getRecent(since, 20);
    for (const evt of catchupEvents.reverse()) {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    }
  }

  // Event listener callback
  const onEvent = (event: DashboardEvent) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (err) {
      logger.debug({ err, clientId }, 'Error sending SSE event to client');
    }
  };

  dashboardEventBus.on('event', onEvent);

  // Keep-alive heartbeat every 20 seconds to prevent Render 55s timeout
  const pingInterval = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch {
      clearInterval(pingInterval);
    }
  }, 20000);

  // Handle client disconnect
  req.on('close', () => {
    clearInterval(pingInterval);
    dashboardEventBus.off('event', onEvent);
    connectedClients.delete(clientId);
    logger.debug({ clientId, totalClients: connectedClients.size }, 'SSE client disconnected');
  });
});

/**
 * Fallback Polling / Catch-up Endpoint
 * Allows clients to query recent events if live SSE connection is interrupted.
 */
realtimeRouter.get('/api/realtime/events', (req: Request, res: Response) => {
  const since = req.query.since as string | undefined;
  const limit = parseInt((req.query.limit as string) || '20', 10) || 20;
  const events = dashboardEventBus.getRecent(since, Math.min(limit, 50));
  res.json({
    events,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Realtime Status Diagnostics
 */
realtimeRouter.get('/api/realtime/status', (_req: Request, res: Response) => {
  res.json({
    status: 'online',
    connectedClients: connectedClients.size,
    recentEventsCount: dashboardEventBus.getRecent(undefined, 50).length,
    timestamp: new Date().toISOString(),
  });
});
