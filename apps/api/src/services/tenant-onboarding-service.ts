import { randomUUID } from 'node:crypto';
import {
  TenantRecord,
  TenantSetupSnapshot,
  createTenantRecord,
  toTenantSetupSnapshot
} from '../domain/tenant.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { LinePlatformClient } from '../line/line-platform-client.js';
import { TenantRepository } from '../repositories/tenant-repository.js';
import { LineCredentialStore } from '../security/line-credential-store.js';

export interface CreateTenantInput {
  tenantName: string;
  adminEmail: string;
}

export interface ConnectLineInput {
  tenantId: string;
  channelId: string;
  channelSecret: string;
  loginChannelId?: string;
  loginChannelSecret?: string;
}

export interface VerifyWebhookInput {
  tenantId: string;
  verificationToken: string;
}

export class TenantOnboardingService {
  constructor(
    private readonly tenantRepository: TenantRepository,
    private readonly lineCredentialStore: LineCredentialStore,
    private readonly linePlatformClient: LinePlatformClient,
    private readonly options: { publicApiBaseUrl: string; now: () => Date } = {
      publicApiBaseUrl: 'https://api.example.com',
      now: () => new Date()
    }
  ) {}

  async createTenant(input: CreateTenantInput): Promise<TenantSetupSnapshot> {
    if (!input.tenantName.trim()) {
      throw new ValidationError('tenantName is required');
    }

    if (!input.adminEmail.includes('@')) {
      throw new ValidationError('adminEmail must be a valid email');
    }

    const tenantId = `tenant_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const nowIso = this.options.now().toISOString();

    const record = createTenantRecord({
      tenantId,
      tenantName: input.tenantName.trim(),
      adminEmail: input.adminEmail.trim().toLowerCase(),
      nowIso
    });

    await this.tenantRepository.create(record);

    return toTenantSetupSnapshot(record);
  }

  async connectLineCredentials(input: ConnectLineInput): Promise<TenantSetupSnapshot> {
    const record = await this.getTenant(input.tenantId);
    const nowIso = this.options.now().toISOString();
    const hasLoginChannelId = Boolean(input.loginChannelId?.trim());
    const hasLoginChannelSecret = Boolean(input.loginChannelSecret?.trim());

    if (hasLoginChannelId !== hasLoginChannelSecret) {
      throw new ValidationError('loginChannelId and loginChannelSecret must be provided together');
    }

    const loginChannelId = hasLoginChannelId ? input.loginChannelId?.trim() : input.channelId;
    const loginChannelSecret = hasLoginChannelSecret
      ? input.loginChannelSecret?.trim()
      : input.channelSecret;

    record.setup.connection = {
      status: 'IN_PROGRESS',
      updatedAt: nowIso
    };
    record.updatedAt = nowIso;
    await this.tenantRepository.save(record);

    try {
      await this.linePlatformClient.validateChannelCredentials(input.channelId, input.channelSecret);

      const result = await this.lineCredentialStore.upsertTenantCredentials(input.tenantId, {
        channelId: input.channelId,
        channelSecret: input.channelSecret,
        loginChannelId,
        loginChannelSecret
      });

      record.line.channelId = input.channelId;
      record.line.loginChannelId = loginChannelId;
      record.line.secretArn = result.secretArn;
      record.line.resources.webhookUrl = this.buildWebhookUrl(record.tenantId);
      record.setup.connection = {
        status: 'SUCCEEDED',
        updatedAt: this.options.now().toISOString()
      };
      record.setup.webhookVerification = {
        status: 'NOT_STARTED',
        updatedAt: this.options.now().toISOString()
      };
      record.updatedAt = this.options.now().toISOString();

      await this.tenantRepository.save(record);

      return toTenantSetupSnapshot(record);
    } catch (error) {
      record.setup.connection = {
        status: 'FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
        updatedAt: this.options.now().toISOString()
      };
      record.updatedAt = this.options.now().toISOString();
      await this.tenantRepository.save(record);
      throw error;
    }
  }

  async provisionLineResources(tenantId: string): Promise<{ idempotent: boolean; snapshot: TenantSetupSnapshot }> {
    const record = await this.getTenant(tenantId);

    if (!record.line.channelId || !record.line.secretArn) {
      throw new ValidationError('LINE credentials must be connected before provisioning');
    }

    if (
      record.setup.provisioning.status === 'SUCCEEDED' &&
      record.line.resources.liffId &&
      record.line.resources.richMenuId &&
      record.line.resources.webhookId
    ) {
      return {
        idempotent: true,
        snapshot: toTenantSetupSnapshot(record)
      };
    }

    record.setup.provisioning = {
      status: 'IN_PROGRESS',
      updatedAt: this.options.now().toISOString()
    };
    record.updatedAt = this.options.now().toISOString();
    await this.tenantRepository.save(record);

    try {
      const resources = await this.linePlatformClient.provisionResources({
        tenantId: record.tenantId,
        channelId: record.line.channelId,
        existingResources: record.line.resources,
        webhookUrl: record.line.resources.webhookUrl ?? this.buildWebhookUrl(record.tenantId)
      });

      record.line.resources = {
        ...record.line.resources,
        ...resources
      };
      record.setup.provisioning = {
        status: 'SUCCEEDED',
        updatedAt: this.options.now().toISOString()
      };

      if (record.setup.webhookVerification.status !== 'SUCCEEDED') {
        record.setup.webhookVerification = {
          status: 'IN_PROGRESS',
          updatedAt: this.options.now().toISOString()
        };
      }

      record.updatedAt = this.options.now().toISOString();
      await this.tenantRepository.save(record);

      return {
        idempotent: false,
        snapshot: toTenantSetupSnapshot(record)
      };
    } catch (error) {
      record.setup.provisioning = {
        status: 'FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
        updatedAt: this.options.now().toISOString()
      };
      record.updatedAt = this.options.now().toISOString();
      await this.tenantRepository.save(record);
      throw error;
    }
  }

  async verifyWebhook(input: VerifyWebhookInput): Promise<TenantSetupSnapshot> {
    const record = await this.getTenant(input.tenantId);

    if (!record.line.resources.webhookUrl) {
      throw new ValidationError('Webhook URL is not provisioned yet');
    }

    const isVerified = await this.linePlatformClient.verifyWebhookToken(input.verificationToken);

    if (!isVerified) {
      record.setup.webhookVerification = {
        status: 'FAILED',
        message: 'Webhook verification token is invalid',
        updatedAt: this.options.now().toISOString()
      };
      record.updatedAt = this.options.now().toISOString();
      await this.tenantRepository.save(record);
      throw new ValidationError('Webhook verification failed');
    }

    record.setup.webhookVerification = {
      status: 'SUCCEEDED',
      updatedAt: this.options.now().toISOString()
    };

    if (
      record.setup.connection.status === 'SUCCEEDED' &&
      record.setup.provisioning.status === 'SUCCEEDED'
    ) {
      record.setup.completedAt = this.options.now().toISOString();
    }

    record.updatedAt = this.options.now().toISOString();
    await this.tenantRepository.save(record);

    return toTenantSetupSnapshot(record);
  }

  async getSetupStatus(tenantId: string): Promise<TenantSetupSnapshot> {
    const record = await this.getTenant(tenantId);
    return toTenantSetupSnapshot(record);
  }

  private async getTenant(tenantId: string): Promise<TenantRecord> {
    const record = await this.tenantRepository.findById(tenantId);

    if (!record) {
      throw new NotFoundError(`Tenant not found: ${tenantId}`);
    }

    return record;
  }

  private buildWebhookUrl(tenantId: string): string {
    return `${this.options.publicApiBaseUrl.replace(/\/$/, '')}/v1/line/webhook/${tenantId}`;
  }
}
