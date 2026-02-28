import { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { LinePlatformClient } from '../line/line-platform-client.js';
import { OffboardingJobRepository, AuditEventRepository } from '../repositories/offboarding-repository.js';
import { OffboardingJobMessage } from './async-job-dispatcher.js';
import { randomUUID } from 'node:crypto';

export interface OffboardingWorkerDeps {
  linePlatformClient: LinePlatformClient;
  offboardingJobRepository: OffboardingJobRepository;
  auditEventRepository: AuditEventRepository;
}

export async function handleOffboardingBatch(
  event: SQSEvent,
  deps: OffboardingWorkerDeps
): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    try {
      const message: OffboardingJobMessage = JSON.parse(record.body);

      await deps.linePlatformClient.unlinkRichMenu({
        tenantId: message.tenantId,
        lineUserId: message.lineUserId
      });

      const job = await deps.offboardingJobRepository.findById(message.jobId);
      if (job) {
        job.status = 'SUCCEEDED';
        job.updatedAt = new Date().toISOString();
        job.lastError = undefined;
        await deps.offboardingJobRepository.save(job);
      }

      await deps.auditEventRepository.append({
        eventId: `audit_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        tenantId: message.tenantId,
        employeeId: message.employeeId,
        actorId: message.actorId,
        action: 'RICH_MENU_UNLINK',
        outcome: 'SUCCESS',
        message: `Rich menu unlinked for line user ${message.lineUserId}`,
        createdAt: new Date().toISOString()
      });
    } catch {
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
