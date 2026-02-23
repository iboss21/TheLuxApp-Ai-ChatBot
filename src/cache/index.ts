import { createClient } from 'redis';
import { config } from '../config';
import { logger } from '../utils/logger';

type RedisClientType = ReturnType<typeof createClient>;

let client: RedisClientType | null = null;

export async function getRedisClient(): Promise<RedisClientType> {
  if (!client) {
    client = createClient({ url: config.redisUrl });
    client.on('error', (err: Error) => logger.error({ err }, 'Redis client error'));
    client.on('connect', () => logger.info('Redis connected'));
    await client.connect();
  }
  return client;
}

export async function cacheGet(key: string): Promise<string | null> {
  const c = await getRedisClient();
  return c.get(key);
}

export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds?: number
): Promise<void> {
  const c = await getRedisClient();
  if (ttlSeconds) {
    await c.set(key, value, { EX: ttlSeconds });
  } else {
    await c.set(key, value);
  }
}

export async function cacheDel(key: string): Promise<void> {
  const c = await getRedisClient();
  await c.del(key);
}

export async function cacheIncr(key: string, ttlSeconds?: number): Promise<number> {
  const c = await getRedisClient();
  const val = await c.incr(key);
  if (ttlSeconds && val === 1) {
    await c.expire(key, ttlSeconds);
  }
  return val;
}
