import { SetupWizardApi, SetupWizardSnapshot } from './types.js';

export class SetupWizardApiClient implements SetupWizardApi {
  constructor(
    private readonly config: {
      baseUrl: string;
      adminToken: string;
      fetchFn?: typeof fetch;
    }
  ) {}

  async createTenant(input: { tenantName: string; adminEmail: string }): Promise<SetupWizardSnapshot> {
    return this.request('/v1/admin/tenants', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  }

  async connectLineCredentials(input: {
    tenantId: string;
    channelId: string;
    channelSecret: string;
  }): Promise<SetupWizardSnapshot> {
    return this.request(`/v1/admin/tenants/${input.tenantId}/line/connect`, {
      method: 'POST',
      body: JSON.stringify({
        channelId: input.channelId,
        channelSecret: input.channelSecret
      })
    });
  }

  async provisionLineResources(input: {
    tenantId: string;
  }): Promise<{ idempotent: boolean; snapshot: SetupWizardSnapshot }> {
    return this.request(`/v1/admin/tenants/${input.tenantId}/line/provision`, {
      method: 'POST'
    });
  }

  async verifyWebhook(input: { tenantId: string; verificationToken: string }): Promise<SetupWizardSnapshot> {
    return this.request(`/v1/admin/tenants/${input.tenantId}/line/webhook/verify`, {
      method: 'POST',
      body: JSON.stringify({
        verificationToken: input.verificationToken
      })
    });
  }

  async getSetupStatus(input: { tenantId: string }): Promise<SetupWizardSnapshot> {
    return this.request(`/v1/admin/tenants/${input.tenantId}/line/setup-status`, {
      method: 'GET'
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const fetchFn = this.config.fetchFn ?? fetch;

    const response = await fetchFn(`${this.config.baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.adminToken}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {})
      }
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `Request failed with status ${response.status}`);
    }

    return response.json() as Promise<T>;
  }
}
