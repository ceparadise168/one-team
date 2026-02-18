import test from 'node:test';
import assert from 'node:assert/strict';
import { UnauthorizedError } from '../errors.js';
import { InMemoryEmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
import {
  InMemoryRefreshSessionRepository,
  InMemoryRevokedJtiRepository
} from '../repositories/auth-repository.js';
import { AuthSessionService } from './auth-session-service.js';

test('issues and validates access token with tenant scope', async () => {
  const now = new Date('2026-02-18T00:00:00.000Z');
  const bindingRepository = new InMemoryEmployeeBindingRepository();
  await bindingRepository.upsert({
    tenantId: 'tenant_a',
    employeeId: 'E001',
    lineUserId: 'U001',
    boundAt: now.toISOString(),
    employmentStatus: 'ACTIVE'
  });

  const service = new AuthSessionService(
    new InMemoryRefreshSessionRepository(),
    new InMemoryRevokedJtiRepository(),
    bindingRepository,
    {
      issuer: 'one-team-test',
      accessTokenTtlSeconds: 600,
      refreshSessionTtlSeconds: 7 * 24 * 60 * 60,
      accessTokenSecret: 'test-secret',
      now: () => now
    }
  );

  const tokens = await service.issueEmployeeSession({
    tenantId: 'tenant_a',
    employeeId: 'E001',
    lineUserId: 'U001'
  });

  const principal = await service.validateAccessToken(tokens.accessToken, 'tenant_a');

  assert.equal(principal.tenantId, 'tenant_a');
  assert.equal(principal.employeeId, 'E001');
  assert.equal(principal.lineUserId, 'U001');
});

test('refresh rotates refresh token and issues new access token', async () => {
  const now = new Date('2026-02-18T00:00:00.000Z');
  const bindingRepository = new InMemoryEmployeeBindingRepository();
  await bindingRepository.upsert({
    tenantId: 'tenant_a',
    employeeId: 'E002',
    lineUserId: 'U002',
    boundAt: now.toISOString(),
    employmentStatus: 'ACTIVE'
  });

  const service = new AuthSessionService(
    new InMemoryRefreshSessionRepository(),
    new InMemoryRevokedJtiRepository(),
    bindingRepository,
    {
      issuer: 'one-team-test',
      accessTokenTtlSeconds: 600,
      refreshSessionTtlSeconds: 7 * 24 * 60 * 60,
      accessTokenSecret: 'test-secret',
      now: () => now
    }
  );

  const issued = await service.issueEmployeeSession({
    tenantId: 'tenant_a',
    employeeId: 'E002',
    lineUserId: 'U002'
  });

  const refreshed = await service.refreshEmployeeSession({
    refreshToken: issued.refreshToken
  });

  assert.notEqual(refreshed.refreshToken, issued.refreshToken);
  assert.notEqual(refreshed.accessToken, issued.accessToken);

  const principal = await service.validateAccessToken(refreshed.accessToken, 'tenant_a');
  assert.equal(principal.employeeId, 'E002');
});

test('revoked jti cannot be used again', async () => {
  const now = new Date('2026-02-18T00:00:00.000Z');
  const bindingRepository = new InMemoryEmployeeBindingRepository();
  await bindingRepository.upsert({
    tenantId: 'tenant_a',
    employeeId: 'E003',
    lineUserId: 'U003',
    boundAt: now.toISOString(),
    employmentStatus: 'ACTIVE'
  });

  const service = new AuthSessionService(
    new InMemoryRefreshSessionRepository(),
    new InMemoryRevokedJtiRepository(),
    bindingRepository,
    {
      issuer: 'one-team-test',
      accessTokenTtlSeconds: 600,
      refreshSessionTtlSeconds: 7 * 24 * 60 * 60,
      accessTokenSecret: 'test-secret',
      now: () => now
    }
  );

  const issued = await service.issueEmployeeSession({
    tenantId: 'tenant_a',
    employeeId: 'E003',
    lineUserId: 'U003'
  });

  await service.revokeAccessTokenJti(issued.accessToken);

  await assert.rejects(
    () => service.validateAccessToken(issued.accessToken, 'tenant_a'),
    (error) => {
      assert.ok(error instanceof UnauthorizedError);
      assert.equal(error.message, 'Access token is revoked');
      return true;
    }
  );
});

test('revoking refresh session also revokes tracked active access token jtis', async () => {
  const now = new Date('2026-02-18T00:00:00.000Z');
  const bindingRepository = new InMemoryEmployeeBindingRepository();
  await bindingRepository.upsert({
    tenantId: 'tenant_a',
    employeeId: 'E004',
    lineUserId: 'U004',
    boundAt: now.toISOString(),
    employmentStatus: 'ACTIVE'
  });

  const service = new AuthSessionService(
    new InMemoryRefreshSessionRepository(),
    new InMemoryRevokedJtiRepository(),
    bindingRepository,
    {
      issuer: 'one-team-test',
      accessTokenTtlSeconds: 600,
      refreshSessionTtlSeconds: 7 * 24 * 60 * 60,
      accessTokenSecret: 'test-secret',
      now: () => now
    }
  );

  const issued = await service.issueEmployeeSession({
    tenantId: 'tenant_a',
    employeeId: 'E004',
    lineUserId: 'U004'
  });

  await service.revokeSessionByRefreshToken(issued.refreshToken);

  await assert.rejects(
    () => service.validateAccessToken(issued.accessToken, 'tenant_a'),
    (error) => {
      assert.ok(error instanceof UnauthorizedError);
      assert.equal(error.message, 'Access token is revoked');
      return true;
    }
  );
});
