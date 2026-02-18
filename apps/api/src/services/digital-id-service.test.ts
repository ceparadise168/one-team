import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryEmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
import { InMemoryAccessControlRepository } from '../repositories/access-control-repository.js';
import { DigitalIdService } from './digital-id-service.js';

test('generates and verifies valid digital ID payload', async () => {
  const now = new Date('2026-02-18T00:00:10.000Z');
  const bindingRepository = new InMemoryEmployeeBindingRepository();
  await bindingRepository.upsert({
    tenantId: 'tenant_a',
    employeeId: 'E001',
    lineUserId: 'U001',
    boundAt: now.toISOString(),
    employmentStatus: 'ACTIVE'
  });

  const service = new DigitalIdService(bindingRepository, new InMemoryAccessControlRepository(), {
    signingSecret: 'digital-id-test-secret',
    windowSeconds: 30,
    toleranceWindows: 1,
    now: () => now
  });

  const generated = await service.generateDynamicPayload({
    tenantId: 'tenant_a',
    employeeId: 'E001',
    lineUserId: 'U001'
  });

  const verification = await service.verifyDynamicPayload(generated.payload);

  assert.equal(verification.valid, true);
  assert.equal(verification.reasonCode, 'VALID');
});

test('tampered payload fails signature check', async () => {
  const now = new Date('2026-02-18T00:00:10.000Z');
  const bindingRepository = new InMemoryEmployeeBindingRepository();
  await bindingRepository.upsert({
    tenantId: 'tenant_a',
    employeeId: 'E001',
    lineUserId: 'U001',
    boundAt: now.toISOString(),
    employmentStatus: 'ACTIVE'
  });

  const service = new DigitalIdService(bindingRepository, new InMemoryAccessControlRepository(), {
    signingSecret: 'digital-id-test-secret',
    windowSeconds: 30,
    toleranceWindows: 1,
    now: () => now
  });

  const generated = await service.generateDynamicPayload({
    tenantId: 'tenant_a',
    employeeId: 'E001',
    lineUserId: 'U001'
  });

  const tampered = `${generated.payload}tamper`;
  const verification = await service.verifyDynamicPayload(tampered);

  assert.equal(verification.valid, false);
  assert.equal(verification.reasonCode, 'SIGNATURE_INVALID');
});

test('expired payload is rejected', async () => {
  const now = new Date('2026-02-18T00:00:10.000Z');
  const bindingRepository = new InMemoryEmployeeBindingRepository();
  await bindingRepository.upsert({
    tenantId: 'tenant_a',
    employeeId: 'E001',
    lineUserId: 'U001',
    boundAt: now.toISOString(),
    employmentStatus: 'ACTIVE'
  });

  const service = new DigitalIdService(bindingRepository, new InMemoryAccessControlRepository(), {
    signingSecret: 'digital-id-test-secret',
    windowSeconds: 30,
    toleranceWindows: 1,
    now: () => now
  });

  const generated = await service.generateDynamicPayload({
    tenantId: 'tenant_a',
    employeeId: 'E001',
    lineUserId: 'U001'
  });

  const future = new Date('2026-02-18T00:02:00.000Z');
  const verifyService = new DigitalIdService(bindingRepository, new InMemoryAccessControlRepository(), {
    signingSecret: 'digital-id-test-secret',
    windowSeconds: 30,
    toleranceWindows: 1,
    now: () => future
  });

  const verification = await verifyService.verifyDynamicPayload(generated.payload);

  assert.equal(verification.valid, false);
  assert.equal(verification.reasonCode, 'EXPIRED');
});

test('digital payload rotates every 30-second window', async () => {
  const bindingRepository = new InMemoryEmployeeBindingRepository();
  await bindingRepository.upsert({
    tenantId: 'tenant_a',
    employeeId: 'E001',
    lineUserId: 'U001',
    boundAt: new Date('2026-02-18T00:00:05.000Z').toISOString(),
    employmentStatus: 'ACTIVE'
  });

  const firstService = new DigitalIdService(bindingRepository, new InMemoryAccessControlRepository(), {
    signingSecret: 'digital-id-test-secret',
    windowSeconds: 30,
    toleranceWindows: 1,
    now: () => new Date('2026-02-18T00:00:10.000Z')
  });

  const secondService = new DigitalIdService(bindingRepository, new InMemoryAccessControlRepository(), {
    signingSecret: 'digital-id-test-secret',
    windowSeconds: 30,
    toleranceWindows: 1,
    now: () => new Date('2026-02-18T00:00:40.000Z')
  });

  const firstPayload = await firstService.generateDynamicPayload({
    tenantId: 'tenant_a',
    employeeId: 'E001',
    lineUserId: 'U001'
  });

  const secondPayload = await secondService.generateDynamicPayload({
    tenantId: 'tenant_a',
    employeeId: 'E001',
    lineUserId: 'U001'
  });

  assert.notEqual(firstPayload.payload, secondPayload.payload);
});
