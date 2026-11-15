import { Redis } from '@upstash/redis';
import { put } from '@vercel/blob';

let redisClient = null;
const memoryRateLimit = new Map();

function getRedisCreds() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

export function isRedisConfigured() {
  return Boolean(getRedisCreds());
}

export function isBlobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function getRedis() {
  const creds = getRedisCreds();
  if (!creds) return null;
  if (!redisClient) {
    redisClient = new Redis(creds);
  }
  return redisClient;
}

function getCurrentMonth() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function getMonthlyLimit() {
  const raw = Number(process.env.MONTHLY_NANO_BANANA_LIMIT || 74);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 74;
}

export async function getMonthlyUsage() {
  const month = getCurrentMonth();
  const limit = getMonthlyLimit();
  const redis = getRedis();
  let nanoUsed = 0;
  let pollinationsUsed = 0;

  if (redis) {
    try {
      const data = await redis.hgetall(`heizmobil:usage:${month}`);
      if (data) {
        nanoUsed = Number(data.nano_banana_used || 0);
        pollinationsUsed = Number(data.pollinations_used || 0);
      }
    } catch (err) {
      console.error('Redis getMonthlyUsage error:', err);
    }
  }

  return {
    month,
    nano_banana_used: nanoUsed,
    pollinations_used: pollinationsUsed,
    monthly_limit: limit,
    remaining: Math.max(0, limit - nanoUsed),
  };
}

export async function incrementMonthlyUsage(source) {
  const month = getCurrentMonth();
  const redis = getRedis();
  if (redis) {
    try {
      const field = source === 'nano_banana' ? 'nano_banana_used' : 'pollinations_used';
      await redis.hincrby(`heizmobil:usage:${month}`, field, 1);
    } catch (err) {
      console.error('Redis incrementMonthlyUsage error:', err);
    }
  }
  return getMonthlyUsage();
}

const OVERRIDES_KEY = 'heizmobil:posts_overrides_v1';

export async function getPostOverrides() {
  const redis = getRedis();
  if (!redis) return {};
  try {
    const data = await redis.get(OVERRIDES_KEY);
    return data && typeof data === 'object' ? data : {};
  } catch (err) {
    console.error('Redis getPostOverrides error:', err);
    return {};
  }
}

export async function savePostOverride(postId, fields) {
  const redis = getRedis();
  if (!redis) return false;
  try {
    const current = await getPostOverrides();
    current[postId] = {
      ...(current[postId] || {}),
      ...fields,
      updated_at: new Date().toISOString(),
    };
    await redis.set(OVERRIDES_KEY, current);
    return true;
  } catch (err) {
    console.error('Redis savePostOverride error:', err);
    return false;
  }
}

export async function uploadImageBuffer(filename, buffer, mimeType = 'image/jpeg') {
  if (!isBlobConfigured()) {
    return null;
  }
  const blob = await put(`heizmobil/${filename}`, buffer, {
    access: 'public',
    contentType: mimeType,
    addRandomSuffix: false,
  });
  return blob.url;
}

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_SECONDS = 15 * 60; // 15 Minuten Sperre nach 5 Fehlversuchen

export async function checkLoginRateLimit(ip) {
  const safeIp = String(ip || 'unknown').replace(/[^a-zA-Z0-9.:_-]/g, '_');
  const redis = getRedis();
  if (redis) {
    try {
      const count = Number((await redis.get(`heizmobil:rl:${safeIp}`)) || 0);
      return { blocked: count >= MAX_LOGIN_ATTEMPTS, attempts: count };
    } catch (err) {
      console.error('Redis checkLoginRateLimit error:', err);
    }
  }
  const entry = memoryRateLimit.get(safeIp);
  if (entry && entry.expires > Date.now()) {
    return { blocked: entry.count >= MAX_LOGIN_ATTEMPTS, attempts: entry.count };
  }
  return { blocked: false, attempts: 0 };
}

export async function recordFailedLogin(ip) {
  const safeIp = String(ip || 'unknown').replace(/[^a-zA-Z0-9.:_-]/g, '_');
  const redis = getRedis();
  if (redis) {
    try {
      const key = `heizmobil:rl:${safeIp}`;
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, LOGIN_WINDOW_SECONDS);
      }
      return count;
    } catch (err) {
      console.error('Redis recordFailedLogin error:', err);
    }
  }
  const now = Date.now();
  const prev = memoryRateLimit.get(safeIp);
  const count = prev && prev.expires > now ? prev.count + 1 : 1;
  memoryRateLimit.set(safeIp, { count, expires: now + LOGIN_WINDOW_SECONDS * 1000 });
  return count;
}

export async function clearLoginFailures(ip) {
  const safeIp = String(ip || 'unknown').replace(/[^a-zA-Z0-9.:_-]/g, '_');
  memoryRateLimit.delete(safeIp);
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(`heizmobil:rl:${safeIp}`);
    } catch (err) {
      console.error('Redis clearLoginFailures error:', err);
    }
  }
}
