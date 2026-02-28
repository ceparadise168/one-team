import { scryptSync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { AdminAccountRecord, AdminPrincipal, AdminTokenPayload } from '../domain/admin-auth.js';
import { UnauthorizedError, ConflictError, ValidationError } from '../errors.js';
import { AdminAccountRepository } from '../repositories/admin-repository.js';
import { createSignedAdminToken, verifySignedAdminToken } from '../security/admin-access-token.js';

interface AdminAuthServiceOptions {
  issuer: string;
  tokenSecret: string;
  tokenTtlSeconds: number;
  now: () => Date;
}

export class AdminAuthService {
  constructor(
    private readonly adminAccountRepository: AdminAccountRepository,
    private readonly options: AdminAuthServiceOptions
  ) {}

  async setup(input: { email: string; password: string }): Promise<{ adminId: string; email: string }> {
    const email = input.email.trim().toLowerCase();

    if (!email || !email.includes('@')) {
      throw new ValidationError('Valid email is required');
    }

    if (input.password.length < 8) {
      throw new ValidationError('Password must be at least 8 characters');
    }

    const existing = await this.adminAccountRepository.findByEmail(email);
    if (existing) {
      throw new ConflictError('Admin account already exists for this email');
    }

    const salt = randomBytes(32).toString('hex');
    const passwordHash = this.hashPassword(input.password, salt);
    const adminId = `admin_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const nowIso = this.options.now().toISOString();

    const record: AdminAccountRecord = {
      adminId,
      email,
      passwordHash,
      salt,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    await this.adminAccountRepository.create(record);

    return { adminId, email };
  }

  async login(input: { email: string; password: string }): Promise<{
    accessToken: string;
    admin: AdminPrincipal;
    expiresInSeconds: number;
  }> {
    const email = input.email.trim().toLowerCase();
    const account = await this.adminAccountRepository.findByEmail(email);

    if (!account) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const passwordHash = this.hashPassword(input.password, account.salt);
    const expectedHash = Buffer.from(account.passwordHash, 'hex');
    const actualHash = Buffer.from(passwordHash, 'hex');

    if (expectedHash.length !== actualHash.length || !timingSafeEqual(expectedHash, actualHash)) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const now = this.options.now();
    const payload: AdminTokenPayload = {
      iss: this.options.issuer,
      typ: 'admin',
      adminId: account.adminId,
      email: account.email,
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(now.getTime() / 1000) + this.options.tokenTtlSeconds
    };

    const accessToken = createSignedAdminToken(payload, this.options.tokenSecret);

    return {
      accessToken,
      admin: {
        adminId: account.adminId,
        email: account.email
      },
      expiresInSeconds: this.options.tokenTtlSeconds
    };
  }

  validateAdminToken(token: string): AdminPrincipal {
    const payload = verifySignedAdminToken(token, this.options.tokenSecret);

    const nowEpoch = Math.floor(this.options.now().getTime() / 1000);
    if (payload.exp <= nowEpoch) {
      throw new UnauthorizedError('Admin token has expired');
    }

    return {
      adminId: payload.adminId,
      email: payload.email
    };
  }

  private hashPassword(password: string, salt: string): string {
    return scryptSync(password, salt, 64).toString('hex');
  }
}
