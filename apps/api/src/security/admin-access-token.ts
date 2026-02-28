import { createHmac } from 'node:crypto';
import { AdminTokenPayload } from '../domain/admin-auth.js';
import { UnauthorizedError } from '../errors.js';

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

export function createSignedAdminToken(payload: AdminTokenPayload, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerSegment = base64urlEncode(JSON.stringify(header));
  const payloadSegment = base64urlEncode(JSON.stringify(payload));
  const signature = signSegment(secret, headerSegment, payloadSegment);

  return `${headerSegment}.${payloadSegment}.${signature}`;
}

export function verifySignedAdminToken(token: string, secret: string): AdminTokenPayload {
  const parts = token.split('.');

  if (parts.length !== 3) {
    throw new UnauthorizedError('Admin token format is invalid');
  }

  const [headerSegment, payloadSegment, signature] = parts;
  const expectedSignature = signSegment(secret, headerSegment, payloadSegment);

  if (signature !== expectedSignature) {
    throw new UnauthorizedError('Admin token signature is invalid');
  }

  const payload = JSON.parse(base64urlDecode(payloadSegment)) as AdminTokenPayload;

  if (payload.typ !== 'admin') {
    throw new UnauthorizedError('Admin token type is invalid');
  }

  return payload;
}
