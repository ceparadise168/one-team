import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryRateLimiter,
  NoOpRateLimiter,
  classifyRoute,
  buildRateLimitKey
} from './rate-limiter.js';

describe('InMemoryRateLimiter', () => {
  it('allows requests within limit', () => {
    const limiter = new InMemoryRateLimiter();

    for (let i = 0; i < 5; i++) {
      const result = limiter.check('key-1', 5, 60);
      assert.equal(result.allowed, true);
    }
  });

  it('blocks requests exceeding limit', () => {
    const limiter = new InMemoryRateLimiter();

    for (let i = 0; i < 3; i++) {
      limiter.check('key-1', 3, 60);
    }

    const result = limiter.check('key-1', 3, 60);
    assert.equal(result.allowed, false);
    assert.ok(result.retryAfterSeconds! > 0);
  });

  it('resets after window expires', () => {
    let now = 1000000;
    const limiter = new InMemoryRateLimiter({ now: () => now });

    for (let i = 0; i < 3; i++) {
      limiter.check('key-1', 3, 60);
    }

    const blocked = limiter.check('key-1', 3, 60);
    assert.equal(blocked.allowed, false);

    now += 61000;
    const allowed = limiter.check('key-1', 3, 60);
    assert.equal(allowed.allowed, true);
  });

  it('tracks different keys independently', () => {
    const limiter = new InMemoryRateLimiter();

    for (let i = 0; i < 3; i++) {
      limiter.check('key-1', 3, 60);
    }

    const result = limiter.check('key-2', 3, 60);
    assert.equal(result.allowed, true);
  });
});

describe('NoOpRateLimiter', () => {
  it('always allows requests', () => {
    const limiter = new NoOpRateLimiter();
    const result = limiter.check();
    assert.equal(result.allowed, true);
  });
});

describe('classifyRoute', () => {
  it('classifies admin routes', () => {
    assert.equal(classifyRoute('/v1/admin/tenants'), 'admin');
  });

  it('classifies webhook routes', () => {
    assert.equal(classifyRoute('/v1/line/webhook/tenant-1'), 'webhook');
  });

  it('classifies public routes', () => {
    assert.equal(classifyRoute('/v1/public/bind/start'), 'public');
    assert.equal(classifyRoute('/v1/liff/tenants/t1/me/profile'), 'public');
  });
});

describe('buildRateLimitKey', () => {
  it('builds rate limit key', () => {
    assert.equal(buildRateLimitKey('admin', 'tenant-1'), 'rate:admin:tenant-1');
  });
});
