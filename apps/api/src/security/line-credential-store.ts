import {
  CreateSecretCommand,
  DescribeSecretCommand,
  PutSecretValueCommand,
  ResourceExistsException,
  SecretsManagerClient
} from '@aws-sdk/client-secrets-manager';

export interface LineCredentials {
  channelId: string;
  channelSecret: string;
}

export interface LineCredentialStore {
  upsertTenantCredentials(tenantId: string, credentials: LineCredentials): Promise<{ secretArn: string }>;
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
    const secretString = JSON.stringify({
      channelId: credentials.channelId,
      channelSecret: credentials.channelSecret
    });

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
}
