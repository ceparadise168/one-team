import { LineWebhookEvent, parsePostbackData } from '../domain/webhook.js';
import {
  buildServicesMenuFlexMessage,
  buildAdminDashboardFlexMessage,
  buildPendingEmployeesCarouselFlexMessage,
  buildAdminActionResultFlexMessage
} from '../line/flex-message-templates.js';
import { LinePlatformClient } from '../line/line-platform-client.js';
import { EmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
import { AuditEventRepository } from '../repositories/offboarding-repository.js';
import { WebhookEventRepository } from '../repositories/webhook-event-repository.js';
import { EmployeeAccessGovernanceService } from './employee-access-governance-service.js';
import { randomUUID } from 'node:crypto';

export interface WebhookEventServiceOptions {
  now: () => Date;
}

export class WebhookEventService {
  constructor(
    private readonly webhookEventRepository: WebhookEventRepository,
    private readonly employeeBindingRepository: EmployeeBindingRepository,
    private readonly auditEventRepository: AuditEventRepository,
    private readonly linePlatformClient: LinePlatformClient,
    private readonly accessGovernanceService: EmployeeAccessGovernanceService,
    private readonly options: WebhookEventServiceOptions = { now: () => new Date() }
  ) {}

  async processEvents(tenantId: string, events: LineWebhookEvent[]): Promise<{ processed: number; skipped: number }> {
    let processed = 0;
    let skipped = 0;

    for (const event of events) {
      if (!event.webhookEventId) {
        skipped += 1;
        continue;
      }

      const alreadyProcessed = await this.webhookEventRepository.isProcessed(event.webhookEventId);
      if (alreadyProcessed) {
        skipped += 1;
        continue;
      }

      await this.handleEvent(tenantId, event);
      await this.webhookEventRepository.markProcessed(
        event.webhookEventId,
        Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
      );

      processed += 1;
    }

    return { processed, skipped };
  }

  private async handleEvent(tenantId: string, event: LineWebhookEvent): Promise<void> {
    switch (event.type) {
      case 'follow':
        await this.handleFollow(tenantId, event);
        break;
      case 'unfollow':
        await this.handleUnfollow(tenantId, event);
        break;
      case 'postback':
        await this.handlePostback(tenantId, event);
        break;
      default:
        break;
    }
  }

  private async handleFollow(tenantId: string, event: LineWebhookEvent): Promise<void> {
    const lineUserId = event.source.userId;
    if (!lineUserId) return;

    if (event.replyToken) {
      await this.linePlatformClient.replyMessage({
        tenantId,
        replyToken: event.replyToken,
        messages: [
          {
            type: 'text',
            text: '歡迎加入！請點選下方選單開始綁定您的員工身份。'
          }
        ]
      });
    }
  }

  private async handleUnfollow(tenantId: string, event: LineWebhookEvent): Promise<void> {
    const lineUserId = event.source.userId;
    if (!lineUserId) return;

    const binding = await this.employeeBindingRepository.findActiveByLineUserId(tenantId, lineUserId);
    if (binding) {
      binding.lineDisconnectedAt = this.options.now().toISOString();
      await this.employeeBindingRepository.upsert(binding);

      await this.auditEventRepository.append({
        eventId: `audit_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        tenantId,
        employeeId: binding.employeeId,
        actorId: lineUserId,
        action: 'LINE_UNFOLLOWED',
        outcome: 'SUCCESS',
        message: `LINE user ${lineUserId} unfollowed the bot`,
        createdAt: this.options.now().toISOString()
      });
    }
  }

  private async handlePostback(tenantId: string, event: LineWebhookEvent): Promise<void> {
    const lineUserId = event.source.userId;
    if (!lineUserId || !event.postback?.data) return;

    const parsed = parsePostbackData(event.postback.data);

    switch (parsed.action) {
      case 'services_menu':
        await this.handleServicesMenu(tenantId, event);
        return;
      case 'admin_dashboard':
        await this.handleAdminDashboard(tenantId, event);
        return;
      case 'admin_list':
        await this.handleAdminList(tenantId, event);
        return;
      case 'admin_approve':
        await this.handleAdminAction('APPROVE', tenantId, event, parsed.employeeId);
        return;
      case 'admin_reject':
        await this.handleAdminAction('REJECT', tenantId, event, parsed.employeeId);
        return;
      default:
        break;
    }

    if (event.replyToken) {
      await this.linePlatformClient.replyMessage({
        tenantId,
        replyToken: event.replyToken,
        messages: [
          {
            type: 'text',
            text: '已收到您的操作。'
          }
        ]
      });
    }
  }

  private async handleServicesMenu(tenantId: string, event: LineWebhookEvent): Promise<void> {
    const lineUserId = event.source.userId;
    if (!lineUserId || !event.replyToken) return;

    const isAdmin = await this.checkAdminPermission(tenantId, lineUserId);

    await this.linePlatformClient.replyMessage({
      tenantId,
      replyToken: event.replyToken,
      messages: [buildServicesMenuFlexMessage({ isAdmin })]
    });
  }

  private async handleAdminDashboard(tenantId: string, event: LineWebhookEvent): Promise<void> {
    const lineUserId = event.source.userId;
    if (!lineUserId || !event.replyToken) return;

    const isAdmin = await this.checkAdminPermission(tenantId, lineUserId);
    if (!isAdmin) {
      await this.linePlatformClient.replyMessage({
        tenantId,
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '您沒有管理權限。' }]
      });
      return;
    }

    const bindings = await this.employeeBindingRepository.listByTenant(tenantId);
    let pending = 0;
    let approved = 0;
    let rejected = 0;

    for (const b of bindings) {
      switch (b.accessStatus) {
        case 'APPROVED': approved += 1; break;
        case 'REJECTED': rejected += 1; break;
        default: pending += 1; break;
      }
    }

    await this.linePlatformClient.replyMessage({
      tenantId,
      replyToken: event.replyToken,
      messages: [buildAdminDashboardFlexMessage({ pending, approved, rejected, total: bindings.length })]
    });
  }

  private async handleAdminList(tenantId: string, event: LineWebhookEvent): Promise<void> {
    const lineUserId = event.source.userId;
    if (!lineUserId || !event.replyToken) return;

    const isAdmin = await this.checkAdminPermission(tenantId, lineUserId);
    if (!isAdmin) {
      await this.linePlatformClient.replyMessage({
        tenantId,
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '您沒有管理權限。' }]
      });
      return;
    }

    const bindings = await this.employeeBindingRepository.listByTenant(tenantId);
    const pendingBindings = bindings
      .filter(b => (b.accessStatus ?? 'PENDING') === 'PENDING' && b.employmentStatus === 'ACTIVE')
      .slice(0, 10)
      .map(b => ({ employeeId: b.employeeId, boundAt: b.boundAt }));

    await this.linePlatformClient.replyMessage({
      tenantId,
      replyToken: event.replyToken,
      messages: [buildPendingEmployeesCarouselFlexMessage(pendingBindings)]
    });
  }

  private async handleAdminAction(
    decision: 'APPROVE' | 'REJECT',
    tenantId: string,
    event: LineWebhookEvent,
    employeeId?: string
  ): Promise<void> {
    const lineUserId = event.source.userId;
    if (!lineUserId || !event.replyToken) return;

    const isAdmin = await this.checkAdminPermission(tenantId, lineUserId);
    if (!isAdmin) {
      await this.linePlatformClient.replyMessage({
        tenantId,
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '您沒有管理權限。' }]
      });
      return;
    }

    if (!employeeId) {
      await this.linePlatformClient.replyMessage({
        tenantId,
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '缺少員工編號。' }]
      });
      return;
    }

    try {
      const adminBinding = await this.employeeBindingRepository.findActiveByLineUserId(tenantId, lineUserId);
      const reviewerId = adminBinding?.employeeId ?? lineUserId;

      await this.accessGovernanceService.decideAccess({
        tenantId,
        employeeId,
        reviewerId,
        decision
      });

      await this.linePlatformClient.replyMessage({
        tenantId,
        replyToken: event.replyToken,
        messages: [buildAdminActionResultFlexMessage({ action: decision, employeeId })]
      });
    } catch {
      await this.linePlatformClient.replyMessage({
        tenantId,
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '操作失敗，請稍後再試。' }]
      });
    }
  }

  private async checkAdminPermission(tenantId: string, lineUserId: string): Promise<boolean> {
    const binding = await this.employeeBindingRepository.findActiveByLineUserId(tenantId, lineUserId);
    if (!binding) return false;
    if (binding.accessStatus !== 'APPROVED') return false;

    const permissions = binding.permissions ?? {};
    return permissions.canInvite === true || permissions.canRemove === true;
  }
}
