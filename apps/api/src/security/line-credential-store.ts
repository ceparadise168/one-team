import {
  CreateSecretCommand,
  DescribeSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceExistsException,
  SecretsManagerClient
} from '@aws-sdk/client-secrets-manager';

export interface LineCredentials {
  channelId: string;
  channelSecret: string;
  loginChannelId?: string;
  loginChannelSecret?: string;
}

export interface LineCredentialStore {
  upsertTenantCredentials(tenantId: string, credentials: LineCredentials): Promise<{ secretArn: string }>;
  getTenantCredentials(tenantId: string): Promise<LineCredentials | null>;
}

export class InMemoryLineCredentialStore implements LineCredentialStore {
  private readonly values = new Map<string, string>();

  async upsertTenantCredentials(
    tenantId: string,
    credentials: LineCredentials
  ): Promise<{ secretArn: string }> {
    this.values.set(tenantId, JSON.stringify(credentials));

    return {
      secretArn: `in-memory://${tenantId}/line`
    };
  }

  async getTenantCredentials(tenantId: string): Promise<LineCredentials | null> {
    const raw = this.values.get(tenantId);

    if (!raw) {
      return null;
    }

    return parseLineCredentials(raw);
  }
}

export class AwsSecretsManagerLineCredentialStore implements LineCredentialStore {
  private readonly client: SecretsManagerClient;
  private readonly secretPrefix: string;

  constructor(input: { region: string; secretPrefix: string }) {
    this.client = new SecretsManagerClient({ region: input.region });
    this.secretPrefix = input.secretPrefix;
  }

  async upsertTenantCredentials(
    tenantId: string,
    credentials: LineCredentials
  ): Promise<{ secretArn: string }> {
    const secretId = `${this.secretPrefix}/${tenantId}/line-credentials`;
    const secretString = serializeLineCredentials(credentials);

    try {
      const created = await this.client.send(
        new CreateSecretCommand({
          Name: secretId,
          SecretString: secretString
        })
      );

      return {
        secretArn: created.ARN ?? secretId
      };
    } catch (error) {
      if (error instanceof ResourceExistsException) {
        const updated = await this.client.send(
          new PutSecretValueCommand({
            SecretId: secretId,
            SecretString: secretString
          })
        );
        const described = await this.client.send(new DescribeSecretCommand({ SecretId: secretId }));

        return {
          secretArn: updated.ARN ?? described.ARN ?? secretId
        };
      }

      throw error;
    }
  }

  async getTenantCredentials(tenantId: string): Promise<LineCredentials | null> {
    const secretId = `${this.secretPrefix}/${tenantId}/line-credentials`;

    try {
      const value = await this.client.send(new GetSecretValueCommand({ SecretId: secretId }));

      if (!value.SecretString) {
        return null;
      }

      return parseLineCredentials(value.SecretString);
    } catch (error) {
      if ((error as { name?: string }).name === 'ResourceNotFoundException') {
        return null;
      }

      throw error;
    }
  }
}

function parseLineCredentials(raw: string): LineCredentials {
  const parsed = JSON.parse(raw) as Partial<LineCredentials>;

  if (typeof parsed.channelId !== 'string' || typeof parsed.channelSecret !== 'string') {
    throw new Error('LINE credentials secret is malformed');
  }

  const hasLoginChannelId = parsed.loginChannelId !== undefined;
  const hasLoginChannelSecret = parsed.loginChannelSecret !== undefined;

  if (hasLoginChannelId !== hasLoginChannelSecret) {
    throw new Error('LINE login credentials secret is malformed');
  }

  if (hasLoginChannelId && typeof parsed.loginChannelId !== 'string') {
    throw new Error('LINE login credentials secret is malformed');
  }

  if (hasLoginChannelSecret && typeof parsed.loginChannelSecret !== 'string') {
    throw new Error('LINE login credentials secret is malformed');
  }

  return {
    channelId: parsed.channelId,
    channelSecret: parsed.channelSecret,
    loginChannelId: parsed.loginChannelId,
    loginChannelSecret: parsed.loginChannelSecret
  };
}

function serializeLineCredentials(credentials: LineCredentials): string {
  const payload: LineCredentials = {
    channelId: credentials.channelId,
    channelSecret: credentials.channelSecret
  };

  if (credentials.loginChannelId && credentials.loginChannelSecret) {
    payload.loginChannelId = credentials.loginChannelId;
    payload.loginChannelSecret = credentials.loginChannelSecret;
  }

  return JSON.stringify(payload);
}
