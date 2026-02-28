export type InvitationStatus = 'ACTIVE' | 'REVOKED';

export interface InvitationRecord {
  invitationId: string;
  tenantId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  usageLimit: number;
  usedCount: number;
  status: InvitationStatus;
}

export interface BatchInviteRecipientStatus {
  email: string;
  employeeId: string;
  status: 'QUEUED' | 'SENT' | 'FAILED';
  reason?: string;
  invitationId?: string;
  invitationToken?: string;
  invitationUrl?: string;
  oneTimeBindingCode?: string;
}

export interface BatchInviteJobRecord {
  jobId: string;
  tenantId: string;
  createdAt: string;
  recipients: BatchInviteRecipientStatus[];
}

export interface BindingSessionRecord {
  sessionId: string;
  tenantId: string;
  lineUserId: string;
  invitationId: string;
  sessionTokenHash: string;
  createdAt: string;
  expiresAt: string;
  failedAttempts: number;
  lockoutUntil?: string;
  completedAt?: string;
}

export interface EmployeeEnrollmentRecord {
  tenantId: string;
  employeeId: string;
  email?: string;
  bindingCodeHash: string;
  codeIssuedAt: string;
  codeUsedAt?: string;
}

export interface EmployeeBindingRecord {
  tenantId: string;
  employeeId: string;
  lineUserId: string;
  boundAt: string;
  employmentStatus: 'ACTIVE' | 'OFFBOARDED';
  accessStatus?: EmployeeAccessStatus;
  permissions?: Partial<EmployeePermissions>;
  accessRequestedAt?: string;
  accessReviewedAt?: string;
  accessReviewedBy?: string;
  lineDisconnectedAt?: string;
  nickname?: string;
}

export type EmployeeAccessStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface EmployeePermissions {
  canInvite: boolean;
  canRemove: boolean;
}

export interface EmployeeBindingAccessProfile extends Omit<EmployeeBindingRecord, 'permissions' | 'accessStatus'> {
  accessStatus: EmployeeAccessStatus;
  permissions: EmployeePermissions;
}

export const DEFAULT_EMPLOYEE_ACCESS_STATUS: EmployeeAccessStatus = 'PENDING';

export const DEFAULT_EMPLOYEE_PERMISSIONS: EmployeePermissions = {
  canInvite: false,
  canRemove: false
};

export function normalizeEmployeeBindingRecord(record: EmployeeBindingRecord): EmployeeBindingAccessProfile {
  return {
    ...record,
    accessStatus: record.accessStatus ?? DEFAULT_EMPLOYEE_ACCESS_STATUS,
    permissions: {
      canInvite: record.permissions?.canInvite ?? DEFAULT_EMPLOYEE_PERMISSIONS.canInvite,
      canRemove: record.permissions?.canRemove ?? DEFAULT_EMPLOYEE_PERMISSIONS.canRemove
    }
  };
}
