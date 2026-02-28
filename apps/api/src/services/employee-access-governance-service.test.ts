import test from 'node:test';
import assert from 'node:assert/strict';
import { createTenantRecord } from '../domain/tenant.js';
import { ForbiddenError } from '../errors.js';
import { LinePlatformClient } from '../line/line-platform-client.js';
import { InMemoryEmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
import { InMemoryTenantRepository } from '../repositories/tenant-repository.js';
import { EmployeeAccessGovernanceService } from './employee-access-governance-service.js';

interface PushedMessage {
  tenantId: string;
  lineUserId: string;
  messages: Array<{ type: string; altText?: string; text?: string; contents?: unknown }>;
}

class CapturingLinePlatformClient implements LinePlatformClient {
  readonly linkedMenus: Array<{ tenantId: string; lineUserId: string; richMenuId: string }> = [];
  readonly pushedMessages: PushedMessage[] = [];

  async validateChannelCredentials(channelId: string, channelSecret: string): Promise<void> {
    void channelId;
    void channelSecret;
  }

  async provisionResources(input: {
    tenantId: string;
    channelId: string;
    existingResources?: {
      liffId?: string;
      richMenuId?: string;
      pendingRichMenuId?: string;
      approvedRichMenuId?: string;
      webhookId?: string;
      webhookUrl?: string;
    };
    webhookUrl: string;
  }): Promise<{
    liffId?: string;
    richMenuId?: string;
    pendingRichMenuId?: string;
    approvedRichMenuId?: string;
    webhookId?: string;
    webhookUrl?: string;
  }> {
    void input;
    return {};
  }

  async verifyWebhookToken(token: string): Promise<boolean> {
    void token;
    return true;
  }

  async linkRichMenu(input: { tenantId: string; lineUserId: string; richMenuId: string }): Promise<void> {
    this.linkedMenus.push(input);
  }

  async unlinkRichMenu(input: { tenantId: string; lineUserId: string }): Promise<void> {
    void input;
  }

  async pushMessage(input: PushedMessage): Promise<void> {
    this.pushedMessages.push(input);
  }
  async replyMessage(): Promise<void> {}
}

test('submit access request keeps pending state and links pending menu', async () => {
  const tenantRepository = new InMemoryTenantRepository();
  await tenantRepository.create(
    createTenantRecord({
      tenantId: 'tenant_a',
      tenantName: 'ACME',
      adminEmail: 'hr@acme.test',
      nowIso: '2026-02-18T00:00:00.000Z'
    })
  );

  const tenant = await tenantRepository.findById('tenant_a');
  if (!tenant) {
    throw new Error('tenant not found');
  }
  tenant.line.resources.pendingRichMenuId = 'richmenu-pending-a';
  tenant.line.resources.approvedRichMenuId = 'richmenu-approved-a';
  tenant.line.resources.richMenuId = 'richmenu-approved-a';
  await tenantRepository.save(tenant);

  const bindingRepository = new InMemoryEmployeeBindingRepository();
  await bindingRepository.upsert({
    tenantId: 'tenant_a',
    employeeId: 'E001',
    lineUserId: 'U001',
    boundAt: '2026-02-18T00:00:00.000Z',
    employmentStatus: 'ACTIVE'
  });

  const linePlatformClient = new CapturingLinePlatformClient();
  const service = new EmployeeAccessGovernanceService(
    bindingRepository,
    tenantRepository,
    linePlatformClient,
    {
      now: () => new Date('2026-02-18T00:05:00.000Z')
    }
  );

  const profile = await service.submitAccessRequestByLineUser({
    tenantId: 'tenant_a',
    lineUserId: 'U001'
  });

  assert.equal(profile.accessStatus, 'PENDING');
  assert.equal(profile.permissions.canInvite, false);
  assert.equal(profile.permissions.canRemove, false);
  assert.equal(linePlatformClient.linkedMenus.at(-1)?.richMenuId, 'richmenu-pending-a');
});

test('approve access grants permissions and permission guard is enforced', async () => {
  const tenantRepository = new InMemoryTenantRepository();
  await tenantRepository.create(
    createTenantRecord({
      tenantId: 'tenant_b',
      tenantName: 'ACME',
      adminEmail: 'hr@acme.test',
      nowIso: '2026-02-18T00:00:00.000Z'
    })
  );

  const tenant = await tenantRepository.findById('tenant_b');
  if (!tenant) {
    throw new Error('tenant not found');
  }
  tenant.line.resources.pendingRichMenuId = 'richmenu-pending-b';
  tenant.line.resources.approvedRichMenuId = 'richmenu-approved-b';
  tenant.line.resources.richMenuId = 'richmenu-approved-b';
  await tenantRepository.save(tenant);

  const bindingRepository = new InMemoryEmployeeBindingRepository();
  await bindingRepository.upsert({
    tenantId: 'tenant_b',
    employeeId: 'E002',
    lineUserId: 'U002',
    boundAt: '2026-02-18T00:00:00.000Z',
    employmentStatus: 'ACTIVE'
  });

  const linePlatformClient = new CapturingLinePlatformClient();
  const service = new EmployeeAccessGovernanceService(
    bindingRepository,
    tenantRepository,
    linePlatformClient,
    {
      now: () => new Date('2026-02-18T00:10:00.000Z')
    }
  );

  await service.submitAccessRequestByLineUser({
    tenantId: 'tenant_b',
    lineUserId: 'U002'
  });

  const approved = await service.decideAccess({
    tenantId: 'tenant_b',
    employeeId: 'E002',
    reviewerId: 'hr-admin',
    decision: 'APPROVE',
    permissions: {
      canInvite: true,
      canRemove: false
    }
  });

  assert.equal(approved.accessStatus, 'APPROVED');
  assert.equal(approved.permissions.canInvite, true);
  assert.equal(approved.permissions.canRemove, false);
  assert.equal(linePlatformClient.linkedMenus.at(-1)?.richMenuId, 'richmenu-approved-b');

  // Verify push notification sent to employee
  assert.equal(linePlatformClient.pushedMessages.length, 1);
  const pushMsg = linePlatformClient.pushedMessages[0];
  assert.equal(pushMsg.lineUserId, 'U002');
  const pushJson = JSON.stringify(pushMsg.messages);
  assert.ok(pushJson.includes('存取申請已通過'), 'Should notify employee of approval');

  await service.requireEmployeePermission({
    tenantId: 'tenant_b',
    lineUserId: 'U002',
    permission: 'canInvite'
  });

  await assert.rejects(
    () =>
      service.requireEmployeePermission({
        tenantId: 'tenant_b',
        lineUserId: 'U002',
        permission: 'canRemove'
      }),
    (error) => {
      assert.ok(error instanceof ForbiddenError);
      assert.equal(error.message, 'Employee missing permission: canRemove');
      return true;
    }
  );
});

test('reject access decision resets permissions and links pending menu', async () => {
  const tenantRepository = new InMemoryTenantRepository();
  await tenantRepository.create(
    createTenantRecord({
      tenantId: 'tenant_c',
      tenantName: 'ACME',
      adminEmail: 'hr@acme.test',
      nowIso: '2026-02-18T00:00:00.000Z'
    })
  );

  const tenant = await tenantRepository.findById('tenant_c');
  if (!tenant) {
    throw new Error('tenant not found');
  }
  tenant.line.resources.pendingRichMenuId = 'richmenu-pending-c';
  tenant.line.resources.approvedRichMenuId = 'richmenu-approved-c';
  tenant.line.resources.richMenuId = 'richmenu-approved-c';
  await tenantRepository.save(tenant);

  const bindingRepository = new InMemoryEmployeeBindingRepository();
  await bindingRepository.upsert({
    tenantId: 'tenant_c',
    employeeId: 'E003',
    lineUserId: 'U003',
    boundAt: '2026-02-18T00:00:00.000Z',
    employmentStatus: 'ACTIVE'
  });

  const linePlatformClient = new CapturingLinePlatformClient();
  const service = new EmployeeAccessGovernanceService(
    bindingRepository,
    tenantRepository,
    linePlatformClient,
    {
      now: () => new Date('2026-02-18T00:20:00.000Z')
    }
  );

  const rejected = await service.decideAccess({
    tenantId: 'tenant_c',
    employeeId: 'E003',
    reviewerId: 'hr-admin',
    decision: 'REJECT'
  });

  assert.equal(rejected.accessStatus, 'REJECTED');
  assert.equal(rejected.permissions.canInvite, false);
  assert.equal(rejected.permissions.canRemove, false);
  assert.equal(linePlatformClient.linkedMenus.at(-1)?.richMenuId, 'richmenu-pending-c');

  // Verify push notification sent to employee
  assert.equal(linePlatformClient.pushedMessages.length, 1);
  const pushMsg = linePlatformClient.pushedMessages[0];
  assert.equal(pushMsg.lineUserId, 'U003');
  const pushJson = JSON.stringify(pushMsg.messages);
  assert.ok(pushJson.includes('存取申請未通過'), 'Should notify employee of rejection');
});
