import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { jsonResponse, preflightResponse } from './response.js';

describe('jsonResponse', () => {
  it('includes security headers on every response', () => {
    const result = jsonResponse(200, { ok: true });

    assert.equal(result.headers!['x-content-type-options'], 'nosniff');
    assert.equal(result.headers!['x-frame-options'], 'DENY');
    assert.equal(result.headers!['strict-transport-security'], 'max-age=63072000; includeSubDomains; preload');
    assert.equal(result.headers!['cache-control'], 'no-store');
    assert.equal(result.headers!['content-type'], 'application/json; charset=utf-8');
  });

  it('serializes body as JSON', () => {
    const result = jsonResponse(201, { id: 'abc' });

    assert.equal(result.statusCode, 201);
    assert.equal(result.body, '{"id":"abc"}');
  });

  it('adds CORS headers when origin matches allowlist', () => {
    const result = jsonResponse(200, { ok: true }, {
      origin: 'https://app.example.com',
      corsConfig: { allowedOrigins: ['https://app.example.com'] }
    });

    assert.equal(result.headers!['access-control-allow-origin'], 'https://app.example.com');
    assert.equal(result.headers!['access-control-allow-credentials'], 'true');
    assert.equal(result.headers!['vary'], 'Origin');
  });

  it('does not add CORS headers when origin is not in allowlist', () => {
    const result = jsonResponse(200, { ok: true }, {
      origin: 'https://evil.com',
      corsConfig: { allowedOrigins: ['https://app.example.com'] }
    });

    assert.equal(result.headers!['access-control-allow-origin'], undefined);
  });

  it('supports wildcard origin', () => {
    const result = jsonResponse(200, { ok: true }, {
      origin: 'https://anything.com',
      corsConfig: { allowedOrigins: ['*'] }
    });

    assert.equal(result.headers!['access-control-allow-origin'], 'https://anything.com');
  });

  it('does not add CORS headers when origin is empty', () => {
    const result = jsonResponse(200, { ok: true }, {
      origin: '',
      corsConfig: { allowedOrigins: ['*'] }
    });

    assert.equal(result.headers!['access-control-allow-origin'], undefined);
  });

  it('does not add CORS headers without corsConfig', () => {
    const result = jsonResponse(200, { ok: true });

    assert.equal(result.headers!['access-control-allow-origin'], undefined);
  });
});

describe('preflightResponse', () => {
  it('returns 204 with CORS and security headers for allowed origin', () => {
    const result = preflightResponse('https://app.example.com', {
      allowedOrigins: ['https://app.example.com']
    });

    assert.equal(result.statusCode, 204);
    assert.equal(result.body, '');
    assert.equal(result.headers!['access-control-allow-origin'], 'https://app.example.com');
    assert.equal(result.headers!['access-control-allow-methods'], 'GET,POST,PUT,DELETE,OPTIONS');
    assert.equal(result.headers!['access-control-allow-headers'], 'content-type,authorization,x-scanner-api-key');
    assert.equal(result.headers!['access-control-max-age'], '86400');
    assert.equal(result.headers!['x-content-type-options'], 'nosniff');
  });

  it('does not include allow-methods when origin is not allowed', () => {
    const result = preflightResponse('https://evil.com', {
      allowedOrigins: ['https://app.example.com']
    });

    assert.equal(result.statusCode, 204);
    assert.equal(result.headers!['access-control-allow-origin'], undefined);
    assert.equal(result.headers!['access-control-allow-methods'], undefined);
  });
});
