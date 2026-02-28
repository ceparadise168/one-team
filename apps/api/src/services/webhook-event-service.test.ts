import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WebhookEventService } from './webhook-event-service.js';
import { EmployeeAccessGovernanceService } from './employee-access-governance-service.js';
import { InMemoryWebhookEventRepository } from '../repositories/webhook-event-repository.js';
import { InMemoryEmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
import { InMemoryAuditEventRepository } from '../repositories/offboarding-repository.js';
import { InMemoryTenantRepository } from '../repositories/tenant-repository.js';
import { StubLinePlatformClient } from '../line/line-platform-client.js';
import { LineWebhookEvent } from '../domain/webhook.js';
import { createTenantRecord } from '../domain/tenant.js';

async function createService() {
  const webhookEventRepo = new InMemoryWebhookEventRepository();
  const employeeBindingRepo = new InMemoryEmployeeBindingRepository();
  const auditEventRepo = new InMemoryAuditEventRepository();
  const tenantRepo = new InMemoryTenantRepository();
  const linePlatformClient = new StubLinePlatformClient();

  const tenant = createTenantRecord({
    tenantId: 'tenant-1',
    tenantName: 'ACME',
    adminEmail: 'hr@acme.test',
    nowIso: '2026-02-18T00:00:00.000Z'
  });
  tenant.line.resources.pendingRichMenuId = 'richmenu-pending';
  tenant.line.resources.approvedRichMenuId = 'richmenu-approved';
  tenant.line.resources.richMenuId = 'richmenu-approved';
  await tenantRepo.create(tenant);

  const accessGovernanceService = new EmployeeAccessGovernanceService(
    employeeBindingRepo,
    tenantRepo,
    linePlatformClient,
    { now: () => new Date('2026-02-28T00:00:00.000Z') }
  );

  const service = new WebhookEventService(
    webhookEventRepo,
    employeeBindingRepo,
    auditEventRepo,
    linePlatformClient,
    accessGovernanceService,
    { now: () => new Date('2026-02-28T00:00:00.000Z') }
  );

  return { service, webhookEventRepo, employeeBindingRepo, auditEventRepo, linePlatformClient, tenantRepo };
}

describe('WebhookEventService', () => {
  it('processes follow event with idempotency', async () => {
    const { service } = await createService();

    const events: LineWebhookEvent[] = [
      {
        type: 'follow',
        webhookEventId: 'evt-1',
        timestamp: Date.now(),
        source: { type: 'user', userId: 'U123' },
        replyToken: 'reply-1'
      }
    ];

    const result1 = await service.processEvents('tenant-1', events);
    assert.equal(result1.processed, 1);
    assert.equal(result1.skipped, 0);

    const result2 = await service.processEvents('tenant-1', events);
    assert.equal(result2.processed, 0);
    assert.equal(result2.skipped, 1);
  });

  it('processes unfollow event and marks disconnected', async () => {
    const { service, employeeBindingRepo, auditEventRepo } = await createService();

    await employeeBindingRepo.upsert({
      tenantId: 'tenant-1',
      employeeId: 'emp-1',
      lineUserId: 'U123',
      boundAt: '2025-01-01T00:00:00.000Z',
      employmentStatus: 'ACTIVE'
    });

    const events: LineWebhookEvent[] = [
      {
        type: 'unfollow',
        webhookEventId: 'evt-2',
        timestamp: Date.now(),
        source: { type: 'user', userId: 'U123' }
      }
    ];

    const result = await service.processEvents('tenant-1', events);
    assert.equal(result.processed, 1);

    const binding = await employeeBindingRepo.findActiveByLineUserId('tenant-1', 'U123');
    assert.ok(binding?.lineDisconnectedAt);

    const auditEvents = await auditEventRepo.listByTenant('tenant-1');
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0].action, 'LINE_UNFOLLOWED');
  });

  it('skips events without webhookEventId', async () => {
    const { service } = await createService();

    const events: LineWebhookEvent[] = [
      {
        type: 'follow',
        webhookEventId: '',
        timestamp: Date.now(),
        source: { type: 'user', userId: 'U123' },
        replyToken: 'reply-1'
      }
    ];

    const result = await service.processEvents('tenant-1', events);
    assert.equal(result.skipped, 1);
    assert.equal(result.processed, 0);
  });

  it('processes postback event', async () => {
    const { service } = await createService();

    const events: LineWebhookEvent[] = [
      {
        type: 'postback',
        webhookEventId: 'evt-3',
        timestamp: Date.now(),
        source: { type: 'user', userId: 'U123' },
        replyToken: 'reply-3',
        postback: { data: 'action=open_liff&url=https://liff.example.com' }
      }
    ];

    const result = await service.processEvents('tenant-1', events);
    assert.equal(result.processed, 1);
  });
});

describe('WebhookEventService — admin features', () => {
  async function setupAdmin() {
    const ctx = await createService();

    // Create admin employee (APPROVED with canInvite)
    await ctx.employeeBindingRepo.upsert({
      tenantId: 'tenant-1',
      employeeId: 'ADMIN001',
      lineUserId: 'U-admin',
      boundAt: '2026-02-01T00:00:00.000Z',
      employmentStatus: 'ACTIVE',
      accessStatus: 'APPROVED',
      permissions: { canInvite: true, canRemove: false }
    });

    // Create some pending employees
    await ctx.employeeBindingRepo.upsert({
      tenantId: 'tenant-1',
      employeeId: 'E001',
      lineUserId: 'U-e001',
      boundAt: '2026-02-25T00:00:00.000Z',
      employmentStatus: 'ACTIVE',
      accessStatus: 'PENDING'
    });

    await ctx.employeeBindingRepo.upsert({
      tenantId: 'tenant-1',
      employeeId: 'E002',
      lineUserId: 'U-e002',
      boundAt: '2026-02-26T00:00:00.000Z',
      employmentStatus: 'ACTIVE',
      accessStatus: 'PENDING'
    });

    // Create an approved employee
    await ctx.employeeBindingRepo.upsert({
      tenantId: 'tenant-1',
      employeeId: 'E003',
      lineUserId: 'U-e003',
      boundAt: '2026-02-20T00:00:00.000Z',
      employmentStatus: 'ACTIVE',
      accessStatus: 'APPROVED',
      permissions: { canInvite: false, canRemove: false }
    });

    return ctx;
  }

  it('admin sees "管理後台" in services menu, non-admin does not', async () => {
    const { service, linePlatformClient } = await setupAdmin();

    // Admin taps services_menu
    await service.processEvents('tenant-1', [{
      type: 'postback',
      webhookEventId: 'evt-svc-admin',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U-admin' },
      replyToken: 'reply-svc-admin',
      postback: { data: 'action=services_menu' }
    }]);

    const adminReply = linePlatformClient.repliedMessages.find(m => m.replyToken === 'reply-svc-admin');
    assert.ok(adminReply);
    const adminJson = JSON.stringify(adminReply.messages);
    assert.ok(adminJson.includes('管理後台'), 'Admin should see 管理後台 bubble');

    // Non-admin taps services_menu
    await service.processEvents('tenant-1', [{
      type: 'postback',
      webhookEventId: 'evt-svc-user',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U-e003' },
      replyToken: 'reply-svc-user',
      postback: { data: 'action=services_menu' }
    }]);

    const userReply = linePlatformClient.repliedMessages.find(m => m.replyToken === 'reply-svc-user');
    assert.ok(userReply);
    const userJson = JSON.stringify(userReply.messages);
    assert.ok(!userJson.includes('管理後台'), 'Non-admin should NOT see 管理後台 bubble');
  });

  it('admin dashboard shows correct stats', async () => {
    const { service, linePlatformClient } = await setupAdmin();

    await service.processEvents('tenant-1', [{
      type: 'postback',
      webhookEventId: 'evt-dash',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U-admin' },
      replyToken: 'reply-dash',
      postback: { data: 'action=admin_dashboard' }
    }]);

    const reply = linePlatformClient.repliedMessages.find(m => m.replyToken === 'reply-dash');
    assert.ok(reply);
    const json = JSON.stringify(reply.messages);
    assert.ok(json.includes('管理後台'));
    assert.ok(json.includes('查看待審核'));
  });

  it('admin list shows pending employees', async () => {
    const { service, linePlatformClient } = await setupAdmin();

    await service.processEvents('tenant-1', [{
      type: 'postback',
      webhookEventId: 'evt-list',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U-admin' },
      replyToken: 'reply-list',
      postback: { data: 'action=admin_list' }
    }]);

    const reply = linePlatformClient.repliedMessages.find(m => m.replyToken === 'reply-list');
    assert.ok(reply);
    const json = JSON.stringify(reply.messages);
    assert.ok(json.includes('E001'));
    assert.ok(json.includes('E002'));
    assert.ok(!json.includes('E003'), 'Approved employee should not appear in pending list');
  });

  it('admin approve works and calls decideAccess', async () => {
    const { service, linePlatformClient, employeeBindingRepo } = await setupAdmin();

    await service.processEvents('tenant-1', [{
      type: 'postback',
      webhookEventId: 'evt-approve',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U-admin' },
      replyToken: 'reply-approve',
      postback: { data: 'action=admin_approve&eid=E001' }
    }]);

    const reply = linePlatformClient.repliedMessages.find(m => m.replyToken === 'reply-approve');
    assert.ok(reply);
    const json = JSON.stringify(reply.messages);
    assert.ok(json.includes('已核准'));
    assert.ok(json.includes('E001'));

    // Verify the binding was updated
    const binding = await employeeBindingRepo.findByEmployeeId('tenant-1', 'E001');
    assert.equal(binding?.accessStatus, 'APPROVED');
  });

  it('admin reject works and calls decideAccess', async () => {
    const { service, linePlatformClient, employeeBindingRepo } = await setupAdmin();

    await service.processEvents('tenant-1', [{
      type: 'postback',
      webhookEventId: 'evt-reject',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U-admin' },
      replyToken: 'reply-reject',
      postback: { data: 'action=admin_reject&eid=E002' }
    }]);

    const reply = linePlatformClient.repliedMessages.find(m => m.replyToken === 'reply-reject');
    assert.ok(reply);
    const json = JSON.stringify(reply.messages);
    assert.ok(json.includes('已拒絕'));
    assert.ok(json.includes('E002'));

    const binding = await employeeBindingRepo.findByEmployeeId('tenant-1', 'E002');
    assert.equal(binding?.accessStatus, 'REJECTED');
  });

  it('non-admin gets permission error for admin actions', async () => {
    const { service, linePlatformClient } = await setupAdmin();

    // Non-admin (E003, approved but no admin perms) tries admin_dashboard
    await service.processEvents('tenant-1', [{
      type: 'postback',
      webhookEventId: 'evt-nonadmin-dash',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U-e003' },
      replyToken: 'reply-nonadmin-dash',
      postback: { data: 'action=admin_dashboard' }
    }]);

    const reply = linePlatformClient.repliedMessages.find(m => m.replyToken === 'reply-nonadmin-dash');
    assert.ok(reply);
    const json = JSON.stringify(reply.messages);
    assert.ok(json.includes('您沒有管理權限'));
  });
});
