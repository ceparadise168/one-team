import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AdminAuthService } from './admin-auth-service.js';
import { InMemoryAdminAccountRepository } from '../repositories/admin-repository.js';

function createService(now = new Date('2025-06-01T00:00:00.000Z')) {
  const repo = new InMemoryAdminAccountRepository();
  const service = new AdminAuthService(repo, {
    issuer: 'one-team-api',
    tokenSecret: 'test-admin-secret-at-least-32-chars',
    tokenTtlSeconds: 3600,
    now: () => now
  });
  return { service, repo };
}

describe('AdminAuthService', () => {
  it('sets up admin account and logs in', async () => {
    const { service } = createService();

    const setup = await service.setup({
      email: 'admin@test.com',
      password: 'securepassword123'
    });
    assert.ok(setup.adminId.startsWith('admin_'));
    assert.equal(setup.email, 'admin@test.com');

    const login = await service.login({
      email: 'admin@test.com',
      password: 'securepassword123'
    });
    assert.ok(login.accessToken);
    assert.equal(login.admin.email, 'admin@test.com');
    assert.equal(login.expiresInSeconds, 3600);
  });

  it('validates admin token', async () => {
    const { service } = createService();

    await service.setup({ email: 'admin@test.com', password: 'securepassword123' });
    const login = await service.login({ email: 'admin@test.com', password: 'securepassword123' });

    const principal = service.validateAdminToken(login.accessToken);
    assert.equal(principal.email, 'admin@test.com');
  });

  it('rejects expired admin token', async () => {
    const now = new Date('2025-06-01T00:00:00.000Z');
    const { service } = createService(now);

    await service.setup({ email: 'admin@test.com', password: 'securepassword123' });
    const login = await service.login({ email: 'admin@test.com', password: 'securepassword123' });

    const laterService = new AdminAuthService(new InMemoryAdminAccountRepository(), {
      issuer: 'one-team-api',
      tokenSecret: 'test-admin-secret-at-least-32-chars',
      tokenTtlSeconds: 3600,
      now: () => new Date('2025-06-01T02:00:00.000Z')
    });

    assert.throws(() => laterService.validateAdminToken(login.accessToken), {
      message: 'Admin token has expired'
    });
  });

  it('rejects wrong password', async () => {
    const { service } = createService();

    await service.setup({ email: 'admin@test.com', password: 'securepassword123' });

    await assert.rejects(
      () => service.login({ email: 'admin@test.com', password: 'wrongpassword' }),
      { message: 'Invalid email or password' }
    );
  });

  it('rejects duplicate admin setup', async () => {
    const { service } = createService();

    await service.setup({ email: 'admin@test.com', password: 'securepassword123' });

    await assert.rejects(
      () => service.setup({ email: 'admin@test.com', password: 'anotherpassword123' }),
      { message: 'Admin account already exists for this email' }
    );
  });

  it('rejects short password on setup', async () => {
    const { service } = createService();

    await assert.rejects(
      () => service.setup({ email: 'admin@test.com', password: 'short' }),
      { message: 'Password must be at least 8 characters' }
    );
  });
});
