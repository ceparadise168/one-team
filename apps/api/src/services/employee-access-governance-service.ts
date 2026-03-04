import {
  EmployeeAccessStatus,
  EmployeeBindingAccessProfile,
  EmployeeBindingRecord,
  EmployeePermissions,
  DEFAULT_EMPLOYEE_PERMISSIONS,
  normalizeEmployeeBindingRecord
} from '../domain/invitation-binding.js';
import {
  getTenantApprovedRichMenuId,
  getTenantPendingRichMenuId
} from '../domain/tenant.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { buildAccessConfirmationFlexMessage } from '../line/flex-message-templates.js';
import { LinePlatformClient } from '../line/line-platform-client.js';
import { EmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
import { TenantRepository } from '../repositories/tenant-repository.js';

type PermissionKey = keyof EmployeePermissions;

interface ServiceOptions {
  now: () => Date;
}

const DEFAULT_OPTIONS: ServiceOptions = {
  now: () => new Date()
};

export interface AccessRequestProfile {
  tenantId: string;
  employeeId: string;
  lineUserId: string;
  employmentStatus: 'ACTIVE' | 'OFFBOARDED';
  accessStatus: EmployeeAccessStatus;
  permissions: EmployeePermissions;
  accessRequestedAt?: string;
  accessReviewedAt?: string;
  accessReviewedBy?: string;
}

export class EmployeeAccessGovernanceService {
  constructor(
    private readonly employeeBindingRepository: EmployeeBindingRepository,
    private readonly tenantRepository: TenantRepository,
    private readonly linePlatformClient: LinePlatformClient,
    private readonly options: ServiceOptions = DEFAULT_OPTIONS
  ) {}

  async getAccessProfileByLineUser(input: {
    tenantId: string;
    lineUserId: string;
  }): Promise<AccessRequestProfile> {
    const binding = await this.requireActiveBindingByLineUser(input);
    return this.toProfile(binding);
  }

  async submitAccessRequestByLineUser(input: {
    tenantId: string;
    lineUserId: string;
  }): Promise<AccessRequestProfile> {
    const binding = await this.requireActiveBindingByLineUser(input);

    if (binding.accessStatus === 'APPROVED') {
      return this.toProfile(binding);
    }

    const nowIso = this.options.now().toISOString();
    binding.accessStatus = 'PENDING';
    binding.permissions = { ...DEFAULT_EMPLOYEE_PERMISSIONS };
    binding.accessRequestedAt = nowIso;
    binding.accessReviewedAt = undefined;
    binding.accessReviewedBy = undefined;

    await this.employeeBindingRepository.upsert(binding);
    await this.relinkForAccessStatus(binding);

    return this.toProfile(binding);
  }

  async decideAccess(input: {
    tenantId: string;
    employeeId: string;
    reviewerId: string;
    decision: 'APPROVE' | 'REJECT';
    permissions?: Partial<EmployeePermissions>;
  }): Promise<AccessRequestProfile> {
    const binding = await this.requireActiveBindingByEmployee({
      tenantId: input.tenantId,
      employeeId: input.employeeId
    });

    const nowIso = this.options.now().toISOString();
    if (input.decision === 'APPROVE') {
      binding.accessStatus = 'APPROVED';
      binding.permissions = {
        canInvite: input.permissions?.canInvite ?? false,
        canRemove: input.permissions?.canRemove ?? false
      };
    } else {
      binding.accessStatus = 'REJECTED';
      binding.permissions = { ...DEFAULT_EMPLOYEE_PERMISSIONS };
    }
    binding.accessReviewedAt = nowIso;
    binding.accessReviewedBy = input.reviewerId;

    await this.employeeBindingRepository.upsert(binding);
    await this.relinkForAccessStatus(binding);
    await this.notifyEmployeeOfDecision(binding);

    return this.toProfile(binding);
  }

  async updatePermissions(input: {
    tenantId: string;
    targetEmployeeId: string;
    callerEmployeeId: string;
    permissions: Partial<EmployeePermissions>;
  }): Promise<AccessRequestProfile> {
    if (input.targetEmployeeId === input.callerEmployeeId) {
      throw new ValidationError('Cannot modify own permissions');
    }

    const binding = await this.requireActiveBindingByEmployee({
      tenantId: input.tenantId,
      employeeId: input.targetEmployeeId,
    });

    if (binding.accessStatus !== 'APPROVED') {
      throw new ValidationError('Can only set permissions on approved employees');
    }

    binding.permissions = {
      canInvite: input.permissions.canInvite ?? binding.permissions.canInvite,
      canRemove: input.permissions.canRemove ?? binding.permissions.canRemove,
    };

    await this.employeeBindingRepository.upsert(binding);
    return this.toProfile(binding);
  }

  async requireEmployeePermission(input: {
    tenantId: string;
    lineUserId: string;
    permission: PermissionKey;
  }): Promise<AccessRequestProfile> {
    const binding = await this.requireActiveBindingByLineUser({
      tenantId: input.tenantId,
      lineUserId: input.lineUserId
    });

    if (binding.accessStatus !== 'APPROVED') {
      throw new ForbiddenError('Employee access is not approved');
    }

    if (!binding.permissions[input.permission]) {
      throw new ForbiddenError(`Employee missing permission: ${input.permission}`);
    }

    return this.toProfile(binding);
  }

  private async notifyEmployeeOfDecision(binding: EmployeeBindingAccessProfile): Promise<void> {
    if (binding.accessStatus !== 'APPROVED' && binding.accessStatus !== 'REJECTED') return;

    const tenant = await this.tenantRepository.findById(binding.tenantId);
    const tenantName = tenant?.tenantName ?? 'ONE TEAM';

    try {
      await this.linePlatformClient.pushMessage({
        tenantId: binding.tenantId,
        lineUserId: binding.lineUserId,
        messages: [buildAccessConfirmationFlexMessage(binding.accessStatus, tenantName)]
      });
    } catch {
      // Best-effort notification — don't fail the decision if push fails
    }
  }

  private async relinkForAccessStatus(binding: EmployeeBindingAccessProfile): Promise<void> {
    const tenant = await this.tenantRepository.findById(binding.tenantId);
    const resources = tenant?.line.resources ?? {};
    const richMenuId =
      binding.accessStatus === 'APPROVED'
        ? getTenantApprovedRichMenuId(resources, binding.tenantId)
        : getTenantPendingRichMenuId(resources, binding.tenantId);

    try {
      await this.linePlatformClient.linkRichMenu({
        tenantId: binding.tenantId,
        lineUserId: binding.lineUserId,
        richMenuId
      });
    } catch (error) {
      throw new ValidationError(
        `Access menu linking failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async requireActiveBindingByLineUser(input: {
    tenantId: string;
    lineUserId: string;
  }): Promise<EmployeeBindingAccessProfile> {
    const binding = await this.employeeBindingRepository.findActiveByLineUserId(
      input.tenantId,
      input.lineUserId
    );

    if (!binding) {
      throw new NotFoundError(`Active employee binding not found for line user: ${input.lineUserId}`);
    }

    return normalizeEmployeeBindingRecord(binding);
  }

  private async requireActiveBindingByEmployee(input: {
    tenantId: string;
    employeeId: string;
  }): Promise<EmployeeBindingAccessProfile> {
    const binding = await this.employeeBindingRepository.findActiveByEmployeeId(
      input.tenantId,
      input.employeeId
    );

    if (!binding) {
      throw new NotFoundError(`Active employee binding not found: ${input.employeeId}`);
    }

    return normalizeEmployeeBindingRecord(binding);
  }

  private toProfile(binding: EmployeeBindingRecord): AccessRequestProfile {
    const normalized = normalizeEmployeeBindingRecord(binding);
    return {
      tenantId: normalized.tenantId,
      employeeId: normalized.employeeId,
      lineUserId: normalized.lineUserId,
      employmentStatus: normalized.employmentStatus,
      accessStatus: normalized.accessStatus,
      permissions: normalized.permissions,
      accessRequestedAt: normalized.accessRequestedAt,
      accessReviewedAt: normalized.accessReviewedAt,
      accessReviewedBy: normalized.accessReviewedBy
    };
  }
}
