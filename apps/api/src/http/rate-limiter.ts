export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export interface RateLimiter {
  check(key: string, limit: number, windowSeconds: number): RateLimitResult;
}

interface SlidingWindowEntry {
  timestamps: number[];
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, SlidingWindowEntry>();
  private readonly now: () => number;

  constructor(options?: { now?: () => number }) {
    this.now = options?.now ?? (() => Date.now());
  }

  check(key: string, limit: number, windowSeconds: number): RateLimitResult {
    const now = this.now();
    const windowMs = windowSeconds * 1000;
    const cutoff = now - windowMs;

    let entry = this.windows.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.windows.set(key, entry);
    }

    entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);

    if (entry.timestamps.length >= limit) {
      const oldestInWindow = entry.timestamps[0];
      const retryAfterMs = oldestInWindow + windowMs - now;
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000)
      };
    }

    entry.timestamps.push(now);
    return { allowed: true };
  }
}

export class NoOpRateLimiter implements RateLimiter {
  check(): RateLimitResult {
    return { allowed: true };
  }
}

export type RouteCategory = 'admin' | 'public' | 'liff' | 'webhook';

export const RATE_LIMITS: Record<RouteCategory, { limit: number; windowSeconds: number }> = {
  admin: { limit: 100, windowSeconds: 60 },
  public: { limit: 30, windowSeconds: 60 },
  liff: { limit: 100, windowSeconds: 60 },
  webhook: { limit: 1000, windowSeconds: 60 }
};

export function classifyRoute(path: string): RouteCategory {
  if (path.startsWith('/v1/admin/')) return 'admin';
  if (path.startsWith('/v1/line/webhook/')) return 'webhook';
  if (path.startsWith('/v1/liff/') || path.startsWith('/v1/volunteer/')) return 'liff';
  return 'public';
}

export function buildRateLimitKey(category: RouteCategory, identifier: string): string {
  return `rate:${category}:${identifier}`;
}
