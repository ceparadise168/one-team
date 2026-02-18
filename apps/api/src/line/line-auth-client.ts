import { LineCredentialStore } from '../security/line-credential-store.js';
import { ValidationError } from '../errors.js';

export interface ValidateLineIdTokenInput {
  tenantId: string;
  idToken: string;
}

export interface LineAuthClient {
  validateIdToken(input: ValidateLineIdTokenInput): Promise<{ lineUserId: string }>;
}

export class StubLineAuthClient implements LineAuthClient {
  async validateIdToken(input: ValidateLineIdTokenInput): Promise<{ lineUserId: string }> {
    const idToken = input.idToken;

    if (!idToken.startsWith('line-id:')) {
      throw new ValidationError('LINE ID token format is invalid');
    }

    const lineUserId = idToken.replace('line-id:', '').trim();

    if (!lineUserId) {
      throw new ValidationError('LINE user identity is missing from id token');
    }

    return { lineUserId };
  }
}

interface RealLineAuthClientOptions {
  apiBaseUrl?: string;
  fetchFn?: typeof fetch;
}

export class RealLineAuthClient implements LineAuthClient {
  private readonly apiBaseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly lineCredentialStore: LineCredentialStore,
    options: RealLineAuthClientOptions = {}
  ) {
    this.apiBaseUrl = (options.apiBaseUrl ?? 'https://api.line.me').replace(/\/$/, '');
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  async validateIdToken(input: ValidateLineIdTokenInput): Promise<{ lineUserId: string }> {
    const credentials = await this.lineCredentialStore.getTenantCredentials(input.tenantId);

    if (!credentials) {
      throw new ValidationError('LINE credentials are not connected for tenant');
    }

    const loginChannelId = credentials.loginChannelId ?? credentials.channelId;

    const formBody = new URLSearchParams({
      id_token: input.idToken,
      client_id: loginChannelId
    });

    const response = await this.fetchFn(`${this.apiBaseUrl}/oauth2/v2.1/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formBody.toString()
    });

    if (!response.ok) {
      throw new ValidationError(`LINE ID token validation failed (HTTP ${response.status})`);
    }

    const payload = (await response.json()) as {
      sub?: string;
    };

    if (!payload.sub?.trim()) {
      throw new ValidationError('LINE user identity is missing from id token');
    }

    return {
      lineUserId: payload.sub.trim()
    };
  }
}
