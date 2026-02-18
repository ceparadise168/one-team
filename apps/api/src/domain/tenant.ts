export type SetupStepStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';

export interface SetupStep {
  status: SetupStepStatus;
  message?: string;
  updatedAt: string;
}

export interface LineResources {
  liffId?: string;
  richMenuId?: string;
  webhookId?: string;
  webhookUrl?: string;
}

export interface TenantRecord {
  tenantId: string;
  tenantName: string;
  adminEmail: string;
  createdAt: string;
  updatedAt: string;
  line: {
    channelId?: string;
    loginChannelId?: string;
    secretArn?: string;
    resources: LineResources;
  };
  setup: {
    connection: SetupStep;
    provisioning: SetupStep;
    webhookVerification: SetupStep;
    completedAt?: string;
  };
}

export interface TenantSetupSnapshot {
  tenantId: string;
  tenantName: string;
  adminEmail: string;
  line: {
    channelId?: string;
    loginChannelId?: string;
    secretArn?: string;
    resources: LineResources;
  };
  setup: TenantRecord['setup'];
}

const NOT_STARTED: SetupStep = {
  status: 'NOT_STARTED',
  updatedAt: new Date(0).toISOString()
};

export function createTenantRecord(input: {
  tenantId: string;
  tenantName: string;
  adminEmail: string;
  nowIso: string;
}): TenantRecord {
  return {
    tenantId: input.tenantId,
    tenantName: input.tenantName,
    adminEmail: input.adminEmail,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
    line: {
      resources: {}
    },
    setup: {
      connection: { ...NOT_STARTED },
      provisioning: { ...NOT_STARTED },
      webhookVerification: { ...NOT_STARTED }
    }
  };
}

export function toTenantSetupSnapshot(record: TenantRecord): TenantSetupSnapshot {
  return {
    tenantId: record.tenantId,
    tenantName: record.tenantName,
    adminEmail: record.adminEmail,
    line: record.line,
    setup: record.setup
  };
}
