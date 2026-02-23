import 'dotenv/config';
import { createApp } from './app';
import { config } from './config';
import { logger } from './utils/logger';
import { getRedisClient } from './cache';

async function main(): Promise<void> {
  const app = createApp();

  // Start the HTTP server first so the app is reachable regardless of Redis availability
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.nodeEnv }, 'Supreme Enterprise Chatbot Platform started');
  });

  // Connect to Redis in the background — failure is non-fatal
  getRedisClient().then(() => {
    logger.info('Redis connected');
  }).catch((err: unknown) => {
    logger.warn({ err }, 'Redis connection failed - cache disabled');
  });

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down gracefully');
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
