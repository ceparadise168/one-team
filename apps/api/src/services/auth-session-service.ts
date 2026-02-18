import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AccessTokenPayload, AuthPrincipal, RefreshSessionRecord } from '../domain/auth.js';
import { UnauthorizedError } from '../errors.js';
import {
  EmployeeBindingRepository
} from '../repositories/invitation-binding-repository.js';
import { RefreshSessionRepository, RevokedJtiRepository } from '../repositories/auth-repository.js';
import { createSignedAccessToken, verifySignedAccessToken } from '../security/access-token.js';

interface ServiceOptions {
  issuer: string;
  accessTokenTtlSeconds: number;
  refreshSessionTtlSeconds: number;
  accessTokenSecret: string;
  now: () => Date;
}

export interface IssueSessionInput {
  tenantId: string;
  lineUserId: string;
  employeeId: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  refreshSessionId: string;
  expiresInSeconds: number;
}

export interface RefreshSessionInput {
  refreshToken: string;
}

const DEFAULT_OPTIONS: ServiceOptions = {
  issuer: 'one-team-api',
  accessTokenTtlSeconds: 600,
  refreshSessionTtlSeconds: 7 * 24 * 60 * 60,
  accessTokenSecret: 'dev-secret-change-me',
  now: () => new Date()
};

export class AuthSessionService {
  constructor(
    private readonly refreshSessionRepository: RefreshSessionRepository,
    private readonly revokedJtiRepository: RevokedJtiRepository,
    private readonly employeeBindingRepository: EmployeeBindingRepository,
    private readonly options: ServiceOptions = DEFAULT_OPTIONS
  ) {}

  async issueEmployeeSession(input: IssueSessionInput): Promise<AuthTokens> {
    const activeBinding = await this.employeeBindingRepository.findActiveByEmployeeId(
      input.tenantId,
      input.employeeId
    );

    if (!activeBinding || activeBinding.lineUserId !== input.lineUserId) {
      throw new UnauthorizedError('Employee binding is not active');
    }

    const now = this.options.now();
    const refreshToken = this.randomToken(32);
    const refreshTokenHash = this.hash(refreshToken);
    const sessionId = `session_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

    const session: RefreshSessionRecord = {
      sessionId,
      tenantId: input.tenantId,
      lineUserId: input.lineUserId,
      employeeId: input.employeeId,
      refreshTokenHash,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.options.refreshSessionTtlSeconds * 1000).toISOString(),
      status: 'ACTIVE',
      updatedAt: now.toISOString()
    };

    await this.refreshSessionRepository.create(session);

    const accessToken = this.createAccessToken({
      tenantId: input.tenantId,
      lineUserId: input.lineUserId,
      employeeId: input.employeeId,
      sessionId
    });

    return {
      accessToken,
      refreshToken,
      refreshSessionId: sessionId,
      expiresInSeconds: this.options.accessTokenTtlSeconds
    };
  }

  async refreshEmployeeSession(input: RefreshSessionInput): Promise<AuthTokens> {
    const tokenHash = this.hash(input.refreshToken);
    const session = await this.refreshSessionRepository.findByTokenHash(tokenHash);

    if (!session) {
      throw new UnauthorizedError('Refresh token is invalid');
    }

    const now = this.options.now();

    if (session.status !== 'ACTIVE') {
      throw new UnauthorizedError('Refresh session is revoked');
    }

    if (new Date(session.expiresAt).getTime() <= now.getTime()) {
      throw new UnauthorizedError('Refresh token expired');
    }

    const activeBinding = await this.employeeBindingRepository.findActiveByEmployeeId(
      session.tenantId,
      session.employeeId
    );

    if (!activeBinding || activeBinding.lineUserId !== session.lineUserId) {
      throw new UnauthorizedError('Employee binding is no longer active');
    }

    const rotatedRefreshToken = this.randomToken(32);
    session.refreshTokenHash = this.hash(rotatedRefreshToken);
    session.updatedAt = now.toISOString();
    await this.refreshSessionRepository.save(session);

    const accessToken = this.createAccessToken({
      tenantId: session.tenantId,
      lineUserId: session.lineUserId,
      employeeId: session.employeeId,
      sessionId: session.sessionId
    });

    return {
      accessToken,
      refreshToken: rotatedRefreshToken,
      refreshSessionId: session.sessionId,
      expiresInSeconds: this.options.accessTokenTtlSeconds
    };
  }

  async validateAccessToken(accessToken: string, requiredTenantId?: string): Promise<AuthPrincipal> {
    const payload = verifySignedAccessToken(accessToken, this.options.accessTokenSecret);
    const nowEpochSeconds = Math.floor(this.options.now().getTime() / 1000);

    if (payload.exp <= nowEpochSeconds) {
      throw new UnauthorizedError('Access token expired');
    }

    if (requiredTenantId && payload.tenantId !== requiredTenantId) {
      throw new UnauthorizedError('Access token tenant scope mismatch');
    }

    const isRevoked = await this.revokedJtiRepository.isJtiRevoked(payload.jti, nowEpochSeconds);

    if (isRevoked) {
      throw new UnauthorizedError('Access token is revoked');
    }

    const session = await this.refreshSessionRepository.findById(payload.sessionId);

    if (!session || session.status !== 'ACTIVE') {
      throw new UnauthorizedError('Refresh session is invalid');
    }

    if (new Date(session.expiresAt).getTime() <= this.options.now().getTime()) {
      throw new UnauthorizedError('Refresh session expired');
    }

    if (
      session.tenantId !== payload.tenantId ||
      session.lineUserId !== payload.lineUserId ||
      session.employeeId !== payload.employeeId
    ) {
      throw new UnauthorizedError('Session principal mismatch');
    }

    const activeBinding = await this.employeeBindingRepository.findActiveByEmployeeId(
      payload.tenantId,
      payload.employeeId
    );

    if (!activeBinding || activeBinding.lineUserId !== payload.lineUserId) {
      throw new UnauthorizedError('Employee is no longer active');
    }

    return {
      tenantId: payload.tenantId,
      lineUserId: payload.lineUserId,
      employeeId: payload.employeeId,
      sessionId: payload.sessionId,
      jti: payload.jti,
      exp: payload.exp
    };
  }

  async revokeSessionByRefreshToken(refreshToken: string): Promise<void> {
    const session = await this.refreshSessionRepository.findByTokenHash(this.hash(refreshToken));

    if (!session) {
      return;
    }

    session.status = 'REVOKED';
    session.updatedAt = this.options.now().toISOString();
    await this.refreshSessionRepository.save(session);
  }

  async revokeAllSessionsForPrincipal(input: { tenantId: string; lineUserId: string }): Promise<void> {
    const sessions = await this.refreshSessionRepository.listByPrincipal(input.tenantId, input.lineUserId);

    await Promise.all(
      sessions.map(async (session) => {
        session.status = 'REVOKED';
        session.updatedAt = this.options.now().toISOString();
        await this.refreshSessionRepository.save(session);
      })
    );
  }

  async revokeAccessTokenJti(accessToken: string): Promise<void> {
    const payload = verifySignedAccessToken(accessToken, this.options.accessTokenSecret);

    await this.revokedJtiRepository.revokeJti(payload.jti, payload.exp);
  }

  private createAccessToken(input: {
    tenantId: string;
    lineUserId: string;
    employeeId: string;
    sessionId: string;
  }): string {
    const nowEpochSeconds = Math.floor(this.options.now().getTime() / 1000);

    const payload: AccessTokenPayload = {
      iss: this.options.issuer,
      typ: 'access',
      tenantId: input.tenantId,
      lineUserId: input.lineUserId,
      employeeId: input.employeeId,
      sessionId: input.sessionId,
      jti: randomUUID().replace(/-/g, ''),
      iat: nowEpochSeconds,
      exp: nowEpochSeconds + this.options.accessTokenTtlSeconds
    };

    return createSignedAccessToken(payload, this.options.accessTokenSecret);
  }

  private randomToken(byteLength: number): string {
    return randomBytes(byteLength).toString('base64url');
  }

  private hash(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }
}
