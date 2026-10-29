import express from 'express';
import cors from 'cors';
import path from 'path';
import http from 'http';
import { apiRouter } from './routes/api';
import { env } from '../config/env';
import { logger } from '../utils/logger';

let serverInstance: http.Server | null = null;

export function createWebApp(): express.Application {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logger in debug mode
  app.use((req, _res, next) => {
    logger.debug({ method: req.method, url: req.url }, 'Incoming web request');
    next();
  });

  // Mount API router
  app.use(apiRouter);

  // Serve static UI assets
  const publicDir = path.resolve(process.cwd(), 'public');
  app.use(express.static(publicDir));

  // SPA fallback for frontend client-side routing
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path === '/health') {
      return next();
    }
    res.sendFile(path.join(publicDir, 'index.html'), (err) => {
      if (err) {
        res.status(200).send('<html><head><title>Tracking Party Analytics</title></head><body><h1>Tracking Party Analytics</h1><p>Dashboard is online.</p></body></html>');
      }
    });
  });

  return app;
}

export async function startWebServer(): Promise<http.Server> {
  if (serverInstance) {
    return serverInstance;
  }

  const app = createWebApp();
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : env.PORT || 3000;
  const host = process.env.HOST || env.HOST || '0.0.0.0';

  return new Promise((resolve, reject) => {
    serverInstance = app.listen(port, host, () => {
      logger.info(`Web Analytics Dashboard running at http://${host}:${port}`);
      resolve(serverInstance!);
    });
    serverInstance.on('error', (err) => {
      logger.error({ err }, `Failed to start Web Analytics server on ${host}:${port}`);
      reject(err);
    });
  });
}

export async function stopWebServer(): Promise<void> {
  if (!serverInstance) return;

  return new Promise((resolve, reject) => {
    serverInstance!.close((err) => {
      if (err) {
        logger.error({ err }, 'Error closing web server');
        reject(err);
      } else {
        logger.info('Web server closed successfully');
        serverInstance = null;
        resolve();
      }
    });
  });
}
