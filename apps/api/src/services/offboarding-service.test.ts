import test from 'node:test';
import assert from 'node:assert/strict';
import { StubLinePlatformClient } from '../line/line-platform-client.js';
import { InMemoryAccessControlRepository } from '../repositories/access-control-repository.js';
import {
  InMemoryBatchInviteJobRepository,
  InMemoryBindingSessionRepository,
  InMemoryEmployeeBindingRepository,
  InMemoryEmployeeEnrollmentRepository,
  InMemoryInvitationRepository
} from '../repositories/invitation-binding-repository.js';
import {
  InMemoryRefreshSessionRepository,
  InMemoryRevokedJtiRepository
} from '../repositories/auth-repository.js';
import {
  InMemoryAuditEventRepository,
  InMemoryOffboardingJobRepository
} from '../repositories/offboarding-repository.js';
import { AuthSessionService } from './auth-session-service.js';
import { InvitationBindingService } from './invitation-binding-service.js';
import { OffboardingService } from './offboarding-service.js';
import { InMemoryTenantRepository } from '../repositories/tenant-repository.js';
import { TenantOnboardingService } from './tenant-onboarding-service.js';
import { InMemoryLineCredentialStore } from '../security/line-credential-store.js';
import { StubLineAuthClient } from '../line/line-auth-client.js';
import { UnauthorizedError } from '../errors.js';

test('offboarding revokes sessions and records audit events', async () => {
  const now = new Date('2026-02-18T00:00:00.000Z');
  const tenantRepository = new InMemoryTenantRepository();
  const employeeBindingRepository = new InMemoryEmployeeBindingRepository();
  const accessControlRepository = new InMemoryAccessControlRepository();
  const offboardingJobRepository = new InMemoryOffboardingJobRepository();
  const auditEventRepository = new InMemoryAuditEventRepository();

  const onboarding = new TenantOnboardingService(
    tenantRepository,
    new InMemoryLineCredentialStore(),
    new StubLinePlatformClient(),
    {
      publicApiBaseUrl: 'https://api.test',
      now: () => now
    }
  );

  const tenant = await onboarding.createTenant({
    tenantName: 'ACME',
    adminEmail: 'hr@acme.test'
  });

  const invitationService = new InvitationBindingService(
    tenantRepository,
    new InMemoryInvitationRepository(),
    new InMemoryBatchInviteJobRepository(),
    new InMemoryBindingSessionRepository(),
    new InMemoryEmployeeEnrollmentRepository(),
    employeeBindingRepository,
    new StubLineAuthClient(),
    new StubLinePlatformClient(),
    {
      inviteBaseUrl: 'https://app.test/invite',
      sessionTtlMinutes: 10,
      maxBindingAttempts: 5,
      lockoutMinutes: 15,
      now: () => now
    }
  );

  const batch = await invitationService.createBatchInvites({
    tenantId: tenant.tenantId,
    ttlMinutes: 60,
    recipients: [{ email: 'e1@acme.test', employeeId: 'E001' }]
  });

  const recipient = batch.recipients[0];

  const bindingStart = await invitationService.startBinding({
    lineIdToken: 'line-id:U001',
    invitationToken: recipient.invitationToken as string
  });

  const bindingCompleted = await invitationService.completeBinding({
    bindSessionToken: bindingStart.bindSessionToken,
    employeeId: 'E001',
    bindingCode: recipient.oneTimeBindingCode as string
  });

  const authService = new AuthSessionService(
    new InMemoryRefreshSessionRepository(),
    new InMemoryRevokedJtiRepository(),
    employeeBindingRepository,
    {
      issuer: 'one-team-test',
      accessTokenTtlSeconds: 600,
      refreshSessionTtlSeconds: 7 * 24 * 60 * 60,
      accessTokenSecret: 'test-secret',
      now: () => now
    }
  );

  const tokens = await authService.issueEmployeeSession({
    tenantId: bindingCompleted.tenantId,
    employeeId: bindingCompleted.employeeId,
    lineUserId: bindingCompleted.lineUserId
  });

  const service = new OffboardingService(
    employeeBindingRepository,
    accessControlRepository,
    offboardingJobRepository,
    auditEventRepository,
    authService,
    new StubLinePlatformClient(),
    {
      now: () => now,
      maxAttempts: 5,
      backoffBaseSeconds: 30
    }
  );

  const offboard = await service.offboardEmployee({
    tenantId: tenant.tenantId,
    employeeId: 'E001',
    actorId: 'hr-admin'
  });

  assert.equal(offboard.idempotent, false);
  assert.equal(offboard.job.status, 'SUCCEEDED');

  await assert.rejects(
    () => authService.validateAccessToken(tokens.accessToken, tenant.tenantId),
    (error) => {
      assert.ok(error instanceof UnauthorizedError);
      assert.equal(error.message, 'Access token is revoked');
      return true;
    }
  );

  const events = await service.listAuditEvents(tenant.tenantId);
  assert.ok(events.some((event) => event.action === 'EMPLOYEE_OFFBOARDED' && event.outcome === 'SUCCESS'));
  assert.ok(events.some((event) => event.action === 'RICH_MENU_UNLINK' && event.outcome === 'SUCCESS'));
});

test('offboarding schedules retries and fails after max attempts', async () => {
  const now = new Date('2026-02-18T00:00:00.000Z');
  const tenantRepository = new InMemoryTenantRepository();
  const employeeBindingRepository = new InMemoryEmployeeBindingRepository();
  const accessControlRepository = new InMemoryAccessControlRepository();
  const offboardingJobRepository = new InMemoryOffboardingJobRepository();
  const auditEventRepository = new InMemoryAuditEventRepository();

  const onboarding = new TenantOnboardingService(
    tenantRepository,
    new InMemoryLineCredentialStore(),
    new StubLinePlatformClient(),
    {
      publicApiBaseUrl: 'https://api.test',
      now: () => now
    }
  );

  const tenant = await onboarding.createTenant({
    tenantName: 'ACME',
    adminEmail: 'hr@acme.test'
  });

  await employeeBindingRepository.upsert({
    tenantId: tenant.tenantId,
    employeeId: 'E999',
    lineUserId: 'fail-U999',
    boundAt: now.toISOString(),
    employmentStatus: 'ACTIVE'
  });

  const authService = new AuthSessionService(
    new InMemoryRefreshSessionRepository(),
    new InMemoryRevokedJtiRepository(),
    employeeBindingRepository,
    {
      issuer: 'one-team-test',
      accessTokenTtlSeconds: 600,
      refreshSessionTtlSeconds: 7 * 24 * 60 * 60,
      accessTokenSecret: 'test-secret',
      now: () => now
    }
  );

  const service = new OffboardingService(
    employeeBindingRepository,
    accessControlRepository,
    offboardingJobRepository,
    auditEventRepository,
    authService,
    new StubLinePlatformClient(),
    {
      now: () => now,
      maxAttempts: 3,
      backoffBaseSeconds: 30
    }
  );

  const offboard = await service.offboardEmployee({
    tenantId: tenant.tenantId,
    employeeId: 'E999',
    actorId: 'hr-admin'
  });

  assert.equal(offboard.job.status, 'RETRY_SCHEDULED');

  now.setMinutes(now.getMinutes() + 1);
  const retry1 = await service.processOffboardingJob({
    jobId: offboard.job.jobId,
    actorId: 'hr-admin'
  });
  assert.equal(retry1.status, 'RETRY_SCHEDULED');

  now.setMinutes(now.getMinutes() + 2);
  const retry2 = await service.processOffboardingJob({
    jobId: offboard.job.jobId,
    actorId: 'hr-admin'
  });
  assert.equal(retry2.status, 'FAILED');

  const events = await service.listAuditEvents(tenant.tenantId);
  assert.ok(events.some((event) => event.action === 'RICH_MENU_UNLINK' && event.outcome === 'FAILED'));
});
