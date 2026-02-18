export type WizardStepStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';

export interface SetupStepView {
  status: WizardStepStatus;
  message?: string;
  updatedAt?: string;
}

export interface SetupWizardSnapshot {
  tenantId: string;
  tenantName: string;
  adminEmail: string;
  line: {
    channelId?: string;
    secretArn?: string;
    resources: {
      liffId?: string;
      richMenuId?: string;
      webhookId?: string;
      webhookUrl?: string;
    };
  };
  setup: {
    connection: SetupStepView;
    provisioning: SetupStepView;
    webhookVerification: SetupStepView;
    completedAt?: string;
  };
}

export interface SetupWizardState {
  snapshot?: SetupWizardSnapshot;
  isSubmitting: boolean;
  error?: string;
}

export interface SetupWizardActions {
  createTenant(input: { tenantName: string; adminEmail: string }): Promise<void>;
  connectLineCredentials(input: { channelId: string; channelSecret: string }): Promise<void>;
  provisionLineResources(): Promise<void>;
  verifyWebhook(input: { verificationToken: string }): Promise<void>;
  refreshStatus(): Promise<void>;
  clearError(): void;
}

export interface SetupWizardApi {
  createTenant(input: { tenantName: string; adminEmail: string }): Promise<SetupWizardSnapshot>;
  connectLineCredentials(input: {
    tenantId: string;
    channelId: string;
    channelSecret: string;
  }): Promise<SetupWizardSnapshot>;
  provisionLineResources(input: {
    tenantId: string;
  }): Promise<{ idempotent: boolean; snapshot: SetupWizardSnapshot }>;
  verifyWebhook(input: { tenantId: string; verificationToken: string }): Promise<SetupWizardSnapshot>;
  getSetupStatus(input: { tenantId: string }): Promise<SetupWizardSnapshot>;
}
