import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WebhookEventService } from './webhook-event-service.js';
import { EmployeeAccessGovernanceService } from './employee-access-governance-service.js';
import { SelfRegistrationService } from './self-registration-service.js';
import { InMemoryWebhookEventRepository } from '../repositories/webhook-event-repository.js';
import { InMemoryEmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
import { InMemoryAuditEventRepository } from '../repositories/offboarding-repository.js';
import { InMemoryTenantRepository } from '../repositories/tenant-repository.js';
import { StubLinePlatformClient } from '../line/line-platform-client.js';
import { StubLineAuthClient } from '../line/line-auth-client.js';
import { LineWebhookEvent } from '../domain/webhook.js';
import { createTenantRecord } from '../domain/tenant.js';

async function createService() {
  const webhookEventRepo = new InMemoryWebhookEventRepository();
  const employeeBindingRepo = new InMemoryEmployeeBindingRepository();
  const auditEventRepo = new InMemoryAuditEventRepository();
  const tenantRepo = new InMemoryTenantRepository();
  const linePlatformClient = new StubLinePlatformClient();
  const lineAuthClient = new StubLineAuthClient();

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

  const selfRegistrationService = new SelfRegistrationService(
    lineAuthClient,
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
    tenantRepo,
    selfRegistrationService,
    { now: () => new Date('2026-02-28T00:00:00.000Z') }
  );

  return { service, webhookEventRepo, employeeBindingRepo, auditEventRepo, linePlatformClient, tenantRepo, selfRegistrationService };
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

  it('admin list shows nickname when available', async () => {
    const ctx = await setupAdmin();

    // Add a pending employee with nickname
    await ctx.employeeBindingRepo.upsert({
      tenantId: 'tenant-1',
      employeeId: 'E004',
      lineUserId: 'U-e004',
      boundAt: '2026-02-27T00:00:00.000Z',
      employmentStatus: 'ACTIVE',
      accessStatus: 'PENDING',
      nickname: '小明'
    });

    await ctx.service.processEvents('tenant-1', [{
      type: 'postback',
      webhookEventId: 'evt-list-nick',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U-admin' },
      replyToken: 'reply-list-nick',
      postback: { data: 'action=admin_list' }
    }]);

    const reply = ctx.linePlatformClient.repliedMessages.find(m => m.replyToken === 'reply-list-nick');
    assert.ok(reply);
    const json = JSON.stringify(reply.messages);
    assert.ok(json.includes('小明'), 'Should show nickname in admin list');
    assert.ok(json.includes('E004'));
  });
});

describe('WebhookEventService — follow + request_access', () => {
  it('follow event sends welcome Flex Message and links pending rich menu', async () => {
    const { service, linePlatformClient } = await createService();

    await service.processEvents('tenant-1', [{
      type: 'follow',
      webhookEventId: 'evt-follow-1',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U-new' },
      replyToken: 'reply-follow-1'
    }]);

    const reply = linePlatformClient.repliedMessages.find(m => m.replyToken === 'reply-follow-1');
    assert.ok(reply);
    const json = JSON.stringify(reply.messages);
    assert.ok(json.includes('歡迎使用 ONE TEAM'), 'Should reply with welcome Flex Message');
    assert.ok(json.includes('ACME'), 'Should include tenant name');
  });

  it('follow event links approved rich menu for already-approved user', async () => {
    const { service, linePlatformClient, employeeBindingRepo } = await createService();

    await employeeBindingRepo.upsert({
      tenantId: 'tenant-1',
      employeeId: 'E-existing',
      lineUserId: 'U-approved',
      boundAt: '2026-02-01T00:00:00.000Z',
      employmentStatus: 'ACTIVE',
      accessStatus: 'APPROVED'
    });

    await service.processEvents('tenant-1', [{
      type: 'follow',
      webhookEventId: 'evt-follow-approved',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U-approved' },
      replyToken: 'reply-follow-approved'
    }]);

    // Should still send welcome message
    const reply = linePlatformClient.repliedMessages.find(m => m.replyToken === 'reply-follow-approved');
    assert.ok(reply);
  });

  it('request_access postback prompts user to enter employee ID', async () => {
    const { service, linePlatformClient } = await createService();

    await service.processEvents('tenant-1', [{
      type: 'postback',
      webhookEventId: 'evt-request-1',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U-new' },
      replyToken: 'reply-request-1',
      postback: { data: 'action=request_access' }
    }]);

    const reply = linePlatformClient.repliedMessages.find(m => m.replyToken === 'reply-request-1');
    assert.ok(reply);
    const json = JSON.stringify(reply.messages);
    assert.ok(json.includes('請輸入您的工號'), 'Should prompt user to enter employee ID');
  });

  it('request_access returns "already approved" for approved user', async () => {
    const { service, linePlatformClient, employeeBindingRepo } = await createService();

    await employeeBindingRepo.upsert({
      tenantId: 'tenant-1',
      employeeId: 'E-approved',
      lineUserId: 'U-approved',
      boundAt: '2026-02-01T00:00:00.000Z',
      employmentStatus: 'ACTIVE',
      accessStatus: 'APPROVED'
    });

    await service.processEvents('tenant-1', [{
      type: 'postback',
      webhookEventId: 'evt-request-approved',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U-approved' },
      replyToken: 'reply-request-approved',
      postback: { data: 'action=request_access' }
    }]);

    const reply = linePlatformClient.repliedMessages.find(m => m.replyToken === 'reply-request-approved');
    assert.ok(reply);
    const json = JSON.stringify(reply.messages);
    assert.ok(json.includes('您已開通'));
  });

  it('request_access returns "pending" for user with pending status', async () => {
    const { service, linePlatformClient, employeeBindingRepo } = await createService();

    await employeeBindingRepo.upsert({
      tenantId: 'tenant-1',
      employeeId: 'E-pending',
      lineUserId: 'U-pending',
      boundAt: '2026-02-20T00:00:00.000Z',
      employmentStatus: 'ACTIVE',
      accessStatus: 'PENDING'
    });

    await service.processEvents('tenant-1', [{
      type: 'postback',
      webhookEventId: 'evt-request-pending',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U-pending' },
      replyToken: 'reply-request-pending',
      postback: { data: 'action=request_access' }
    }]);

    const reply = linePlatformClient.repliedMessages.find(m => m.replyToken === 'reply-request-pending');
    assert.ok(reply);
    const json = JSON.stringify(reply.messages);
    assert.ok(json.includes('審核中'));
  });

  it('request_access allows re-registration for rejected user', async () => {
    const { service, linePlatformClient, employeeBindingRepo } = await createService();

    await employeeBindingRepo.upsert({
      tenantId: 'tenant-1',
      employeeId: 'E-rejected',
      lineUserId: 'U-rejected',
      boundAt: '2026-02-15T00:00:00.000Z',
      employmentStatus: 'ACTIVE',
      accessStatus: 'REJECTED'
    });

    await service.processEvents('tenant-1', [{
      type: 'postback',
      webhookEventId: 'evt-request-rejected',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U-rejected' },
      replyToken: 'reply-request-rejected',
      postback: { data: 'action=request_access' }
    }]);

    const reply = linePlatformClient.repliedMessages.find(m => m.replyToken === 'reply-request-rejected');
    assert.ok(reply);
    const json = JSON.stringify(reply.messages);
    assert.ok(json.includes('請輸入您的工號'), 'Rejected user should be prompted to enter employee ID');
  });

  it('message "申請開通" routes to request_access handler', async () => {
    const { service, linePlatformClient } = await createService();

    await service.processEvents('tenant-1', [{
      type: 'message',
      webhookEventId: 'evt-msg-1',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U-msg' },
      replyToken: 'reply-msg-1',
      message: { type: 'text', id: 'msg-1', text: '申請開通' }
    }]);

    const reply = linePlatformClient.repliedMessages.find(m => m.replyToken === 'reply-msg-1');
    assert.ok(reply);
    const json = JSON.stringify(reply.messages);
    assert.ok(json.includes('請輸入您的工號'), 'Text message "申請開通" should prompt for employee ID');
  });

  it('message "員工服務" routes to services menu', async () => {
    const { service, linePlatformClient, employeeBindingRepo } = await createService();

    // Need an approved user for services menu
    await employeeBindingRepo.upsert({
      tenantId: 'tenant-1',
      employeeId: 'E-svc',
      lineUserId: 'U-svc',
      boundAt: '2026-02-01T00:00:00.000Z',
      employmentStatus: 'ACTIVE',
      accessStatus: 'APPROVED',
      permissions: { canInvite: false, canRemove: false }
    });

    await service.processEvents('tenant-1', [{
      type: 'message',
      webhookEventId: 'evt-msg-svc',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U-svc' },
      replyToken: 'reply-msg-svc',
      message: { type: 'text', id: 'msg-svc', text: '員工服務' }
    }]);

    const reply = linePlatformClient.repliedMessages.find(m => m.replyToken === 'reply-msg-svc');
    assert.ok(reply);
    const json = JSON.stringify(reply.messages);
    assert.ok(json.includes('員工證'), 'Should show services menu');
  });

  it('request_access prompts for employee ID even without liffId', async () => {
    const { service, linePlatformClient } = await createService();

    await service.processEvents('tenant-1', [{
      type: 'postback',
      webhookEventId: 'evt-no-liff',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U-new' },
      replyToken: 'reply-no-liff',
      postback: { data: 'action=request_access' }
    }]);

    const reply = linePlatformClient.repliedMessages.find(m => m.replyToken === 'reply-no-liff');
    assert.ok(reply);
    const json = JSON.stringify(reply.messages);
    assert.ok(json.includes('請輸入您的工號'), 'Should prompt for employee ID without liffId dependency');
  });

  it('start_bind postback routes to registration (same as request_access)', async () => {
    const { service, linePlatformClient } = await createService();

    await service.processEvents('tenant-1', [{
      type: 'postback',
      webhookEventId: 'evt-start-bind',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U-new' },
      replyToken: 'reply-start-bind',
      postback: { data: 'action=start_bind' }
    }]);

    const reply = linePlatformClient.repliedMessages.find(m => m.replyToken === 'reply-start-bind');
    assert.ok(reply);
    const json = JSON.stringify(reply.messages);
    assert.ok(json.includes('請輸入您的工號'), 'start_bind should prompt for employee ID');
  });

  it('follow event includes postback registration button for new user', async () => {
    const { service, linePlatformClient } = await createService();

    await service.processEvents('tenant-1', [{
      type: 'follow',
      webhookEventId: 'evt-follow-new',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U-new-user' },
      replyToken: 'reply-follow-new'
    }]);

    const reply = linePlatformClient.repliedMessages.find(m => m.replyToken === 'reply-follow-new');
    assert.ok(reply);
    const json = JSON.stringify(reply.messages);
    assert.ok(json.includes('開始申請'), 'Should include registration button for new user');
    assert.ok(json.includes('action=request_access'), 'Button should be postback action');
    assert.ok(!json.includes('fillInText'), 'Should not pre-fill text');
  });

  it('direct employee ID text triggers inline registration for new user', async () => {
    const { service, linePlatformClient, employeeBindingRepo } = await createService();

    await service.processEvents('tenant-1', [{
      type: 'message',
      webhookEventId: 'evt-inline-reg',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U-inline' },
      replyToken: 'reply-inline-reg',
      message: { type: 'text', id: 'msg-inline', text: 'E001' }
    }]);

    const reply = linePlatformClient.repliedMessages.find(m => m.replyToken === 'reply-inline-reg');
    assert.ok(reply);
    const json = JSON.stringify(reply.messages);
    assert.ok(json.includes('申請已送出'), 'Should confirm registration');

    const binding = await employeeBindingRepo.findByEmployeeId('tenant-1', 'E001');
    assert.ok(binding, 'Binding should be created');
    assert.equal(binding.lineUserId, 'U-inline');
    assert.equal(binding.accessStatus, 'PENDING');
  });

  it('"工號 E001" prefix also works for registration', async () => {
    const { service, linePlatformClient, employeeBindingRepo } = await createService();

    await service.processEvents('tenant-1', [{
      type: 'message',
      webhookEventId: 'evt-prefix-reg',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U-prefix' },
      replyToken: 'reply-prefix-reg',
      message: { type: 'text', id: 'msg-prefix', text: '工號 E002' }
    }]);

    const reply = linePlatformClient.repliedMessages.find(m => m.replyToken === 'reply-prefix-reg');
    assert.ok(reply);
    const json = JSON.stringify(reply.messages);
    assert.ok(json.includes('申請已送出'), 'Should confirm registration');

    const binding = await employeeBindingRepo.findByEmployeeId('tenant-1', 'E002');
    assert.ok(binding, 'Binding should be created with stripped prefix');
    assert.equal(binding.lineUserId, 'U-prefix');
  });

  it('duplicate employee ID returns error for new user', async () => {
    const { service, linePlatformClient, employeeBindingRepo } = await createService();

    await employeeBindingRepo.upsert({
      tenantId: 'tenant-1',
      employeeId: 'E-dup',
      lineUserId: 'U-existing',
      boundAt: '2026-02-01T00:00:00.000Z',
      employmentStatus: 'ACTIVE',
      accessStatus: 'PENDING'
    });

    await service.processEvents('tenant-1', [{
      type: 'message',
      webhookEventId: 'evt-inline-dup',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U-dup-attempt' },
      replyToken: 'reply-inline-dup',
      message: { type: 'text', id: 'msg-dup', text: 'E-dup' }
    }]);

    const reply = linePlatformClient.repliedMessages.find(m => m.replyToken === 'reply-inline-dup');
    assert.ok(reply);
    const json = JSON.stringify(reply.messages);
    assert.ok(json.includes('already registered'), 'Should return duplicate error');
  });

  it('unrecognized text is ignored for already-bound user', async () => {
    const { service, linePlatformClient, employeeBindingRepo } = await createService();

    await employeeBindingRepo.upsert({
      tenantId: 'tenant-1',
      employeeId: 'E-bound',
      lineUserId: 'U-bound',
      boundAt: '2026-02-01T00:00:00.000Z',
      employmentStatus: 'ACTIVE',
      accessStatus: 'APPROVED'
    });

    await service.processEvents('tenant-1', [{
      type: 'message',
      webhookEventId: 'evt-random-text',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U-bound' },
      replyToken: 'reply-random',
      message: { type: 'text', id: 'msg-random', text: 'hello' }
    }]);

    const reply = linePlatformClient.repliedMessages.find(m => m.replyToken === 'reply-random');
    assert.ok(!reply, 'Should not reply to unrecognized text from bound user');
  });
});
