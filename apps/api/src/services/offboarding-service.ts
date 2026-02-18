import { randomUUID } from 'node:crypto';
import { NotFoundError } from '../errors.js';
import { LinePlatformClient } from '../line/line-platform-client.js';
import { AccessControlRepository } from '../repositories/access-control-repository.js';
import { EmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
import { AuditEventRepository, OffboardingJobRepository } from '../repositories/offboarding-repository.js';
import { AuthSessionService } from './auth-session-service.js';
import { AuditEventRecord, OffboardingJobRecord } from '../domain/offboarding.js';

interface ServiceOptions {
  now: () => Date;
  maxAttempts: number;
  backoffBaseSeconds: number;
}

const DEFAULT_OPTIONS: ServiceOptions = {
  now: () => new Date(),
  maxAttempts: 5,
  backoffBaseSeconds: 30
};

export class OffboardingService {
  constructor(
    private readonly employeeBindingRepository: EmployeeBindingRepository,
    private readonly accessControlRepository: AccessControlRepository,
    private readonly offboardingJobRepository: OffboardingJobRepository,
    private readonly auditEventRepository: AuditEventRepository,
    private readonly authSessionService: AuthSessionService,
    private readonly linePlatformClient: LinePlatformClient,
    private readonly options: ServiceOptions = DEFAULT_OPTIONS
  ) {}

  async offboardEmployee(input: {
    tenantId: string;
    employeeId: string;
    actorId: string;
  }): Promise<{ idempotent: boolean; job: OffboardingJobRecord }> {
    const binding = await this.employeeBindingRepository.findByEmployeeId(input.tenantId, input.employeeId);

    if (!binding) {
      throw new NotFoundError(`Active employee binding not found: ${input.employeeId}`);
    }

    if (binding.employmentStatus === 'OFFBOARDED') {
      const existingJob: OffboardingJobRecord = {
        jobId: `job_existing_${input.employeeId}`,
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        lineUserId: binding.lineUserId,
        actorId: input.actorId,
        attempts: 0,
        maxAttempts: this.options.maxAttempts,
        status: 'SUCCEEDED',
        nextAttemptAt: this.options.now().toISOString(),
        createdAt: this.options.now().toISOString(),
        updatedAt: this.options.now().toISOString()
      };

      return {
        idempotent: true,
        job: existingJob
      };
    }

    binding.employmentStatus = 'OFFBOARDED';
    await this.employeeBindingRepository.upsert(binding);

    await this.accessControlRepository.addBlacklistedEmployee(input.tenantId, input.employeeId);
    await this.accessControlRepository.addBlacklistedLineUser(input.tenantId, binding.lineUserId);

    await this.authSessionService.revokeAllSessionsForPrincipal({
      tenantId: input.tenantId,
      lineUserId: binding.lineUserId
    });

    const nowIso = this.options.now().toISOString();
    const job: OffboardingJobRecord = {
      jobId: `job_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      lineUserId: binding.lineUserId,
      actorId: input.actorId,
      attempts: 0,
      maxAttempts: this.options.maxAttempts,
      status: 'QUEUED',
      nextAttemptAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    await this.offboardingJobRepository.create(job);

    await this.appendAuditEvent({
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      actorId: input.actorId,
      action: 'EMPLOYEE_OFFBOARDED',
      outcome: 'SUCCESS',
      message: 'Employee status changed to OFFBOARDED and sessions revoked'
    });

    const processed = await this.processOffboardingJob({
      jobId: job.jobId,
      actorId: input.actorId
    });

    return {
      idempotent: false,
      job: processed
    };
  }

  async processOffboardingJob(input: {
    jobId: string;
    actorId: string;
  }): Promise<OffboardingJobRecord> {
    const job = await this.offboardingJobRepository.findById(input.jobId);

    if (!job) {
      throw new NotFoundError(`Offboarding job not found: ${input.jobId}`);
    }

    if (job.status === 'SUCCEEDED' || job.status === 'FAILED') {
      return job;
    }

    try {
      await this.linePlatformClient.unlinkRichMenu({
        tenantId: job.tenantId,
        lineUserId: job.lineUserId
      });
      job.status = 'SUCCEEDED';
      job.updatedAt = this.options.now().toISOString();
      job.lastError = undefined;
      await this.offboardingJobRepository.save(job);

      await this.appendAuditEvent({
        tenantId: job.tenantId,
        employeeId: job.employeeId,
        actorId: input.actorId,
        action: 'RICH_MENU_UNLINK',
        outcome: 'SUCCESS',
        message: `Rich menu unlinked for line user ${job.lineUserId}`
      });

      return job;
    } catch (error) {
      job.attempts += 1;
      job.updatedAt = this.options.now().toISOString();
      job.lastError = error instanceof Error ? error.message : 'Unknown error';

      if (job.attempts >= job.maxAttempts) {
        job.status = 'FAILED';
        await this.offboardingJobRepository.save(job);

        await this.appendAuditEvent({
          tenantId: job.tenantId,
          employeeId: job.employeeId,
          actorId: input.actorId,
          action: 'RICH_MENU_UNLINK',
          outcome: 'FAILED',
          message: 'Rich menu unlink failed after retries',
          metadata: {
            attempts: job.attempts,
            alertRecommended: true
          }
        });

        return job;
      }

      job.status = 'RETRY_SCHEDULED';
      const backoffSeconds = this.options.backoffBaseSeconds * 2 ** Math.max(job.attempts - 1, 0);
      job.nextAttemptAt = new Date(this.options.now().getTime() + backoffSeconds * 1000).toISOString();
      await this.offboardingJobRepository.save(job);

      await this.appendAuditEvent({
        tenantId: job.tenantId,
        employeeId: job.employeeId,
        actorId: input.actorId,
        action: 'RICH_MENU_UNLINK',
        outcome: 'RETRY_SCHEDULED',
        message: job.lastError,
        metadata: {
          attempts: job.attempts,
          nextAttemptAt: job.nextAttemptAt
        }
      });

      return job;
    }
  }

  async listAuditEvents(tenantId: string): Promise<AuditEventRecord[]> {
    return this.auditEventRepository.listByTenant(tenantId);
  }

  private async appendAuditEvent(event: Omit<AuditEventRecord, 'eventId' | 'createdAt'>): Promise<void> {
    await this.auditEventRepository.append({
      ...event,
      eventId: `audit_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      createdAt: this.options.now().toISOString()
    });
  }
}
