import test from 'node:test';
import assert from 'node:assert/strict';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDbEmployeeBindingRepository } from './dynamodb-repositories.js';
import { InMemoryEmployeeBindingRepository } from './invitation-binding-repository.js';

test('in-memory employee binding repository normalizes access governance defaults', async () => {
  const repository = new InMemoryEmployeeBindingRepository();

  await repository.upsert({
    tenantId: 'tenant_a',
    employeeId: 'E001',
    lineUserId: 'U001',
    boundAt: '2026-02-18T00:00:00.000Z',
    employmentStatus: 'ACTIVE'
  });

  const record = await repository.findByEmployeeId('tenant_a', 'E001');
  assert.ok(record);
  assert.equal(record.accessStatus, 'PENDING');
  assert.equal(record.permissions?.canInvite, false);
  assert.equal(record.permissions?.canRemove, false);
});

test('dynamodb employee binding repository normalizes legacy records and writes access fields', async () => {
  const tableName = 'employees-table';
  const store = new Map<string, Record<string, unknown>>();

  const fakeClient = {
    async send(command: { input: Record<string, unknown> }): Promise<Record<string, unknown>> {
      const commandName = command.constructor.name;
      const input = command.input;

      if (commandName === 'PutCommand') {
        const item = input.Item as Record<string, unknown>;
        store.set(`${item.pk}::${item.sk}`, item);
        return {};
      }

      if (commandName === 'GetCommand') {
        const key = input.Key as { pk: string; sk: string };
        return {
          Item: store.get(`${key.pk}::${key.sk}`)
        };
      }

      if (commandName === 'QueryCommand') {
        const values = input.ExpressionAttributeValues as {
          ':tenantId': string;
          ':lineUserId': string;
        };
        const item = Array.from(store.values()).find(
          (candidate) =>
            candidate.tenant_id === values[':tenantId'] &&
            candidate.line_user_id === values[':lineUserId']
        );
        return {
          Items: item ? [item] : []
        };
      }

      throw new Error(`Unsupported command in test fake client: ${commandName}`);
    }
  } as unknown as DynamoDBDocumentClient;

  const repository = new DynamoDbEmployeeBindingRepository(fakeClient, tableName);

  store.set('TENANT#tenant_b::BINDING#E002', {
    pk: 'TENANT#tenant_b',
    sk: 'BINDING#E002',
    entityType: 'EMPLOYEE_BINDING',
    tenantId: 'tenant_b',
    employeeId: 'E002',
    lineUserId: 'U002',
    boundAt: '2026-02-18T00:00:00.000Z',
    employmentStatus: 'ACTIVE',
    tenant_id: 'tenant_b',
    line_user_id: 'U002'
  });

  const legacyRead = await repository.findByEmployeeId('tenant_b', 'E002');
  assert.ok(legacyRead);
  assert.equal(legacyRead.accessStatus, 'PENDING');
  assert.equal(legacyRead.permissions?.canInvite, false);
  assert.equal(legacyRead.permissions?.canRemove, false);

  await repository.upsert({
    tenantId: 'tenant_b',
    employeeId: 'E003',
    lineUserId: 'U003',
    boundAt: '2026-02-18T00:00:00.000Z',
    employmentStatus: 'ACTIVE'
  });

  const written = store.get('TENANT#tenant_b::BINDING#E003');
  assert.ok(written);
  assert.equal(written?.accessStatus, 'PENDING');
  assert.deepEqual(written?.permissions, {
    canInvite: false,
    canRemove: false
  });
});
