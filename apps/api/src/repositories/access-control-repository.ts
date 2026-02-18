export interface AccessControlRepository {
  addBlacklistedEmployee(tenantId: string, employeeId: string): Promise<void>;
  addBlacklistedLineUser(tenantId: string, lineUserId: string): Promise<void>;
  isBlacklisted(input: { tenantId: string; employeeId: string; lineUserId: string }): Promise<boolean>;
}

export class InMemoryAccessControlRepository implements AccessControlRepository {
  private readonly employeeBlacklist = new Set<string>();
  private readonly lineUserBlacklist = new Set<string>();

  async addBlacklistedEmployee(tenantId: string, employeeId: string): Promise<void> {
    this.employeeBlacklist.add(`${tenantId}::${employeeId}`);
  }

  async addBlacklistedLineUser(tenantId: string, lineUserId: string): Promise<void> {
    this.lineUserBlacklist.add(`${tenantId}::${lineUserId}`);
  }

  async isBlacklisted(input: {
    tenantId: string;
    employeeId: string;
    lineUserId: string;
  }): Promise<boolean> {
    return (
      this.employeeBlacklist.has(`${input.tenantId}::${input.employeeId}`) ||
      this.lineUserBlacklist.has(`${input.tenantId}::${input.lineUserId}`)
    );
  }
}
