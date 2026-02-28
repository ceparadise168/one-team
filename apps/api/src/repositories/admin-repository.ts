import { AdminAccountRecord } from '../domain/admin-auth.js';

export interface AdminAccountRepository {
  create(record: AdminAccountRecord): Promise<void>;
  findByEmail(email: string): Promise<AdminAccountRecord | null>;
  findById(adminId: string): Promise<AdminAccountRecord | null>;
}

export class InMemoryAdminAccountRepository implements AdminAccountRepository {
  private readonly accounts = new Map<string, AdminAccountRecord>();
  private readonly emailIndex = new Map<string, string>();

  async create(record: AdminAccountRecord): Promise<void> {
    this.accounts.set(record.adminId, record);
    this.emailIndex.set(record.email.toLowerCase(), record.adminId);
  }

  async findByEmail(email: string): Promise<AdminAccountRecord | null> {
    const adminId = this.emailIndex.get(email.toLowerCase());
    if (!adminId) return null;
    return this.accounts.get(adminId) ?? null;
  }

  async findById(adminId: string): Promise<AdminAccountRecord | null> {
    return this.accounts.get(adminId) ?? null;
  }
}
