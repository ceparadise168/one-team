import { LineWebhookEvent, parsePostbackData } from '../domain/webhook.js';
import {
  getTenantPendingRichMenuId,
  getTenantApprovedRichMenuId
} from '../domain/tenant.js';
import {
  buildWelcomeFlexMessage,
  buildServicesMenuFlexMessage,
  buildDigitalIdFlexMessage,
  buildAdminDashboardFlexMessage,
  buildPendingEmployeesCarouselFlexMessage,
  buildAdminActionResultFlexMessage,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  buildAccessConfirmationFlexMessage
} from '../line/flex-message-templates.js';
import { LinePlatformClient } from '../line/line-platform-client.js';
import { EmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
import { AuditEventRepository } from '../repositories/offboarding-repository.js';
import { TenantRepository } from '../repositories/tenant-repository.js';
import { WebhookEventRepository } from '../repositories/webhook-event-repository.js';
import { EmployeeAccessGovernanceService } from './employee-access-governance-service.js';
import { SelfRegistrationService } from './self-registration-service.js';
import { ConflictError } from '../errors.js';
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
    private readonly tenantRepository: TenantRepository,
    private readonly selfRegistrationService: SelfRegistrationService,
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
      case 'message':
        await this.handleMessage(tenantId, event);
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

    const tenant = await this.tenantRepository.findById(tenantId);
    const resources = tenant?.line.resources ?? {};
    const existingBinding = await this.employeeBindingRepository.findActiveByLineUserId(tenantId, lineUserId);

    // Clear lineDisconnectedAt on re-follow
    if (existingBinding?.lineDisconnectedAt) {
      existingBinding.lineDisconnectedAt = undefined;
      await this.employeeBindingRepository.upsert(existingBinding);
    }

    if (existingBinding?.accessStatus === 'APPROVED') {
      const richMenuId = getTenantApprovedRichMenuId(resources, tenantId);
      await this.linePlatformClient.linkRichMenu({ tenantId, lineUserId, richMenuId });
    } else if (existingBinding?.accessStatus === 'PENDING') {
      const richMenuId = getTenantPendingRichMenuId(resources, tenantId);
      await this.linePlatformClient.linkRichMenu({ tenantId, lineUserId, richMenuId });
    } else {
      const richMenuId = getTenantPendingRichMenuId(resources, tenantId);
      await this.linePlatformClient.linkRichMenu({ tenantId, lineUserId, richMenuId });
    }

    if (event.replyToken) {
      const tenantName = tenant?.tenantName ?? 'ONE TEAM';
      const needsRegistration = !existingBinding || existingBinding.accessStatus === 'REJECTED';

      await this.linePlatformClient.replyMessage({
        tenantId,
        replyToken: event.replyToken,
        messages: [buildWelcomeFlexMessage(tenantName, { showRegistration: needsRegistration })]
      });
    }
  }

  private async handleMessage(tenantId: string, event: LineWebhookEvent): Promise<void> {
    if (event.message?.type !== 'text' || !event.message.text) return;

    const text = event.message.text.trim();

    switch (text) {
      case '申請開通':
        await this.handleRequestAccess(tenantId, event);
        return;
      case '員工服務':
        await this.handleServicesMenu(tenantId, event);
        return;
      default:
        break;
    }

    // Unrecognized text → try inline registration for users without active binding
    const lineUserId = event.source.userId;
    if (lineUserId) {
      const existing = await this.employeeBindingRepository.findActiveByLineUserId(tenantId, lineUserId);
      if (!existing || existing.accessStatus === 'REJECTED') {
        const employeeIdMatch = text.match(/^工號\s*(.+)$/);
        const employeeId = employeeIdMatch ? employeeIdMatch[1].trim() : text;
        await this.handleInlineRegistration(tenantId, event, employeeId);
      } else if (event.replyToken) {
        await this.linePlatformClient.replyMessage({
          tenantId,
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `您的 LINE 已綁定在工號 ${existing.employeeId} 上，無法再次綁定其他工號。` }]
        });
      }
    }
  }

  private async handleInlineRegistration(
    tenantId: string,
    event: LineWebhookEvent,
    employeeId: string
  ): Promise<void> {
    const lineUserId = event.source.userId;
    if (!lineUserId || !event.replyToken) return;

    try {
      await this.selfRegistrationService.registerByLineUser({
        tenantId,
        lineUserId,
        employeeId
      });

      await this.linePlatformClient.replyMessage({
        tenantId,
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '申請已送出，請等候管理員審核。' }]
      });
    } catch (error) {
      const message = error instanceof ConflictError
        ? error.message
        : '註冊失敗，請稍後再試。';

      await this.linePlatformClient.replyMessage({
        tenantId,
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: message }]
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
      case 'request_access':
      case 'start_bind':
        await this.handleRequestAccess(tenantId, event);
        return;
      case 'digital_id':
        await this.handleDigitalId(tenantId, event);
        return;
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

  private async handleDigitalId(tenantId: string, event: LineWebhookEvent): Promise<void> {
    const lineUserId = event.source.userId;
    if (!lineUserId || !event.replyToken) return;

    const binding = await this.employeeBindingRepository.findActiveByLineUserId(tenantId, lineUserId);

    if (!binding || binding.accessStatus !== 'APPROVED') {
      await this.linePlatformClient.replyMessage({
        tenantId,
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '您尚未開通員工身份，無法查看員工證。' }]
      });
      return;
    }

    await this.linePlatformClient.replyMessage({
      tenantId,
      replyToken: event.replyToken,
      messages: [buildDigitalIdFlexMessage(binding.employeeId)]
    });
  }

  private async handleRequestAccess(tenantId: string, event: LineWebhookEvent): Promise<void> {
    const lineUserId = event.source.userId;
    if (!lineUserId || !event.replyToken) return;

    const existingBinding = await this.employeeBindingRepository.findActiveByLineUserId(tenantId, lineUserId);

    if (existingBinding) {
      if (existingBinding.accessStatus === 'APPROVED') {
        await this.linePlatformClient.replyMessage({
          tenantId,
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '您已開通，可從下方選單使用員工服務。' }]
        });
        return;
      }
      if (existingBinding.accessStatus === 'PENDING') {
        await this.linePlatformClient.replyMessage({
          tenantId,
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '您的申請正在審核中，請耐心等待。' }]
        });
        return;
      }
      // REJECTED — allow re-registration
    }

    await this.linePlatformClient.replyMessage({
      tenantId,
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: '請輸入您的工號（例如：E001）' }]
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
      .map(b => ({ employeeId: b.employeeId, nickname: b.nickname, boundAt: b.boundAt }));

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
