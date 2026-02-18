import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand
} from '@aws-sdk/lib-dynamodb';
import { RefreshSessionRecord } from '../domain/auth.js';
import {
  BatchInviteJobRecord,
  BindingSessionRecord,
  EmployeeBindingRecord,
  EmployeeEnrollmentRecord,
  InvitationRecord,
  normalizeEmployeeBindingRecord
} from '../domain/invitation-binding.js';
import { AuditEventRecord, OffboardingJobRecord } from '../domain/offboarding.js';
import { TenantRecord } from '../domain/tenant.js';
import { RevokedJtiRepository, RefreshSessionRepository } from './auth-repository.js';
import {
  BatchInviteJobRepository,
  BindingSessionRepository,
  EmployeeBindingRepository,
  EmployeeEnrollmentRepository,
  InvitationRepository
} from './invitation-binding-repository.js';
import { AuditEventRepository, OffboardingJobRepository } from './offboarding-repository.js';
import { TenantRepository } from './tenant-repository.js';
import { AccessControlRepository } from './access-control-repository.js';

const GSI_LINE_USER = 'gsi-line-user';
const GSI_EVENT_TIME = 'gsi-event-time';

interface RecordMetadata {
  pk: string;
  sk: string;
  entityType: string;
}

function stripMetadata<T>(item: Record<string, unknown> | undefined): T | null {
  if (!item) {
    return null;
  }

  const rest = Object.fromEntries(
    Object.entries(item as Record<string, unknown> & RecordMetadata).filter(
      ([key]) => key !== 'pk' && key !== 'sk' && key !== 'entityType'
    )
  );
  return rest as T;
}

function asArray<T>(value: T[] | undefined): T[] {
  return value ?? [];
}

export function createDynamoDbDocumentClient(region: string): DynamoDBDocumentClient {
  const baseClient = new DynamoDBClient({ region });

  return DynamoDBDocumentClient.from(baseClient, {
    marshallOptions: {
      removeUndefinedValues: true
    }
  });
}

export class DynamoDbTenantRepository implements TenantRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string
  ) {}

  async create(record: TenantRecord): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: this.tenantPk(record.tenantId),
          sk: 'PROFILE',
          entityType: 'TENANT',
          ...record
        },
        ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
      })
    );
  }

  async findById(tenantId: string): Promise<TenantRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: this.tenantPk(tenantId),
          sk: 'PROFILE'
        }
      })
    );

    return stripMetadata<TenantRecord>(response.Item as Record<string, unknown> | undefined);
  }

  async save(record: TenantRecord): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: this.tenantPk(record.tenantId),
          sk: 'PROFILE',
          entityType: 'TENANT',
          ...record
        }
      })
    );
  }

  private tenantPk(tenantId: string): string {
    return `TENANT#${tenantId}`;
  }
}

export class DynamoDbInvitationRepository implements InvitationRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string
  ) {}

  async create(record: InvitationRecord): Promise<void> {
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: {
                ...this.invitationKey(record.invitationId),
                entityType: 'INVITATION',
                ...record
              },
              ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
            }
          },
          {
            Put: {
              TableName: this.tableName,
              Item: {
                ...this.invitationTokenLookupKey(record.tokenHash),
                entityType: 'INVITATION_TOKEN_LOOKUP',
                invitationId: record.invitationId
              },
              ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
            }
          }
        ]
      })
    );
  }

  async findByTokenHash(tokenHash: string): Promise<InvitationRecord | null> {
    const lookup = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: this.invitationTokenLookupKey(tokenHash)
      })
    );

    const invitationId = (lookup.Item as { invitationId?: string } | undefined)?.invitationId;
    if (!invitationId) {
      return null;
    }

    return this.findById(invitationId);
  }

  async findById(invitationId: string): Promise<InvitationRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: this.invitationKey(invitationId)
      })
    );

    return stripMetadata<InvitationRecord>(response.Item as Record<string, unknown> | undefined);
  }

  async save(record: InvitationRecord): Promise<void> {
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: {
                ...this.invitationKey(record.invitationId),
                entityType: 'INVITATION',
                ...record
              }
            }
          },
          {
            Put: {
              TableName: this.tableName,
              Item: {
                ...this.invitationTokenLookupKey(record.tokenHash),
                entityType: 'INVITATION_TOKEN_LOOKUP',
                invitationId: record.invitationId
              }
            }
          }
        ]
      })
    );
  }

  private invitationKey(invitationId: string): { pk: string; sk: string } {
    return {
      pk: `INVITATION#${invitationId}`,
      sk: 'RECORD'
    };
  }

  private invitationTokenLookupKey(tokenHash: string): { pk: string; sk: string } {
    return {
      pk: `INVITATION_TOKEN_HASH#${tokenHash}`,
      sk: 'LOOKUP'
    };
  }
}

export class DynamoDbBatchInviteJobRepository implements BatchInviteJobRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string
  ) {}

  async create(record: BatchInviteJobRecord): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...this.batchJobKey(record.jobId),
          entityType: 'BATCH_INVITE_JOB',
          ...record
        },
        ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
      })
    );
  }

  async findById(jobId: string): Promise<BatchInviteJobRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: this.batchJobKey(jobId)
      })
    );

    return stripMetadata<BatchInviteJobRecord>(response.Item as Record<string, unknown> | undefined);
  }

  async save(record: BatchInviteJobRecord): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...this.batchJobKey(record.jobId),
          entityType: 'BATCH_INVITE_JOB',
          ...record
        }
      })
    );
  }

  private batchJobKey(jobId: string): { pk: string; sk: string } {
    return {
      pk: `BATCH_INVITE_JOB#${jobId}`,
      sk: 'RECORD'
    };
  }
}

export class DynamoDbBindingSessionRepository implements BindingSessionRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string
  ) {}

  async create(record: BindingSessionRecord): Promise<void> {
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: {
                ...this.bindingSessionKey(record.sessionId),
                entityType: 'BINDING_SESSION',
                ...record
              },
              ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
            }
          },
          {
            Put: {
              TableName: this.tableName,
              Item: {
                ...this.bindingSessionTokenLookupKey(record.sessionTokenHash),
                entityType: 'BINDING_SESSION_TOKEN_LOOKUP',
                sessionId: record.sessionId
              },
              ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
            }
          }
        ]
      })
    );
  }

  async findByTokenHash(sessionTokenHash: string): Promise<BindingSessionRecord | null> {
    const lookup = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: this.bindingSessionTokenLookupKey(sessionTokenHash)
      })
    );

    const sessionId = (lookup.Item as { sessionId?: string } | undefined)?.sessionId;
    if (!sessionId) {
      return null;
    }

    const session = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: this.bindingSessionKey(sessionId)
      })
    );

    return stripMetadata<BindingSessionRecord>(session.Item as Record<string, unknown> | undefined);
  }

  async save(record: BindingSessionRecord): Promise<void> {
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: {
                ...this.bindingSessionKey(record.sessionId),
                entityType: 'BINDING_SESSION',
                ...record
              }
            }
          },
          {
            Put: {
              TableName: this.tableName,
              Item: {
                ...this.bindingSessionTokenLookupKey(record.sessionTokenHash),
                entityType: 'BINDING_SESSION_TOKEN_LOOKUP',
                sessionId: record.sessionId
              }
            }
          }
        ]
      })
    );
  }

  private bindingSessionKey(sessionId: string): { pk: string; sk: string } {
    return {
      pk: `BINDING_SESSION#${sessionId}`,
      sk: 'RECORD'
    };
  }

  private bindingSessionTokenLookupKey(sessionTokenHash: string): { pk: string; sk: string } {
    return {
      pk: `BINDING_SESSION_TOKEN_HASH#${sessionTokenHash}`,
      sk: 'LOOKUP'
    };
  }
}

export class DynamoDbEmployeeEnrollmentRepository implements EmployeeEnrollmentRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string
  ) {}

  async upsert(record: EmployeeEnrollmentRecord): Promise<void> {
    await this.putEnrollment(record);
  }

  async findByEmployeeId(tenantId: string, employeeId: string): Promise<EmployeeEnrollmentRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: this.enrollmentKey(tenantId, employeeId)
      })
    );

    return stripMetadata<EmployeeEnrollmentRecord>(response.Item as Record<string, unknown> | undefined);
  }

  async save(record: EmployeeEnrollmentRecord): Promise<void> {
    await this.putEnrollment(record);
  }

  private async putEnrollment(record: EmployeeEnrollmentRecord): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...this.enrollmentKey(record.tenantId, record.employeeId),
          entityType: 'EMPLOYEE_ENROLLMENT',
          ...record
        }
      })
    );
  }

  private enrollmentKey(tenantId: string, employeeId: string): { pk: string; sk: string } {
    return {
      pk: `TENANT#${tenantId}`,
      sk: `ENROLLMENT#${employeeId}`
    };
  }
}

export class DynamoDbEmployeeBindingRepository implements EmployeeBindingRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string
  ) {}

  async findByLineUserId(tenantId: string, lineUserId: string): Promise<EmployeeBindingRecord | null> {
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: GSI_LINE_USER,
        KeyConditionExpression: 'tenant_id = :tenantId AND line_user_id = :lineUserId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':lineUserId': lineUserId
        },
        Limit: 1
      })
    );

    const item = response.Items?.[0] as Record<string, unknown> | undefined;
    const record = stripMetadata<EmployeeBindingRecord>(item);
    return record ? normalizeEmployeeBindingRecord(record) : null;
  }

  async findByEmployeeId(tenantId: string, employeeId: string): Promise<EmployeeBindingRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: this.bindingKey(tenantId, employeeId)
      })
    );

    const record = stripMetadata<EmployeeBindingRecord>(response.Item as Record<string, unknown> | undefined);
    return record ? normalizeEmployeeBindingRecord(record) : null;
  }

  async findActiveByLineUserId(tenantId: string, lineUserId: string): Promise<EmployeeBindingRecord | null> {
    const record = await this.findByLineUserId(tenantId, lineUserId);

    if (!record || record.employmentStatus !== 'ACTIVE') {
      return null;
    }

    return record;
  }

  async findActiveByEmployeeId(tenantId: string, employeeId: string): Promise<EmployeeBindingRecord | null> {
    const record = await this.findByEmployeeId(tenantId, employeeId);

    if (!record || record.employmentStatus !== 'ACTIVE') {
      return null;
    }

    return record;
  }

  async upsert(record: EmployeeBindingRecord): Promise<void> {
    const normalized = normalizeEmployeeBindingRecord(record);
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...this.bindingKey(normalized.tenantId, normalized.employeeId),
          entityType: 'EMPLOYEE_BINDING',
          ...normalized,
          tenant_id: normalized.tenantId,
          line_user_id: normalized.lineUserId
        }
      })
    );
  }

  private bindingKey(tenantId: string, employeeId: string): { pk: string; sk: string } {
    return {
      pk: `TENANT#${tenantId}`,
      sk: `BINDING#${employeeId}`
    };
  }
}

export class DynamoDbAccessControlRepository implements AccessControlRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string
  ) {}

  async addBlacklistedEmployee(tenantId: string, employeeId: string): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...this.employeeBlacklistKey(tenantId, employeeId),
          entityType: 'EMPLOYEE_BLACKLIST',
          tenantId,
          employeeId,
          createdAt: new Date().toISOString()
        }
      })
    );
  }

  async addBlacklistedLineUser(tenantId: string, lineUserId: string): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...this.lineUserBlacklistKey(tenantId, lineUserId),
          entityType: 'LINE_USER_BLACKLIST',
          tenantId,
          lineUserId,
          createdAt: new Date().toISOString()
        }
      })
    );
  }

  async isBlacklisted(input: {
    tenantId: string;
    employeeId: string;
    lineUserId: string;
  }): Promise<boolean> {
    const response = await this.client.send(
      new BatchGetCommand({
        RequestItems: {
          [this.tableName]: {
            Keys: [
              this.employeeBlacklistKey(input.tenantId, input.employeeId),
              this.lineUserBlacklistKey(input.tenantId, input.lineUserId)
            ]
          }
        }
      })
    );

    const items = response.Responses?.[this.tableName] ?? [];
    return items.length > 0;
  }

  private employeeBlacklistKey(tenantId: string, employeeId: string): { pk: string; sk: string } {
    return {
      pk: `TENANT#${tenantId}`,
      sk: `BLACKLIST_EMPLOYEE#${employeeId}`
    };
  }

  private lineUserBlacklistKey(tenantId: string, lineUserId: string): { pk: string; sk: string } {
    return {
      pk: `TENANT#${tenantId}`,
      sk: `BLACKLIST_LINE_USER#${lineUserId}`
    };
  }
}

export class DynamoDbRefreshSessionRepository implements RefreshSessionRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string
  ) {}

  async create(record: RefreshSessionRecord): Promise<void> {
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: {
                ...this.sessionKey(record.sessionId),
                entityType: 'REFRESH_SESSION',
                ...record
              },
              ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
            }
          },
          {
            Put: {
              TableName: this.tableName,
              Item: {
                ...this.refreshTokenLookupKey(record.refreshTokenHash),
                entityType: 'REFRESH_TOKEN_LOOKUP',
                sessionId: record.sessionId
              }
            }
          },
          {
            Put: {
              TableName: this.tableName,
              Item: {
                ...this.principalSessionKey(record.tenantId, record.lineUserId, record.sessionId),
                entityType: 'PRINCIPAL_SESSION',
                ...record
              }
            }
          }
        ]
      })
    );
  }

  async findById(sessionId: string): Promise<RefreshSessionRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: this.sessionKey(sessionId)
      })
    );

    return stripMetadata<RefreshSessionRecord>(response.Item as Record<string, unknown> | undefined);
  }

  async findByTokenHash(refreshTokenHash: string): Promise<RefreshSessionRecord | null> {
    const lookup = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: this.refreshTokenLookupKey(refreshTokenHash)
      })
    );

    const sessionId = (lookup.Item as { sessionId?: string } | undefined)?.sessionId;
    if (!sessionId) {
      return null;
    }

    return this.findById(sessionId);
  }

  async listByPrincipal(tenantId: string, lineUserId: string): Promise<RefreshSessionRecord[]> {
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sessionPrefix)',
        ExpressionAttributeValues: {
          ':pk': this.principalPartitionKey(tenantId, lineUserId),
          ':sessionPrefix': 'SESSION#'
        }
      })
    );

    return asArray(response.Items as Record<string, unknown>[] | undefined)
      .map((item) => stripMetadata<RefreshSessionRecord>(item))
      .filter((item): item is RefreshSessionRecord => item !== null);
  }

  async save(record: RefreshSessionRecord): Promise<void> {
    const existing = await this.findById(record.sessionId);
    const transactItems: Array<Record<string, unknown>> = [
      {
        Put: {
          TableName: this.tableName,
          Item: {
            ...this.sessionKey(record.sessionId),
            entityType: 'REFRESH_SESSION',
            ...record
          }
        }
      },
      {
        Put: {
          TableName: this.tableName,
          Item: {
            ...this.refreshTokenLookupKey(record.refreshTokenHash),
            entityType: 'REFRESH_TOKEN_LOOKUP',
            sessionId: record.sessionId
          }
        }
      },
      {
        Put: {
          TableName: this.tableName,
          Item: {
            ...this.principalSessionKey(record.tenantId, record.lineUserId, record.sessionId),
            entityType: 'PRINCIPAL_SESSION',
            ...record
          }
        }
      }
    ];

    if (existing && existing.refreshTokenHash !== record.refreshTokenHash) {
      transactItems.push({
        Delete: {
          TableName: this.tableName,
          Key: this.refreshTokenLookupKey(existing.refreshTokenHash)
        }
      });
    }

    if (existing && (existing.tenantId !== record.tenantId || existing.lineUserId !== record.lineUserId)) {
      transactItems.push({
        Delete: {
          TableName: this.tableName,
          Key: this.principalSessionKey(existing.tenantId, existing.lineUserId, existing.sessionId)
        }
      });
    }

    await this.client.send(
      new TransactWriteCommand({
        TransactItems: transactItems
      })
    );
  }

  private sessionKey(sessionId: string): { pk: string; sk: string } {
    return {
      pk: `SESSION#${sessionId}`,
      sk: 'RECORD'
    };
  }

  private refreshTokenLookupKey(refreshTokenHash: string): { pk: string; sk: string } {
    return {
      pk: `REFRESH_TOKEN_HASH#${refreshTokenHash}`,
      sk: 'LOOKUP'
    };
  }

  private principalPartitionKey(tenantId: string, lineUserId: string): string {
    return `PRINCIPAL#${tenantId}#${lineUserId}`;
  }

  private principalSessionKey(tenantId: string, lineUserId: string, sessionId: string): { pk: string; sk: string } {
    return {
      pk: this.principalPartitionKey(tenantId, lineUserId),
      sk: `SESSION#${sessionId}`
    };
  }
}

export class DynamoDbRevokedJtiRepository implements RevokedJtiRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string
  ) {}

  async revokeJti(jti: string, expiresAtEpochSeconds: number): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `JTI#${jti}`,
          sk: 'REVOKED',
          entityType: 'REVOKED_JTI',
          jti,
          expiresAtEpochSeconds,
          ttl: expiresAtEpochSeconds
        }
      })
    );
  }

  async isJtiRevoked(jti: string, nowEpochSeconds: number): Promise<boolean> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `JTI#${jti}`,
          sk: 'REVOKED'
        }
      })
    );

    const item = response.Item as { expiresAtEpochSeconds?: number } | undefined;
    if (!item?.expiresAtEpochSeconds) {
      return false;
    }

    if (item.expiresAtEpochSeconds <= nowEpochSeconds) {
      await this.client.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: {
            pk: `JTI#${jti}`,
            sk: 'REVOKED'
          }
        })
      );
      return false;
    }

    return true;
  }
}

export class DynamoDbOffboardingJobRepository implements OffboardingJobRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string
  ) {}

  async create(record: OffboardingJobRecord): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...this.jobKey(record.jobId),
          entityType: 'OFFBOARDING_JOB',
          ...record
        },
        ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
      })
    );
  }

  async findById(jobId: string): Promise<OffboardingJobRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: this.jobKey(jobId)
      })
    );

    return stripMetadata<OffboardingJobRecord>(response.Item as Record<string, unknown> | undefined);
  }

  async save(record: OffboardingJobRecord): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...this.jobKey(record.jobId),
          entityType: 'OFFBOARDING_JOB',
          ...record
        }
      })
    );
  }

  private jobKey(jobId: string): { pk: string; sk: string } {
    return {
      pk: `OFFBOARDING_JOB#${jobId}`,
      sk: 'RECORD'
    };
  }
}

export class DynamoDbAuditEventRepository implements AuditEventRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string
  ) {}

  async append(event: AuditEventRecord): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `TENANT#${event.tenantId}`,
          sk: `AUDIT_EVENT#${event.createdAt}#${event.eventId}`,
          entityType: 'AUDIT_EVENT',
          ...event,
          tenant_id: event.tenantId,
          event_time: event.createdAt
        }
      })
    );
  }

  async listByTenant(tenantId: string): Promise<AuditEventRecord[]> {
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: GSI_EVENT_TIME,
        KeyConditionExpression: 'tenant_id = :tenantId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId
        },
        ScanIndexForward: true
      })
    );

    return asArray(response.Items as Record<string, unknown>[] | undefined)
      .map((item) => stripMetadata<AuditEventRecord>(item))
      .filter((item): item is AuditEventRecord => item !== null);
  }
}
