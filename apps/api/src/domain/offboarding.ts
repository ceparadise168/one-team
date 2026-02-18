export type OffboardingJobStatus = 'QUEUED' | 'RETRY_SCHEDULED' | 'SUCCEEDED' | 'FAILED';

export interface OffboardingJobRecord {
  jobId: string;
  tenantId: string;
  employeeId: string;
  lineUserId: string;
  actorId: string;
  attempts: number;
  maxAttempts: number;
  status: OffboardingJobStatus;
  nextAttemptAt: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export type AuditAction = 'EMPLOYEE_OFFBOARDED' | 'RICH_MENU_UNLINK';
export type AuditOutcome = 'SUCCESS' | 'FAILED' | 'RETRY_SCHEDULED';

export interface AuditEventRecord {
  eventId: string;
  tenantId: string;
  employeeId: string;
  actorId: string;
  action: AuditAction;
  outcome: AuditOutcome;
  message?: string;
  createdAt: string;
  metadata?: Record<string, string | number | boolean>;
}
