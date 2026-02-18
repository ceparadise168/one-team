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
}
