import { AuditEventRecord, OffboardingJobRecord } from '../domain/offboarding.js';

export interface OffboardingJobRepository {
  create(record: OffboardingJobRecord): Promise<void>;
  findById(jobId: string): Promise<OffboardingJobRecord | null>;
  save(record: OffboardingJobRecord): Promise<void>;
}

export interface AuditEventRepository {
  append(event: AuditEventRecord): Promise<void>;
  listByTenant(tenantId: string): Promise<AuditEventRecord[]>;
}

export class InMemoryOffboardingJobRepository implements OffboardingJobRepository {
  private readonly jobs = new Map<string, OffboardingJobRecord>();

  async create(record: OffboardingJobRecord): Promise<void> {
    this.jobs.set(record.jobId, record);
  }

  async findById(jobId: string): Promise<OffboardingJobRecord | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async save(record: OffboardingJobRecord): Promise<void> {
    this.jobs.set(record.jobId, record);
  }
}

export class InMemoryAuditEventRepository implements AuditEventRepository {
  private readonly events: AuditEventRecord[] = [];

  async append(event: AuditEventRecord): Promise<void> {
    this.events.push(event);
  }

  async listByTenant(tenantId: string): Promise<AuditEventRecord[]> {
    return this.events.filter((event) => event.tenantId === tenantId);
  }
}
