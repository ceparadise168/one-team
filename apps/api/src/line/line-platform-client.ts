import { LineResources } from '../domain/tenant.js';

export interface ProvisionLineResourcesInput {
  tenantId: string;
  channelId: string;
  existingResources?: LineResources;
  webhookUrl: string;
}

export interface LinePlatformClient {
  validateChannelCredentials(channelId: string, channelSecret: string): Promise<void>;
  provisionResources(input: ProvisionLineResourcesInput): Promise<LineResources>;
  verifyWebhookToken(token: string): Promise<boolean>;
}

export class StubLinePlatformClient implements LinePlatformClient {
  async validateChannelCredentials(channelId: string, channelSecret: string): Promise<void> {
    if (!/^\d{5,20}$/.test(channelId)) {
      throw new Error('LINE channel ID format is invalid');
    }

    if (channelSecret.length < 16) {
      throw new Error('LINE channel secret format is invalid');
    }
  }

  async provisionResources(input: ProvisionLineResourcesInput): Promise<LineResources> {
    return {
      liffId: input.existingResources?.liffId ?? `liff_${input.tenantId}`,
      richMenuId: input.existingResources?.richMenuId ?? `richmenu_${input.tenantId}`,
      webhookId: input.existingResources?.webhookId ?? `webhook_${input.tenantId}`,
      webhookUrl: input.webhookUrl
    };
  }

  async verifyWebhookToken(token: string): Promise<boolean> {
    return token.startsWith('line-verify-') && token.length > 16;
  }
}
