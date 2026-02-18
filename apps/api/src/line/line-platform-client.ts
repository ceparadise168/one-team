import { LineCredentialStore } from '../security/line-credential-store.js';
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
  linkRichMenu(input: { tenantId: string; lineUserId: string; richMenuId: string }): Promise<void>;
  unlinkRichMenu(input: { tenantId: string; lineUserId: string }): Promise<void>;
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

  async linkRichMenu(input: { tenantId: string; lineUserId: string; richMenuId: string }): Promise<void> {
    if (!input.richMenuId.trim()) {
      throw new Error('Rich menu ID is required');
    }

    if (input.lineUserId.startsWith('fail-link-')) {
      throw new Error('LINE API transient failure while linking rich menu');
    }
  }

  async unlinkRichMenu(input: { tenantId: string; lineUserId: string }): Promise<void> {
    if (input.lineUserId.startsWith('fail-')) {
      throw new Error('LINE API transient failure while unlinking rich menu');
    }
  }
}

interface RealLinePlatformClientOptions {
  apiBaseUrl?: string;
  fetchFn?: typeof fetch;
  webhookVerifyTokenPrefix?: string;
}

export class RealLinePlatformClient implements LinePlatformClient {
  private readonly apiBaseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly webhookVerifyTokenPrefix: string;

  constructor(
    private readonly lineCredentialStore: LineCredentialStore,
    options: RealLinePlatformClientOptions = {}
  ) {
    this.apiBaseUrl = (options.apiBaseUrl ?? 'https://api.line.me').replace(/\/$/, '');
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.webhookVerifyTokenPrefix = options.webhookVerifyTokenPrefix ?? 'line-verify-';
  }

  async validateChannelCredentials(channelId: string, channelSecret: string): Promise<void> {
    const accessToken = await this.issueChannelAccessToken(channelId, channelSecret);
    await this.callLineJson('/v2/bot/info', {
      method: 'GET',
      accessToken,
      operation: 'validate channel credentials'
    });
  }

  async provisionResources(input: ProvisionLineResourcesInput): Promise<LineResources> {
    const credentials = await this.getTenantCredentialsOrThrow(input.tenantId);
    const accessToken = await this.issueChannelAccessToken(credentials.channelId, credentials.channelSecret);

    await this.callLineJson('/v2/bot/channel/webhook/endpoint', {
      method: 'PUT',
      accessToken,
      body: {
        endpoint: input.webhookUrl
      },
      operation: 'set webhook endpoint'
    });

    let richMenuId = input.existingResources?.richMenuId;
    if (!richMenuId) {
      const richMenuCreated = await this.callLineJson('/v2/bot/richmenu', {
        method: 'POST',
        accessToken,
        body: this.createDefaultRichMenuRequest(input.tenantId),
        operation: 'create rich menu'
      });

      const parsed = richMenuCreated as { richMenuId?: string };
      if (!parsed.richMenuId?.trim()) {
        throw new Error('LINE API create rich menu response missing richMenuId');
      }
      richMenuId = parsed.richMenuId.trim();
    }

    return {
      ...input.existingResources,
      richMenuId,
      webhookId: input.existingResources?.webhookId ?? `webhook_${input.tenantId}`,
      webhookUrl: input.webhookUrl
    };
  }

  async verifyWebhookToken(token: string): Promise<boolean> {
    return token.startsWith(this.webhookVerifyTokenPrefix) && token.length > this.webhookVerifyTokenPrefix.length;
  }

  async linkRichMenu(input: { tenantId: string; lineUserId: string; richMenuId: string }): Promise<void> {
    const credentials = await this.getTenantCredentialsOrThrow(input.tenantId);
    const accessToken = await this.issueChannelAccessToken(credentials.channelId, credentials.channelSecret);

    await this.callLineJson(
      `/v2/bot/user/${encodeURIComponent(input.lineUserId)}/richmenu/${encodeURIComponent(input.richMenuId)}`,
      {
        method: 'POST',
        accessToken,
        operation: 'link rich menu'
      }
    );
  }

  async unlinkRichMenu(input: { tenantId: string; lineUserId: string }): Promise<void> {
    const credentials = await this.getTenantCredentialsOrThrow(input.tenantId);
    const accessToken = await this.issueChannelAccessToken(credentials.channelId, credentials.channelSecret);

    await this.callLineJson(`/v2/bot/user/${encodeURIComponent(input.lineUserId)}/richmenu`, {
      method: 'DELETE',
      accessToken,
      operation: 'unlink rich menu'
    });
  }

  private async getTenantCredentialsOrThrow(tenantId: string): Promise<{ channelId: string; channelSecret: string }> {
    const credentials = await this.lineCredentialStore.getTenantCredentials(tenantId);

    if (!credentials) {
      throw new Error(`LINE credentials not found for tenant: ${tenantId}`);
    }

    return credentials;
  }

  private async issueChannelAccessToken(channelId: string, channelSecret: string): Promise<string> {
    const formBody = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: channelId,
      client_secret: channelSecret
    });

    const response = await this.fetchFn(`${this.apiBaseUrl}/v2/oauth/accessToken`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formBody.toString()
    });

    if (!response.ok) {
      const detail = await readResponseText(response);
      throw new Error(`LINE API issue access token failed (HTTP ${response.status}): ${detail}`);
    }

    const payload = (await response.json()) as { access_token?: string };
    if (!payload.access_token?.trim()) {
      throw new Error('LINE API issue access token response missing access_token');
    }

    return payload.access_token.trim();
  }

  private async callLineJson(
    path: string,
    input: {
      method: 'GET' | 'POST' | 'PUT' | 'DELETE';
      accessToken: string;
      operation: string;
      body?: unknown;
    }
  ): Promise<unknown> {
    const endpoint = `${this.apiBaseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${input.accessToken}`
    };

    let serializedBody: string | undefined;
    if (input.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      serializedBody = JSON.stringify(input.body);
    }

    const response = await this.fetchFn(endpoint, {
      method: input.method,
      headers,
      body: serializedBody
    });

    if (!response.ok) {
      const detail = await readResponseText(response);
      throw new Error(`LINE API ${input.operation} failed (HTTP ${response.status}): ${detail}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return {};
    }

    return response.json();
  }

  private createDefaultRichMenuRequest(tenantId: string): {
    size: {
      width: number;
      height: number;
    };
    selected: boolean;
    name: string;
    chatBarText: string;
    areas: Array<{
      bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      action: {
        type: 'message';
        text: string;
      };
    }>;
  } {
    return {
      size: {
        width: 2500,
        height: 843
      },
      selected: true,
      name: `one-team-${tenantId}`,
      chatBarText: '員工服務',
      areas: [
        {
          bounds: { x: 0, y: 0, width: 833, height: 843 },
          action: { type: 'message', text: '按摩預約' }
        },
        {
          bounds: { x: 833, y: 0, width: 834, height: 843 },
          action: { type: 'message', text: '諮商預約' }
        },
        {
          bounds: { x: 1667, y: 0, width: 833, height: 843 },
          action: { type: 'message', text: '員工服務' }
        }
      ]
    };
  }
}

async function readResponseText(response: Response): Promise<string> {
  const text = await response.text();
  return text.trim() || 'No response body';
}
