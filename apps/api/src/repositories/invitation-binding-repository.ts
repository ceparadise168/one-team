import {
  BatchInviteJobRecord,
  BindingSessionRecord,
  EmployeeBindingRecord,
  EmployeeEnrollmentRecord,
  InvitationRecord
} from '../domain/invitation-binding.js';

export interface InvitationRepository {
  create(record: InvitationRecord): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<InvitationRecord | null>;
  findById(invitationId: string): Promise<InvitationRecord | null>;
  save(record: InvitationRecord): Promise<void>;
}

export interface BatchInviteJobRepository {
  create(record: BatchInviteJobRecord): Promise<void>;
  findById(jobId: string): Promise<BatchInviteJobRecord | null>;
  save(record: BatchInviteJobRecord): Promise<void>;
}

export interface BindingSessionRepository {
  create(record: BindingSessionRecord): Promise<void>;
  findByTokenHash(sessionTokenHash: string): Promise<BindingSessionRecord | null>;
  save(record: BindingSessionRecord): Promise<void>;
}

export interface EmployeeEnrollmentRepository {
  upsert(record: EmployeeEnrollmentRecord): Promise<void>;
  findByEmployeeId(tenantId: string, employeeId: string): Promise<EmployeeEnrollmentRecord | null>;
  save(record: EmployeeEnrollmentRecord): Promise<void>;
}

export interface EmployeeBindingRepository {
  findActiveByLineUserId(tenantId: string, lineUserId: string): Promise<EmployeeBindingRecord | null>;
  findActiveByEmployeeId(tenantId: string, employeeId: string): Promise<EmployeeBindingRecord | null>;
  upsert(record: EmployeeBindingRecord): Promise<void>;
}

export class InMemoryInvitationRepository implements InvitationRepository {
  private readonly byId = new Map<string, InvitationRecord>();
  private readonly byTokenHash = new Map<string, string>();

  async create(record: InvitationRecord): Promise<void> {
    this.byId.set(record.invitationId, record);
    this.byTokenHash.set(record.tokenHash, record.invitationId);
  }

  async findByTokenHash(tokenHash: string): Promise<InvitationRecord | null> {
    const invitationId = this.byTokenHash.get(tokenHash);

    if (!invitationId) {
      return null;
    }

    return this.byId.get(invitationId) ?? null;
  }

  async findById(invitationId: string): Promise<InvitationRecord | null> {
    return this.byId.get(invitationId) ?? null;
  }

  async save(record: InvitationRecord): Promise<void> {
    this.byId.set(record.invitationId, record);
    this.byTokenHash.set(record.tokenHash, record.invitationId);
  }
}

export class InMemoryBatchInviteJobRepository implements BatchInviteJobRepository {
  private readonly jobs = new Map<string, BatchInviteJobRecord>();

  async create(record: BatchInviteJobRecord): Promise<void> {
    this.jobs.set(record.jobId, record);
  }

  async findById(jobId: string): Promise<BatchInviteJobRecord | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async save(record: BatchInviteJobRecord): Promise<void> {
    this.jobs.set(record.jobId, record);
  }
}

export class InMemoryBindingSessionRepository implements BindingSessionRepository {
  private readonly byTokenHash = new Map<string, BindingSessionRecord>();

  async create(record: BindingSessionRecord): Promise<void> {
    this.byTokenHash.set(record.sessionTokenHash, record);
  }

  async findByTokenHash(sessionTokenHash: string): Promise<BindingSessionRecord | null> {
    return this.byTokenHash.get(sessionTokenHash) ?? null;
  }

  async save(record: BindingSessionRecord): Promise<void> {
    this.byTokenHash.set(record.sessionTokenHash, record);
  }
}

export class InMemoryEmployeeEnrollmentRepository implements EmployeeEnrollmentRepository {
  private readonly records = new Map<string, EmployeeEnrollmentRecord>();

  private key(tenantId: string, employeeId: string): string {
    return `${tenantId}::${employeeId}`;
  }

  async upsert(record: EmployeeEnrollmentRecord): Promise<void> {
    this.records.set(this.key(record.tenantId, record.employeeId), record);
  }

  async findByEmployeeId(tenantId: string, employeeId: string): Promise<EmployeeEnrollmentRecord | null> {
    return this.records.get(this.key(tenantId, employeeId)) ?? null;
  }

  async save(record: EmployeeEnrollmentRecord): Promise<void> {
    this.records.set(this.key(record.tenantId, record.employeeId), record);
  }
}

export class InMemoryEmployeeBindingRepository implements EmployeeBindingRepository {
  private readonly byLineUser = new Map<string, EmployeeBindingRecord>();
  private readonly byEmployee = new Map<string, EmployeeBindingRecord>();

  private lineKey(tenantId: string, lineUserId: string): string {
    return `${tenantId}::${lineUserId}`;
  }

  private employeeKey(tenantId: string, employeeId: string): string {
    return `${tenantId}::${employeeId}`;
  }

  async findActiveByLineUserId(tenantId: string, lineUserId: string): Promise<EmployeeBindingRecord | null> {
    const record = this.byLineUser.get(this.lineKey(tenantId, lineUserId));

    if (!record || record.employmentStatus !== 'ACTIVE') {
      return null;
    }

    return record;
  }

  async findActiveByEmployeeId(tenantId: string, employeeId: string): Promise<EmployeeBindingRecord | null> {
    const record = this.byEmployee.get(this.employeeKey(tenantId, employeeId));

    if (!record || record.employmentStatus !== 'ACTIVE') {
      return null;
    }

    return record;
  }

  async upsert(record: EmployeeBindingRecord): Promise<void> {
    this.byLineUser.set(this.lineKey(record.tenantId, record.lineUserId), record);
    this.byEmployee.set(this.employeeKey(record.tenantId, record.employeeId), record);
  }
}
