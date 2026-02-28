import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SQSEvent } from 'aws-lambda';
import { handleOffboardingBatch } from './offboarding-worker.js';
import { StubLinePlatformClient } from '../line/line-platform-client.js';
import { InMemoryOffboardingJobRepository, InMemoryAuditEventRepository } from '../repositories/offboarding-repository.js';

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

describe('OffboardingWorker', () => {
  it('unlinks rich menu and records audit event on success', async () => {
    const linePlatformClient = new StubLinePlatformClient();
    const jobRepo = new InMemoryOffboardingJobRepository();
    const auditRepo = new InMemoryAuditEventRepository();

    await jobRepo.create({
      jobId: 'job-1',
      tenantId: 'tenant-1',
      employeeId: 'emp-1',
      lineUserId: 'line-user-1',
      actorId: 'admin',
      attempts: 0,
      maxAttempts: 5,
      status: 'QUEUED',
      nextAttemptAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const event = createSqsEvent([
      {
        jobId: 'job-1',
        tenantId: 'tenant-1',
        employeeId: 'emp-1',
        lineUserId: 'line-user-1',
        actorId: 'admin'
      }
    ]);

    const result = await handleOffboardingBatch(event, {
      linePlatformClient,
      offboardingJobRepository: jobRepo,
      auditEventRepository: auditRepo
    });

    assert.equal(result.batchItemFailures.length, 0);

    const job = await jobRepo.findById('job-1');
    assert.equal(job?.status, 'SUCCEEDED');

    const events = await auditRepo.listByTenant('tenant-1');
    assert.equal(events.length, 1);
    assert.equal(events[0].action, 'RICH_MENU_UNLINK');
    assert.equal(events[0].outcome, 'SUCCESS');
  });

  it('reports failure when LINE API fails', async () => {
    const linePlatformClient = new StubLinePlatformClient();
    const jobRepo = new InMemoryOffboardingJobRepository();
    const auditRepo = new InMemoryAuditEventRepository();

    const event = createSqsEvent([
      {
        jobId: 'job-2',
        tenantId: 'tenant-1',
        employeeId: 'emp-2',
        lineUserId: 'fail-user',
        actorId: 'admin'
      }
    ]);

    const result = await handleOffboardingBatch(event, {
      linePlatformClient,
      offboardingJobRepository: jobRepo,
      auditEventRepository: auditRepo
    });

    assert.equal(result.batchItemFailures.length, 1);
    assert.equal(result.batchItemFailures[0].itemIdentifier, 'msg-0');
  });
});
