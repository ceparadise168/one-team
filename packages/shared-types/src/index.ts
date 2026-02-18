export interface TenantConfig {
  tenantId: string;
  region: string;
}

export interface EmployeeIdentity {
  tenantId: string;
  employeeId: string;
  lineUserId: string;
}

export interface InvitationToken {
  tenantId: string;
  tokenId: string;
  expiresAt: string;
  usageLimit: number;
}
