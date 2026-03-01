import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { extractBearerToken } from './auth-middleware.js';

function fakeEvent(headers: Record<string, string>): APIGatewayProxyEvent {
  return { headers } as unknown as APIGatewayProxyEvent;
}

describe('extractBearerToken', () => {
  it('extracts token from valid Bearer header', () => {
    const token = extractBearerToken(fakeEvent({ authorization: 'Bearer abc123' }));
    assert.equal(token, 'abc123');
  });

  it('extracts token from Authorization header (capital A)', () => {
    const token = extractBearerToken(fakeEvent({ Authorization: 'Bearer xyz' }));
    assert.equal(token, 'xyz');
  });

  it('trims whitespace around token', () => {
    const token = extractBearerToken(fakeEvent({ authorization: 'Bearer   spaced   ' }));
    assert.equal(token, 'spaced');
  });

  it('throws when authorization header is missing', () => {
    assert.throws(() => extractBearerToken(fakeEvent({})), {
      message: 'Missing bearer access token'
    });
  });

  it('throws when authorization header does not start with Bearer', () => {
    assert.throws(() => extractBearerToken(fakeEvent({ authorization: 'Basic abc' })), {
      message: 'Authorization header must use Bearer token'
    });
  });

  it('throws when token is empty after Bearer with space', () => {
    assert.throws(() => extractBearerToken(fakeEvent({ authorization: 'Bearer ' })), {
      message: 'Bearer access token is empty'
    });
  });

  it('throws when header is just "Bearer" without space or token', () => {
    assert.throws(() => extractBearerToken(fakeEvent({ authorization: 'Bearer' })), {
      message: 'Authorization header must use Bearer token'
    });
  });
});
