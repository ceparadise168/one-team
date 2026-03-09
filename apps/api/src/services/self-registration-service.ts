import { ConflictError } from '../errors.js';
import {
  getTenantPendingRichMenuId
} from '../domain/tenant.js';
import {
  buildNewAccessRequestNotificationFlexMessage
} from '../line/flex-message-templates.js';
import { LineAuthClient } from '../line/line-auth-client.js';
import { LinePlatformClient } from '../line/line-platform-client.js';
import { EmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
import { TenantRepository } from '../repositories/tenant-repository.js';

export interface SelfRegisterInput {
  tenantId: string;
  lineIdToken: string;
  employeeId: string;
  nickname?: string;
}

export interface SelfRegisterByLineUserInput {
  tenantId: string;
  lineUserId: string;
  employeeId: string;
  nickname?: string;
}

export interface SelfRegisterResult {
  tenantId: string;
  employeeId: string;
  accessStatus: 'PENDING';
  registeredAt: string;
}

interface ServiceOptions {
  now: () => Date;
}

export class SelfRegistrationService {
  constructor(
    private readonly lineAuthClient: LineAuthClient,
    private readonly employeeBindingRepository: EmployeeBindingRepository,
    private readonly tenantRepository: TenantRepository,
    private readonly linePlatformClient: LinePlatformClient,
    private readonly options: ServiceOptions = { now: () => new Date() }
  ) {}

  async register(input: SelfRegisterInput): Promise<SelfRegisterResult> {
    const { lineUserId } = await this.lineAuthClient.validateIdToken({
      tenantId: input.tenantId,
      idToken: input.lineIdToken
    });

    return this.processRegistration(input.tenantId, lineUserId, input.employeeId, input.nickname);
  }

  async registerByLineUser(input: SelfRegisterByLineUserInput): Promise<SelfRegisterResult> {
    return this.processRegistration(input.tenantId, input.lineUserId, input.employeeId, input.nickname);
  }

  private async processRegistration(
    tenantId: string,
    lineUserId: string,
    employeeId: string,
    nickname?: string
  ): Promise<SelfRegisterResult> {
    // Check for duplicate employeeId
    const existingByEmployee = await this.employeeBindingRepository.findByEmployeeId(
      tenantId,
      employeeId
    );
    if (existingByEmployee && existingByEmployee.employmentStatus === 'ACTIVE') {
      if (existingByEmployee.accessStatus === 'REJECTED') {
        // Allow re-registration for rejected employees
        return this.reRegister(existingByEmployee, tenantId, lineUserId, employeeId, nickname);
      }
      throw new ConflictError(`Employee ID ${employeeId} is already registered`);
    }

    // Check for duplicate lineUserId
    const existingByLine = await this.employeeBindingRepository.findActiveByLineUserId(
      tenantId,
      lineUserId
    );
    if (existingByLine) {
      throw new ConflictError('This LINE account is already bound to an employee');
    }

    const nowIso = this.options.now().toISOString();

    await this.employeeBindingRepository.upsert({
      tenantId,
      employeeId,
      lineUserId,
      boundAt: nowIso,
      employmentStatus: 'ACTIVE',
      accessStatus: 'PENDING',
      accessRequestedAt: nowIso,
      nickname,
    });

    await this.linkPendingRichMenu(tenantId, lineUserId);
    await this.notifyAdmins(tenantId, employeeId, nowIso);

    return {
      tenantId,
      employeeId,
      accessStatus: 'PENDING',
      registeredAt: nowIso
    };
  }

  private async reRegister(
    existing: { tenantId: string; employeeId: string; lineUserId: string },
    tenantId: string,
    lineUserId: string,
    employeeId: string,
    nickname?: string
  ): Promise<SelfRegisterResult> {
    const nowIso = this.options.now().toISOString();

    await this.employeeBindingRepository.upsert({
      tenantId,
      employeeId,
      lineUserId,
      boundAt: nowIso,
      employmentStatus: 'ACTIVE',
      accessStatus: 'PENDING',
      accessRequestedAt: nowIso,
      accessReviewedAt: undefined,
      accessReviewedBy: undefined,
      nickname,
    });

    await this.linkPendingRichMenu(tenantId, lineUserId);
    await this.notifyAdmins(tenantId, employeeId, nowIso);

    return {
      tenantId,
      employeeId,
      accessStatus: 'PENDING',
      registeredAt: nowIso
    };
  }

  private async linkPendingRichMenu(tenantId: string, lineUserId: string): Promise<void> {
    const tenant = await this.tenantRepository.findById(tenantId);
    const resources = tenant?.line.resources ?? {};
    const richMenuId = getTenantPendingRichMenuId(resources, tenantId);

    try {
      await this.linePlatformClient.linkRichMenu({ tenantId, lineUserId, richMenuId });
    } catch {
      // Best-effort — don't fail registration if rich menu linking fails
    }
  }

  private async notifyAdmins(
    tenantId: string,
    employeeId: string,
    requestedAt: string
  ): Promise<void> {
    const bindings = await this.employeeBindingRepository.listByTenant(tenantId);
    const admins = bindings.filter(b =>
      b.employmentStatus === 'ACTIVE' &&
      b.accessStatus === 'APPROVED' &&
      (b.permissions?.canInvite === true || b.permissions?.canRemove === true)
    );

    const message = buildNewAccessRequestNotificationFlexMessage({
      employeeId,
      requestedAt
    });

    for (const admin of admins) {
      try {
        await this.linePlatformClient.pushMessage({
          tenantId,
          lineUserId: admin.lineUserId,
          messages: [message]
        });
      } catch {
        // Best-effort — don't fail registration if notification fails
      }
    }
  }
}
