import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  DigitalIdPayload,
  DigitalIdVerificationResult,
  GeneratedDigitalId
} from '../domain/digital-id.js';
import { EmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
import { AccessControlRepository } from '../repositories/access-control-repository.js';

interface ServiceOptions {
  signingSecret: string;
  windowSeconds: number;
  toleranceWindows: number;
  now: () => Date;
}

const DEFAULT_OPTIONS: ServiceOptions = {
  signingSecret: 'digital-id-dev-secret',
  windowSeconds: 30,
  toleranceWindows: 1,
  now: () => new Date()
};

export class DigitalIdService {
  constructor(
    private readonly employeeBindingRepository: EmployeeBindingRepository,
    private readonly accessControlRepository: AccessControlRepository,
    private readonly options: ServiceOptions = DEFAULT_OPTIONS
  ) {}

  async generateDynamicPayload(input: {
    tenantId: string;
    employeeId: string;
    lineUserId: string;
  }): Promise<GeneratedDigitalId> {
    const nowEpochSeconds = Math.floor(this.options.now().getTime() / 1000);
    const windowStart = Math.floor(nowEpochSeconds / this.options.windowSeconds) * this.options.windowSeconds;
    const exp = windowStart + this.options.windowSeconds;

    const payload: DigitalIdPayload = {
      v: 1,
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      lineUserId: input.lineUserId,
      iat: nowEpochSeconds,
      windowStart,
      exp
    };

    const token = this.signPayload(payload);

    return {
      payload: token,
      expiresAtEpochSeconds: exp,
      refreshInSeconds: Math.max(exp - nowEpochSeconds, 0)
    };
  }

  async verifyDynamicPayload(token: string): Promise<DigitalIdVerificationResult> {
    const parsed = this.parseAndVerifyToken(token);

    if (!parsed) {
      return {
        valid: false,
        reasonCode: 'SIGNATURE_INVALID'
      };
    }

    const nowEpochSeconds = Math.floor(this.options.now().getTime() / 1000);
    const tolerance = this.options.windowSeconds * this.options.toleranceWindows;

    if (nowEpochSeconds > parsed.exp + tolerance || nowEpochSeconds < parsed.windowStart - tolerance) {
      return {
        valid: false,
        reasonCode: 'EXPIRED',
        tenantId: parsed.tenantId,
        employeeId: parsed.employeeId,
        lineUserId: parsed.lineUserId,
        expiresAtEpochSeconds: parsed.exp
      };
    }

    const blacklisted = await this.accessControlRepository.isBlacklisted({
      tenantId: parsed.tenantId,
      employeeId: parsed.employeeId,
      lineUserId: parsed.lineUserId
    });

    if (blacklisted) {
      return {
        valid: false,
        reasonCode: 'BLACKLISTED',
        tenantId: parsed.tenantId,
        employeeId: parsed.employeeId,
        lineUserId: parsed.lineUserId,
        expiresAtEpochSeconds: parsed.exp
      };
    }

    const activeBinding = await this.employeeBindingRepository.findActiveByEmployeeId(
      parsed.tenantId,
      parsed.employeeId
    );

    if (!activeBinding || activeBinding.lineUserId !== parsed.lineUserId) {
      return {
        valid: false,
        reasonCode: 'NOT_ACTIVE',
        tenantId: parsed.tenantId,
        employeeId: parsed.employeeId,
        lineUserId: parsed.lineUserId,
        expiresAtEpochSeconds: parsed.exp
      };
    }

    return {
      valid: true,
      reasonCode: 'VALID',
      tenantId: parsed.tenantId,
      employeeId: parsed.employeeId,
      lineUserId: parsed.lineUserId,
      expiresAtEpochSeconds: parsed.exp
    };
  }

  private signPayload(payload: DigitalIdPayload): string {
    const payloadSegment = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', this.options.signingSecret)
      .update(payloadSegment)
      .digest('base64url');

    return `${payloadSegment}.${signature}`;
  }

  private parseAndVerifyToken(token: string): DigitalIdPayload | null {
    const parts = token.split('.');

    if (parts.length !== 2) {
      return null;
    }

    const [payloadSegment, signatureSegment] = parts;

    if (!payloadSegment || !signatureSegment) {
      return null;
    }

    const expectedSignature = createHmac('sha256', this.options.signingSecret)
      .update(payloadSegment)
      .digest('base64url');

    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const providedBuffer = Buffer.from(signatureSegment, 'utf8');

    if (expectedBuffer.length !== providedBuffer.length) {
      return null;
    }

    if (!timingSafeEqual(expectedBuffer, providedBuffer)) {
      return null;
    }

    try {
      const parsed = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as DigitalIdPayload;

      if (
        parsed.v !== 1 ||
        !parsed.tenantId ||
        !parsed.employeeId ||
        !parsed.lineUserId ||
        typeof parsed.windowStart !== 'number' ||
        typeof parsed.exp !== 'number'
      ) {
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }
}
