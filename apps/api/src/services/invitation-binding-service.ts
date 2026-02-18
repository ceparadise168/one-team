import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import {
  BatchInviteJobRecord,
  BindingSessionRecord,
  EmployeeBindingRecord,
  EmployeeEnrollmentRecord,
  InvitationRecord
} from '../domain/invitation-binding.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { LineAuthClient } from '../line/line-auth-client.js';
import {
  BatchInviteJobRepository,
  BindingSessionRepository,
  EmployeeBindingRepository,
  EmployeeEnrollmentRepository,
  InvitationRepository
} from '../repositories/invitation-binding-repository.js';
import { TenantRepository } from '../repositories/tenant-repository.js';

interface ServiceOptions {
  inviteBaseUrl: string;
  sessionTtlMinutes: number;
  maxBindingAttempts: number;
  lockoutMinutes: number;
  now: () => Date;
}

export interface CreateInvitationInput {
  tenantId: string;
  ttlMinutes: number;
  usageLimit: number;
}

export interface CreateInvitationOutput {
  invitationId: string;
  invitationToken: string;
  invitationUrl: string;
  expiresAt: string;
  usageLimit: number;
}

export interface BatchInviteInput {
  tenantId: string;
  recipients: Array<{
    email: string;
    employeeId: string;
  }>;
  ttlMinutes: number;
}

export interface BatchInviteOutput {
  jobId: string;
  tenantId: string;
  createdAt: string;
  recipients: BatchInviteJobRecord['recipients'];
}

export interface StartBindingInput {
  lineIdToken: string;
  invitationToken: string;
}

export interface StartBindingOutput {
  bindSessionToken: string;
  tenantId: string;
  lineUserId: string;
  expiresAt: string;
}

export interface CompleteBindingInput {
  bindSessionToken: string;
  employeeId: string;
  bindingCode: string;
}

export interface CompleteBindingOutput {
  tenantId: string;
  lineUserId: string;
  employeeId: string;
  auth: {
    accessToken: string;
    refreshSessionId: string;
    expiresInSeconds: number;
  };
}

const DEFAULT_OPTIONS: ServiceOptions = {
  inviteBaseUrl: 'https://app.example.com/invite',
  sessionTtlMinutes: 10,
  maxBindingAttempts: 5,
  lockoutMinutes: 15,
  now: () => new Date()
};

export class InvitationBindingService {
  constructor(
    private readonly tenantRepository: TenantRepository,
    private readonly invitationRepository: InvitationRepository,
    private readonly batchInviteJobRepository: BatchInviteJobRepository,
    private readonly bindingSessionRepository: BindingSessionRepository,
    private readonly enrollmentRepository: EmployeeEnrollmentRepository,
    private readonly employeeBindingRepository: EmployeeBindingRepository,
    private readonly lineAuthClient: LineAuthClient,
    private readonly options: ServiceOptions = DEFAULT_OPTIONS
  ) {}

  async createInvitation(input: CreateInvitationInput): Promise<CreateInvitationOutput> {
    await this.assertTenantExists(input.tenantId);

    if (input.ttlMinutes <= 0 || input.ttlMinutes > 24 * 60) {
      throw new ValidationError('ttlMinutes must be between 1 and 1440');
    }

    if (input.usageLimit <= 0 || input.usageLimit > 50) {
      throw new ValidationError('usageLimit must be between 1 and 50');
    }

    const invitationToken = this.randomToken(24);
    const invitationId = `invite_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const now = this.options.now();
    const expiresAt = new Date(now.getTime() + input.ttlMinutes * 60 * 1000).toISOString();

    const record: InvitationRecord = {
      invitationId,
      tenantId: input.tenantId,
      tokenHash: this.hash(invitationToken),
      createdAt: now.toISOString(),
      expiresAt,
      usageLimit: input.usageLimit,
      usedCount: 0,
      status: 'ACTIVE'
    };

    await this.invitationRepository.create(record);

    return {
      invitationId,
      invitationToken,
      invitationUrl: this.buildInviteUrl(invitationToken),
      expiresAt,
      usageLimit: input.usageLimit
    };
  }

  async createBatchInvites(input: BatchInviteInput): Promise<BatchInviteOutput> {
    await this.assertTenantExists(input.tenantId);

    if (input.recipients.length === 0) {
      throw new ValidationError('recipients must contain at least one entry');
    }

    if (input.recipients.length > 500) {
      throw new ValidationError('recipients cannot exceed 500 entries');
    }

    const nowIso = this.options.now().toISOString();
    const jobId = `job_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

    const seenEmployeeIds = new Set<string>();
    const seenEmails = new Set<string>();

    const recipients = await Promise.all(
      input.recipients.map(async (recipient) => {
        const email = recipient.email.trim().toLowerCase();
        const employeeId = recipient.employeeId.trim();

        if (!email.includes('@')) {
          return {
            email,
            employeeId,
            status: 'FAILED' as const,
            reason: 'Invalid email format'
          };
        }

        if (!employeeId) {
          return {
            email,
            employeeId,
            status: 'FAILED' as const,
            reason: 'employeeId is required'
          };
        }

        if (seenEmployeeIds.has(employeeId)) {
          return {
            email,
            employeeId,
            status: 'FAILED' as const,
            reason: 'Duplicate employeeId in batch'
          };
        }

        if (seenEmails.has(email)) {
          return {
            email,
            employeeId,
            status: 'FAILED' as const,
            reason: 'Duplicate email in batch'
          };
        }

        seenEmployeeIds.add(employeeId);
        seenEmails.add(email);

        const invite = await this.createInvitation({
          tenantId: input.tenantId,
          ttlMinutes: input.ttlMinutes,
          usageLimit: 1
        });

        const oneTimeBindingCode = this.randomBindingCode();
        const enrollment: EmployeeEnrollmentRecord = {
          tenantId: input.tenantId,
          employeeId,
          email,
          bindingCodeHash: this.hash(oneTimeBindingCode),
          codeIssuedAt: nowIso
        };
        await this.enrollmentRepository.upsert(enrollment);

        return {
          email,
          employeeId,
          status: 'SENT' as const,
          invitationId: invite.invitationId,
          invitationToken: invite.invitationToken,
          invitationUrl: invite.invitationUrl,
          oneTimeBindingCode
        };
      })
    );

    const jobRecord: BatchInviteJobRecord = {
      jobId,
      tenantId: input.tenantId,
      createdAt: nowIso,
      recipients
    };

    await this.batchInviteJobRepository.create(jobRecord);

    return jobRecord;
  }

  async startBinding(input: StartBindingInput): Promise<StartBindingOutput> {
    const lineIdentity = await this.lineAuthClient.validateIdToken(input.lineIdToken);

    const invitation = await this.getAndValidateInvitation(input.invitationToken);

    const existingLineBinding = await this.employeeBindingRepository.findActiveByLineUserId(
      invitation.tenantId,
      lineIdentity.lineUserId
    );

    if (existingLineBinding) {
      throw new ConflictError('LINE account is already bound to an active employee identity');
    }

    const bindSessionToken = this.randomToken(24);
    const now = this.options.now();
    const expiresAt = new Date(now.getTime() + this.options.sessionTtlMinutes * 60 * 1000).toISOString();

    const session: BindingSessionRecord = {
      sessionId: `session_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      tenantId: invitation.tenantId,
      lineUserId: lineIdentity.lineUserId,
      invitationId: invitation.invitationId,
      sessionTokenHash: this.hash(bindSessionToken),
      createdAt: now.toISOString(),
      expiresAt,
      failedAttempts: 0
    };

    await this.bindingSessionRepository.create(session);

    return {
      bindSessionToken,
      tenantId: invitation.tenantId,
      lineUserId: lineIdentity.lineUserId,
      expiresAt
    };
  }

  async completeBinding(input: CompleteBindingInput): Promise<CompleteBindingOutput> {
    const sessionHash = this.hash(input.bindSessionToken);
    const session = await this.bindingSessionRepository.findByTokenHash(sessionHash);

    if (!session) {
      throw new ValidationError('Binding session is invalid or expired');
    }

    if (session.completedAt) {
      throw new ValidationError('Binding session is already completed');
    }

    const now = this.options.now();

    if (new Date(session.expiresAt).getTime() <= now.getTime()) {
      throw new ValidationError('Binding session expired');
    }

    if (session.lockoutUntil && new Date(session.lockoutUntil).getTime() > now.getTime()) {
      throw new ValidationError('Binding is temporarily locked due to repeated failures');
    }

    const enrollment = await this.enrollmentRepository.findByEmployeeId(session.tenantId, input.employeeId);

    if (!enrollment) {
      await this.recordFailedBindingAttempt(session, now);
      throw new ValidationError('Employee identity is not eligible for binding');
    }

    if (enrollment.codeUsedAt) {
      throw new ConflictError('Binding code already used');
    }

    if (enrollment.bindingCodeHash !== this.hash(input.bindingCode)) {
      await this.recordFailedBindingAttempt(session, now);
      throw new ValidationError('Binding code is invalid');
    }

    const existingLineBinding = await this.employeeBindingRepository.findActiveByLineUserId(
      session.tenantId,
      session.lineUserId
    );

    if (existingLineBinding && existingLineBinding.employeeId !== input.employeeId) {
      throw new ConflictError('LINE account is already bound to another employee identity');
    }

    const existingEmployeeBinding = await this.employeeBindingRepository.findActiveByEmployeeId(
      session.tenantId,
      input.employeeId
    );

    if (existingEmployeeBinding && existingEmployeeBinding.lineUserId !== session.lineUserId) {
      throw new ConflictError('Employee identity is already bound to another LINE account');
    }

    const invitation = await this.invitationRepository.findById(session.invitationId);
    if (!invitation) {
      throw new NotFoundError(`Invitation not found: ${session.invitationId}`);
    }

    if (invitation.usedCount >= invitation.usageLimit) {
      throw new ValidationError('Invitation usage limit has been reached');
    }

    invitation.usedCount += 1;
    await this.invitationRepository.save(invitation);

    enrollment.codeUsedAt = now.toISOString();
    await this.enrollmentRepository.save(enrollment);

    const binding: EmployeeBindingRecord = {
      tenantId: session.tenantId,
      employeeId: input.employeeId,
      lineUserId: session.lineUserId,
      boundAt: now.toISOString(),
      employmentStatus: 'ACTIVE'
    };

    await this.employeeBindingRepository.upsert(binding);

    session.failedAttempts = 0;
    session.completedAt = now.toISOString();
    session.lockoutUntil = undefined;
    await this.bindingSessionRepository.save(session);

    return {
      tenantId: session.tenantId,
      lineUserId: session.lineUserId,
      employeeId: input.employeeId,
      auth: {
        accessToken: this.createEphemeralAccessToken(session.tenantId, session.lineUserId, input.employeeId),
        refreshSessionId: `refresh_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        expiresInSeconds: 10 * 60
      }
    };
  }

  private async recordFailedBindingAttempt(session: BindingSessionRecord, now: Date): Promise<void> {
    session.failedAttempts += 1;

    if (session.failedAttempts >= this.options.maxBindingAttempts) {
      session.lockoutUntil = new Date(now.getTime() + this.options.lockoutMinutes * 60 * 1000).toISOString();
      session.failedAttempts = 0;
    }

    await this.bindingSessionRepository.save(session);
  }

  private async getAndValidateInvitation(invitationToken: string): Promise<InvitationRecord> {
    const invitation = await this.invitationRepository.findByTokenHash(this.hash(invitationToken));

    if (!invitation) {
      throw new ValidationError('Invitation token is invalid');
    }

    if (invitation.status !== 'ACTIVE') {
      throw new ValidationError('Invitation token is not active');
    }

    const now = this.options.now();

    if (new Date(invitation.expiresAt).getTime() <= now.getTime()) {
      throw new ValidationError('Invitation token expired');
    }

    if (invitation.usedCount >= invitation.usageLimit) {
      throw new ValidationError('Invitation token usage exhausted');
    }

    return invitation;
  }

  private async assertTenantExists(tenantId: string): Promise<void> {
    const tenant = await this.tenantRepository.findById(tenantId);

    if (!tenant) {
      throw new NotFoundError(`Tenant not found: ${tenantId}`);
    }
  }

  private buildInviteUrl(invitationToken: string): string {
    const encodedToken = encodeURIComponent(invitationToken);
    const base = this.options.inviteBaseUrl.replace(/\/$/, '');

    return `${base}?token=${encodedToken}`;
  }

  private randomToken(byteLength: number): string {
    return randomBytes(byteLength).toString('base64url');
  }

  private randomBindingCode(): string {
    return `${randomInt(0, 1_0000_0000)}`.padStart(8, '0');
  }

  private hash(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }

  private createEphemeralAccessToken(tenantId: string, lineUserId: string, employeeId: string): string {
    const payload = JSON.stringify({ tenantId, lineUserId, employeeId, ts: this.options.now().toISOString() });
    return Buffer.from(payload, 'utf8').toString('base64url');
  }
}
