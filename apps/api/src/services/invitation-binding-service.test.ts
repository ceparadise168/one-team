import test from 'node:test';
import assert from 'node:assert/strict';
import { StubLineAuthClient } from '../line/line-auth-client.js';
import {
  InMemoryBatchInviteJobRepository,
  InMemoryBindingSessionRepository,
  InMemoryEmployeeBindingRepository,
  InMemoryEmployeeEnrollmentRepository,
  InMemoryInvitationRepository
} from '../repositories/invitation-binding-repository.js';
import { InMemoryTenantRepository } from '../repositories/tenant-repository.js';
import { InMemoryLineCredentialStore } from '../security/line-credential-store.js';
import { TenantOnboardingService } from './tenant-onboarding-service.js';
import { InvitationBindingService } from './invitation-binding-service.js';
import { StubLinePlatformClient } from '../line/line-platform-client.js';
import { ValidationError, ConflictError } from '../errors.js';

test('invitation token expires and cannot start binding', async () => {
  const now = new Date('2026-02-18T00:00:00.000Z');
  const ctx = createTestContext(now);

  const tenant = await ctx.onboarding.createTenant({
    tenantName: 'ACME',
    adminEmail: 'hr@acme.test'
  });

  const invite = await ctx.invitationBinding.createInvitation({
    tenantId: tenant.tenantId,
    ttlMinutes: 1,
    usageLimit: 1
  });

  now.setMinutes(now.getMinutes() + 2);

  await assert.rejects(
    () =>
      ctx.invitationBinding.startBinding({
        lineIdToken: 'line-id:U1000',
        invitationToken: invite.invitationToken
      }),
    (error) => {
      assert.ok(error instanceof ValidationError);
      assert.equal(error.message, 'Invitation token expired');
      return true;
    }
  );
});

test('successful binding consumes invitation usage and returns auth payload', async () => {
  const now = new Date('2026-02-18T00:00:00.000Z');
  const ctx = createTestContext(now);

  const tenant = await ctx.onboarding.createTenant({
    tenantName: 'ACME',
    adminEmail: 'hr@acme.test'
  });

  const batch = await ctx.invitationBinding.createBatchInvites({
    tenantId: tenant.tenantId,
    ttlMinutes: 30,
    recipients: [{ email: 'u1@acme.test', employeeId: 'E001' }]
  });

  const recipient = batch.recipients[0];
  assert.equal(recipient.status, 'SENT');

  const start = await ctx.invitationBinding.startBinding({
    lineIdToken: 'line-id:U1001',
    invitationToken: recipient.invitationToken as string
  });

  const completed = await ctx.invitationBinding.completeBinding({
    bindSessionToken: start.bindSessionToken,
    employeeId: 'E001',
    bindingCode: recipient.oneTimeBindingCode as string
  });

  assert.equal(completed.tenantId, tenant.tenantId);
  assert.equal(completed.employeeId, 'E001');
  assert.equal(completed.lineUserId, 'U1001');
  assert.equal(completed.auth.expiresInSeconds, 600);
});

test('binding is locked for repeated invalid one-time codes', async () => {
  const now = new Date('2026-02-18T00:00:00.000Z');
  const ctx = createTestContext(now);

  const tenant = await ctx.onboarding.createTenant({
    tenantName: 'ACME',
    adminEmail: 'hr@acme.test'
  });

  const batch = await ctx.invitationBinding.createBatchInvites({
    tenantId: tenant.tenantId,
    ttlMinutes: 30,
    recipients: [{ email: 'u2@acme.test', employeeId: 'E002' }]
  });

  const recipient = batch.recipients[0];

  const start = await ctx.invitationBinding.startBinding({
    lineIdToken: 'line-id:U1002',
    invitationToken: recipient.invitationToken as string
  });

  for (let i = 0; i < 5; i += 1) {
    await assert.rejects(
      () =>
        ctx.invitationBinding.completeBinding({
          bindSessionToken: start.bindSessionToken,
          employeeId: 'E002',
          bindingCode: '00000000'
        }),
      ValidationError
    );
  }

  await assert.rejects(
    () =>
      ctx.invitationBinding.completeBinding({
        bindSessionToken: start.bindSessionToken,
        employeeId: 'E002',
        bindingCode: recipient.oneTimeBindingCode as string
      }),
    (error) => {
      assert.ok(error instanceof ValidationError);
      assert.equal(error.message, 'Binding is temporarily locked due to repeated failures');
      return true;
    }
  );
});

test('duplicate employee binding is rejected', async () => {
  const now = new Date('2026-02-18T00:00:00.000Z');
  const ctx = createTestContext(now);

  const tenant = await ctx.onboarding.createTenant({
    tenantName: 'ACME',
    adminEmail: 'hr@acme.test'
  });

  const firstBatch = await ctx.invitationBinding.createBatchInvites({
    tenantId: tenant.tenantId,
    ttlMinutes: 30,
    recipients: [{ email: 'u3@acme.test', employeeId: 'E003' }]
  });

  const firstRecipient = firstBatch.recipients[0];

  const firstStart = await ctx.invitationBinding.startBinding({
    lineIdToken: 'line-id:U2001',
    invitationToken: firstRecipient.invitationToken as string
  });

  await ctx.invitationBinding.completeBinding({
    bindSessionToken: firstStart.bindSessionToken,
    employeeId: 'E003',
    bindingCode: firstRecipient.oneTimeBindingCode as string
  });

  const secondBatch = await ctx.invitationBinding.createBatchInvites({
    tenantId: tenant.tenantId,
    ttlMinutes: 30,
    recipients: [{ email: 'u4@acme.test', employeeId: 'E003' }]
  });

  const secondRecipient = secondBatch.recipients[0];

  const secondStart = await ctx.invitationBinding.startBinding({
    lineIdToken: 'line-id:U2002',
    invitationToken: secondRecipient.invitationToken as string
  });

  await assert.rejects(
    () =>
      ctx.invitationBinding.completeBinding({
        bindSessionToken: secondStart.bindSessionToken,
        employeeId: 'E003',
        bindingCode: secondRecipient.oneTimeBindingCode as string
      }),
    (error) => {
      assert.ok(error instanceof ConflictError);
      assert.equal(error.message, 'Employee identity is already bound to another LINE account');
      return true;
    }
  );
});

function createTestContext(now: Date): {
  onboarding: TenantOnboardingService;
  invitationBinding: InvitationBindingService;
} {
  const tenantRepository = new InMemoryTenantRepository();

  const onboarding = new TenantOnboardingService(
    tenantRepository,
    new InMemoryLineCredentialStore(),
    new StubLinePlatformClient(),
    {
      publicApiBaseUrl: 'https://api.test',
      now: () => now
    }
  );

  const invitationBinding = new InvitationBindingService(
    tenantRepository,
    new InMemoryInvitationRepository(),
    new InMemoryBatchInviteJobRepository(),
    new InMemoryBindingSessionRepository(),
    new InMemoryEmployeeEnrollmentRepository(),
    new InMemoryEmployeeBindingRepository(),
    new StubLineAuthClient(),
    {
      inviteBaseUrl: 'https://app.test/invite',
      sessionTtlMinutes: 10,
      maxBindingAttempts: 5,
      lockoutMinutes: 15,
      now: () => now
    }
  );

  return {
    onboarding,
    invitationBinding
  };
}
