import { RefreshSessionRecord } from '../domain/auth.js';

export interface RefreshSessionRepository {
  create(record: RefreshSessionRecord): Promise<void>;
  findById(sessionId: string): Promise<RefreshSessionRecord | null>;
  findByTokenHash(refreshTokenHash: string): Promise<RefreshSessionRecord | null>;
  listByPrincipal(tenantId: string, lineUserId: string): Promise<RefreshSessionRecord[]>;
  save(record: RefreshSessionRecord): Promise<void>;
}

export interface RevokedJtiRepository {
  revokeJti(jti: string, expiresAtEpochSeconds: number): Promise<void>;
  isJtiRevoked(jti: string, nowEpochSeconds: number): Promise<boolean>;
}

export class InMemoryRefreshSessionRepository implements RefreshSessionRepository {
  private readonly byId = new Map<string, RefreshSessionRecord>();
  private readonly byTokenHash = new Map<string, string>();

  async create(record: RefreshSessionRecord): Promise<void> {
    this.byId.set(record.sessionId, record);
    this.byTokenHash.set(record.refreshTokenHash, record.sessionId);
  }

  async findById(sessionId: string): Promise<RefreshSessionRecord | null> {
    return this.byId.get(sessionId) ?? null;
  }

  async findByTokenHash(refreshTokenHash: string): Promise<RefreshSessionRecord | null> {
    const sessionId = this.byTokenHash.get(refreshTokenHash);

    if (!sessionId) {
      return null;
    }

    return this.byId.get(sessionId) ?? null;
  }

  async listByPrincipal(tenantId: string, lineUserId: string): Promise<RefreshSessionRecord[]> {
    return [...this.byId.values()].filter(
      (record) => record.tenantId === tenantId && record.lineUserId === lineUserId
    );
  }

  async save(record: RefreshSessionRecord): Promise<void> {
    this.byId.set(record.sessionId, record);
    this.byTokenHash.set(record.refreshTokenHash, record.sessionId);
  }
}

export class InMemoryRevokedJtiRepository implements RevokedJtiRepository {
  private readonly revoked = new Map<string, number>();

  async revokeJti(jti: string, expiresAtEpochSeconds: number): Promise<void> {
    this.revoked.set(jti, expiresAtEpochSeconds);
  }

  async isJtiRevoked(jti: string, nowEpochSeconds: number): Promise<boolean> {
    const expiresAt = this.revoked.get(jti);

    if (!expiresAt) {
      return false;
    }

    if (expiresAt <= nowEpochSeconds) {
      this.revoked.delete(jti);
      return false;
    }

    return true;
  }
}
