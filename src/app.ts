import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import path from 'path';
import { config } from './config';
import { createRouter } from './routes';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';

export function createApp(): express.Application {
  const app = express();

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        // Landing page has inline styles/scripts; API consumers use their own CSP
        scriptSrc:   ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
        styleSrc:    ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
        fontSrc:     ["'self'", 'fonts.gstatic.com'],
        imgSrc:      ["'self'", 'data:'],
        connectSrc:  ["'self'"],
        frameSrc:    ["'none'"],
        objectSrc:   ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
  }));
  app.use(cors({ origin: config.corsOrigin }));

  // Capture raw body for webhook signature verification (Discord, Slack, WhatsApp)
  app.use(
    express.json({
      limit: '10mb',
      verify: (req: Request, _res: Response, buf: Buffer) => {
        (req as Request & { rawBody: Buffer }).rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: true }));

  app.use(pinoHttp({ logger }));

  app.use(
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.max,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: { code: 'rate_limit_exceeded', message: 'Too many requests' } },
    })
  );

  // Serve landing page and static assets
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/', createRouter());

  app.use(errorHandler);

  return app;
}
