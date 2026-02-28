import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SQSEvent } from 'aws-lambda';
import { handleInvitationEmailBatch } from './invitation-email-worker.js';
import { MockEmailAdapter } from '../email/email-adapter.js';
import { InMemoryTenantRepository } from '../repositories/tenant-repository.js';
import { InMemoryBatchInviteJobRepository } from '../repositories/invitation-binding-repository.js';
import { createTenantRecord } from '../domain/tenant.js';

function createSqsEvent(messages: unknown[]): SQSEvent {
  return {
    Records: messages.map((msg, i) => ({
      messageId: `msg-${i}`,
      receiptHandle: `handle-${i}`,
      body: JSON.stringify(msg),
      attributes: {} as SQSEvent['Records'][0]['attributes'],
      messageAttributes: {},
      md5OfBody: '',
      eventSource: 'aws:sqs',
      eventSourceARN: 'arn:aws:sqs:ap-northeast-1:123456789:test-queue',
      awsRegion: 'ap-northeast-1'
    }))
  };
}

describe('InvitationEmailWorker', () => {
  it('sends email and returns no failures for valid message', async () => {
    const emailAdapter = new MockEmailAdapter();
    const tenantRepo = new InMemoryTenantRepository();
    const batchRepo = new InMemoryBatchInviteJobRepository();

    await tenantRepo.create(createTenantRecord({
      tenantId: 'tenant-1',
      tenantName: 'Test Corp',
      adminEmail: 'admin@test.com',
      nowIso: new Date().toISOString()
    }));

    const event = createSqsEvent([
      {
        tenantId: 'tenant-1',
        jobId: 'job-1',
        email: 'user@example.com',
        employeeId: 'EMP-001',
        invitationId: 'inv-1',
        invitationToken: 'token-1',
        invitationUrl: 'https://app.example.com/invite?token=token-1',
        oneTimeBindingCode: '12345678'
      }
    ]);

    const result = await handleInvitationEmailBatch(event, {
      emailAdapter,
      tenantRepository: tenantRepo,
      batchInviteJobRepository: batchRepo
    });

    assert.equal(result.batchItemFailures.length, 0);
    assert.equal(emailAdapter.sentEmails.length, 1);
    assert.equal(emailAdapter.sentEmails[0].to, 'user@example.com');
    assert.ok(emailAdapter.sentEmails[0].subject.includes('Test Corp'));
  });

  it('reports batch item failure for invalid message body', async () => {
    const event: SQSEvent = {
      Records: [
        {
          messageId: 'msg-bad',
          receiptHandle: 'handle-bad',
          body: 'not-json',
          attributes: {} as SQSEvent['Records'][0]['attributes'],
          messageAttributes: {},
          md5OfBody: '',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:ap-northeast-1:123456789:test-queue',
          awsRegion: 'ap-northeast-1'
        }
      ]
    };

    const result = await handleInvitationEmailBatch(event, {
      emailAdapter: new MockEmailAdapter(),
      tenantRepository: new InMemoryTenantRepository(),
      batchInviteJobRepository: new InMemoryBatchInviteJobRepository()
    });

    assert.equal(result.batchItemFailures.length, 1);
    assert.equal(result.batchItemFailures[0].itemIdentifier, 'msg-bad');
  });
});
