import { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { EmailAdapter } from '../email/email-adapter.js';
import {
  renderInvitationEmailHtml,
  renderInvitationEmailText,
  renderInvitationEmailSubject
} from '../email/invitation-email-template.js';
import { InvitationEmailMessage } from './async-job-dispatcher.js';
import { TenantRepository } from '../repositories/tenant-repository.js';
import { BatchInviteJobRepository } from '../repositories/invitation-binding-repository.js';

export interface InvitationEmailWorkerDeps {
  emailAdapter: EmailAdapter;
  tenantRepository: TenantRepository;
  batchInviteJobRepository: BatchInviteJobRepository;
}

export async function handleInvitationEmailBatch(
  event: SQSEvent,
  deps: InvitationEmailWorkerDeps
): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    try {
      const message: InvitationEmailMessage = JSON.parse(record.body);

      const tenant = await deps.tenantRepository.findById(message.tenantId);
      const tenantName = tenant?.tenantName ?? message.tenantId;

      const subject = renderInvitationEmailSubject(tenantName);
      const html = renderInvitationEmailHtml({
        tenantName,
        employeeId: message.employeeId,
        inviteUrl: message.invitationUrl,
        bindingCode: message.oneTimeBindingCode,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      });
      const text = renderInvitationEmailText({
        tenantName,
        employeeId: message.employeeId,
        inviteUrl: message.invitationUrl,
        bindingCode: message.oneTimeBindingCode,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      });

      await deps.emailAdapter.sendEmail({
        to: message.email,
        subject,
        html,
        text
      });

      await updateRecipientStatus(deps.batchInviteJobRepository, message.jobId, message.email, 'SENT');
    } catch {
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}

async function updateRecipientStatus(
  repo: BatchInviteJobRepository,
  jobId: string,
  email: string,
  status: 'SENT' | 'FAILED'
): Promise<void> {
  try {
    const job = await repo.findById(jobId);
    if (!job) return;

    const updated = {
      ...job,
      recipients: job.recipients.map((r) =>
        r.email === email ? { ...r, status } : r
      )
    };

    await repo.save(updated);
  } catch {
    // Best-effort status update; the email was already sent
  }
}
