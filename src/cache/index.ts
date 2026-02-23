import { createClient } from 'redis';
import { config } from '../config';
import { logger } from '../utils/logger';

type RedisClientType = ReturnType<typeof createClient>;

let client: RedisClientType | null = null;

export async function getRedisClient(): Promise<RedisClientType> {
  if (!client) {
    client = createClient({
      url: config.redisUrl,
      socket: {
        // Give up reconnecting after 3 attempts so connect() rejects instead of hanging
        reconnectStrategy: (retries: number) => {
          if (retries >= 3) return false;
          return Math.min(retries * 100, 500);
        },
      },
      // Fail commands immediately when the client is offline rather than queueing
      disableOfflineQueue: true,
    });
    client.on('error', (err: Error) => logger.error({ err }, 'Redis client error'));
    await client.connect();
  }
  return client;
}

export async function cacheGet(key: string): Promise<string | null> {
  try {
    const c = await getRedisClient();
    return await c.get(key);
  } catch {
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds?: number
): Promise<void> {
  try {
    const c = await getRedisClient();
    if (ttlSeconds) {
      await c.set(key, value, { EX: ttlSeconds });
    } else {
      await c.set(key, value);
    }
  } catch {
    // Cache is optional; log at debug level and continue
    logger.debug({ key }, 'Redis cacheSet skipped — Redis unavailable');
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    const c = await getRedisClient();
    await c.del(key);
  } catch {
    logger.debug({ key }, 'Redis cacheDel skipped — Redis unavailable');
  }
}

export async function cacheIncr(key: string, ttlSeconds?: number): Promise<number> {
  try {
    const c = await getRedisClient();
    const val = await c.incr(key);
    if (ttlSeconds && val === 1) {
      await c.expire(key, ttlSeconds);
    }
    return val;
  } catch {
    // Return 1 so the first call is always allowed when Redis is unavailable
    return 1;
  }
}
