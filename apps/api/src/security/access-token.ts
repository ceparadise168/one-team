import { createHmac } from 'node:crypto';
import { AccessTokenPayload } from '../domain/auth.js';
import { UnauthorizedError } from '../errors.js';

interface JwtHeader {
  alg: 'HS256';
  typ: 'JWT';
}

function base64urlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64urlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function signSegment(secret: string, headerSegment: string, payloadSegment: string): string {
  return createHmac('sha256', secret)
    .update(`${headerSegment}.${payloadSegment}`)
    .digest('base64url');
}

export function createSignedAccessToken(payload: AccessTokenPayload, secret: string): string {
  const header: JwtHeader = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const headerSegment = base64urlEncode(JSON.stringify(header));
  const payloadSegment = base64urlEncode(JSON.stringify(payload));
  const signature = signSegment(secret, headerSegment, payloadSegment);

  return `${headerSegment}.${payloadSegment}.${signature}`;
}

export function verifySignedAccessToken(token: string, secret: string): AccessTokenPayload {
  const parts = token.split('.');

  if (parts.length !== 3) {
    throw new UnauthorizedError('Access token format is invalid');
  }

  const [headerSegment, payloadSegment, signature] = parts;
  const expectedSignature = signSegment(secret, headerSegment, payloadSegment);

  if (signature !== expectedSignature) {
    throw new UnauthorizedError('Access token signature is invalid');
  }

  const payload = JSON.parse(base64urlDecode(payloadSegment)) as AccessTokenPayload;

  if (payload.typ !== 'access') {
    throw new UnauthorizedError('Access token type is invalid');
  }

  return payload;
}
