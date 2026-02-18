import { TenantRecord } from '../domain/tenant.js';

export interface TenantRepository {
  create(record: TenantRecord): Promise<void>;
  findById(tenantId: string): Promise<TenantRecord | null>;
  save(record: TenantRecord): Promise<void>;
}

export class InMemoryTenantRepository implements TenantRepository {
  private readonly records = new Map<string, TenantRecord>();

  async create(record: TenantRecord): Promise<void> {
    if (this.records.has(record.tenantId)) {
      throw new Error(`Tenant already exists: ${record.tenantId}`);
    }

    this.records.set(record.tenantId, record);
  }

  async findById(tenantId: string): Promise<TenantRecord | null> {
    return this.records.get(tenantId) ?? null;
  }

  async save(record: TenantRecord): Promise<void> {
    this.records.set(record.tenantId, record);
  }
}
