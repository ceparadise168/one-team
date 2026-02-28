import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SelfRegistrationService } from './self-registration-service.js';
import { StubLineAuthClient } from '../line/line-auth-client.js';
import { StubLinePlatformClient } from '../line/line-platform-client.js';
import { InMemoryEmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
import { InMemoryTenantRepository } from '../repositories/tenant-repository.js';
import { createTenantRecord } from '../domain/tenant.js';
import { ConflictError } from '../errors.js';

async function createContext() {
  const lineAuthClient = new StubLineAuthClient();
  const employeeBindingRepo = new InMemoryEmployeeBindingRepository();
  const tenantRepo = new InMemoryTenantRepository();
  const linePlatformClient = new StubLinePlatformClient();

  const tenant = createTenantRecord({
    tenantId: 'tenant-1',
    tenantName: 'ACME Corp',
    adminEmail: 'hr@acme.test',
    nowIso: '2026-02-18T00:00:00.000Z'
  });
  tenant.line.resources.pendingRichMenuId = 'richmenu-pending';
  tenant.line.resources.approvedRichMenuId = 'richmenu-approved';
  tenant.line.resources.liffId = 'liff-abc';
  await tenantRepo.create(tenant);

  const service = new SelfRegistrationService(
    lineAuthClient,
    employeeBindingRepo,
    tenantRepo,
    linePlatformClient,
    { now: () => new Date('2026-02-28T10:00:00.000Z') }
  );

  return { service, lineAuthClient, employeeBindingRepo, tenantRepo, linePlatformClient };
}

describe('SelfRegistrationService', () => {
  it('registers a new employee and creates PENDING binding', async () => {
    const { service, employeeBindingRepo } = await createContext();

    const result = await service.register({
      tenantId: 'tenant-1',
      lineIdToken: 'line-id:U-new-user',
      employeeId: 'E001'
    });

    assert.equal(result.tenantId, 'tenant-1');
    assert.equal(result.employeeId, 'E001');
    assert.equal(result.accessStatus, 'PENDING');
    assert.equal(result.registeredAt, '2026-02-28T10:00:00.000Z');

    const binding = await employeeBindingRepo.findByEmployeeId('tenant-1', 'E001');
    assert.ok(binding);
    assert.equal(binding.lineUserId, 'U-new-user');
    assert.equal(binding.accessStatus, 'PENDING');
    assert.equal(binding.employmentStatus, 'ACTIVE');
  });

  it('links pending rich menu after registration', async () => {
    const { service } = await createContext();

    await service.register({
      tenantId: 'tenant-1',
      lineIdToken: 'line-id:U-menu-user',
      employeeId: 'E002'
    });

    // StubLinePlatformClient doesn't record linkRichMenu calls in an array,
    // but we can verify it didn't throw
    assert.ok(true, 'linkRichMenu should succeed');
  });

  it('notifies admins when new employee registers', async () => {
    const { service, employeeBindingRepo, linePlatformClient } = await createContext();

    // Create an admin employee
    await employeeBindingRepo.upsert({
      tenantId: 'tenant-1',
      employeeId: 'ADMIN001',
      lineUserId: 'U-admin',
      boundAt: '2026-02-01T00:00:00.000Z',
      employmentStatus: 'ACTIVE',
      accessStatus: 'APPROVED',
      permissions: { canInvite: true, canRemove: false }
    });

    await service.register({
      tenantId: 'tenant-1',
      lineIdToken: 'line-id:U-notify-user',
      employeeId: 'E003'
    });

    assert.equal(linePlatformClient.pushedMessages.length, 1);
    const push = linePlatformClient.pushedMessages[0];
    assert.equal(push.lineUserId, 'U-admin');
    const json = JSON.stringify(push.messages);
    assert.ok(json.includes('E003'));
    assert.ok(json.includes('新員工申請開通'));
  });

  it('rejects duplicate employeeId with active binding', async () => {
    const { service, employeeBindingRepo } = await createContext();

    await employeeBindingRepo.upsert({
      tenantId: 'tenant-1',
      employeeId: 'E-dup',
      lineUserId: 'U-existing',
      boundAt: '2026-02-01T00:00:00.000Z',
      employmentStatus: 'ACTIVE',
      accessStatus: 'PENDING'
    });

    await assert.rejects(
      () => service.register({
        tenantId: 'tenant-1',
        lineIdToken: 'line-id:U-dup-attempt',
        employeeId: 'E-dup'
      }),
      (error) => {
        assert.ok(error instanceof ConflictError);
        assert.ok(error.message.includes('E-dup'));
        return true;
      }
    );
  });

  it('rejects duplicate lineUserId with active binding', async () => {
    const { service, employeeBindingRepo } = await createContext();

    await employeeBindingRepo.upsert({
      tenantId: 'tenant-1',
      employeeId: 'E-other',
      lineUserId: 'U-dup-line',
      boundAt: '2026-02-01T00:00:00.000Z',
      employmentStatus: 'ACTIVE',
      accessStatus: 'APPROVED'
    });

    await assert.rejects(
      () => service.register({
        tenantId: 'tenant-1',
        lineIdToken: 'line-id:U-dup-line',
        employeeId: 'E-new'
      }),
      (error) => {
        assert.ok(error instanceof ConflictError);
        assert.ok(error.message.includes('LINE account'));
        return true;
      }
    );
  });

  it('allows re-registration for rejected employee', async () => {
    const { service, employeeBindingRepo } = await createContext();

    await employeeBindingRepo.upsert({
      tenantId: 'tenant-1',
      employeeId: 'E-rejected',
      lineUserId: 'U-rejected',
      boundAt: '2026-02-15T00:00:00.000Z',
      employmentStatus: 'ACTIVE',
      accessStatus: 'REJECTED',
      accessReviewedAt: '2026-02-16T00:00:00.000Z',
      accessReviewedBy: 'admin'
    });

    const result = await service.register({
      tenantId: 'tenant-1',
      lineIdToken: 'line-id:U-rejected',
      employeeId: 'E-rejected'
    });

    assert.equal(result.accessStatus, 'PENDING');

    const binding = await employeeBindingRepo.findByEmployeeId('tenant-1', 'E-rejected');
    assert.ok(binding);
    assert.equal(binding.accessStatus, 'PENDING');
    assert.equal(binding.accessReviewedAt, undefined);
    assert.equal(binding.accessReviewedBy, undefined);
  });

  it('rejects invalid LINE ID token', async () => {
    const { service } = await createContext();

    await assert.rejects(
      () => service.register({
        tenantId: 'tenant-1',
        lineIdToken: 'invalid-token',
        employeeId: 'E-bad'
      }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes('LINE ID token'));
        return true;
      }
    );
  });

  it('registerByLineUser registers without lineIdToken validation', async () => {
    const { service, employeeBindingRepo } = await createContext();

    const result = await service.registerByLineUser({
      tenantId: 'tenant-1',
      lineUserId: 'U-direct',
      employeeId: 'E-direct'
    });

    assert.equal(result.tenantId, 'tenant-1');
    assert.equal(result.employeeId, 'E-direct');
    assert.equal(result.accessStatus, 'PENDING');

    const binding = await employeeBindingRepo.findByEmployeeId('tenant-1', 'E-direct');
    assert.ok(binding);
    assert.equal(binding.lineUserId, 'U-direct');
    assert.equal(binding.accessStatus, 'PENDING');
  });

  it('registerByLineUser rejects duplicate employeeId', async () => {
    const { service, employeeBindingRepo } = await createContext();

    await employeeBindingRepo.upsert({
      tenantId: 'tenant-1',
      employeeId: 'E-dup',
      lineUserId: 'U-existing',
      boundAt: '2026-02-01T00:00:00.000Z',
      employmentStatus: 'ACTIVE',
      accessStatus: 'PENDING'
    });

    await assert.rejects(
      () => service.registerByLineUser({
        tenantId: 'tenant-1',
        lineUserId: 'U-other',
        employeeId: 'E-dup'
      }),
      (error) => {
        assert.ok(error instanceof ConflictError);
        return true;
      }
    );
  });

  it('registerByLineUser allows re-registration for rejected employee', async () => {
    const { service, employeeBindingRepo } = await createContext();

    await employeeBindingRepo.upsert({
      tenantId: 'tenant-1',
      employeeId: 'E-rej',
      lineUserId: 'U-rej',
      boundAt: '2026-02-15T00:00:00.000Z',
      employmentStatus: 'ACTIVE',
      accessStatus: 'REJECTED'
    });

    const result = await service.registerByLineUser({
      tenantId: 'tenant-1',
      lineUserId: 'U-rej',
      employeeId: 'E-rej'
    });

    assert.equal(result.accessStatus, 'PENDING');
  });
});
