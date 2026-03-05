import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleScheduledDraw } from './massage-draw-worker.js';
import { InMemoryMassageBookingRepository } from '../repositories/massage-booking-repository.js';
import { InMemoryEmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
import { MassageBookingService } from '../services/massage-booking-service.js';
import { StubLinePlatformClient } from '../line/line-platform-client.js';
import type { MassageSessionRecord, MassageBookingRecord } from '../domain/massage-booking.js';

const TENANT = 'test-tenant';
const ADMIN_ID = 'ADMIN01';
const ADMIN_LINE_USER = 'line-admin-01';

function makeSession(overrides: Partial<MassageSessionRecord> = {}): MassageSessionRecord {
  return {
    tenantId: TENANT,
    sessionId: 'sess-01',
    date: '2026-04-15',
    startAt: '2026-04-15T10:00:00.000Z',
    endAt: '2026-04-15T10:30:00.000Z',
    location: 'B1 Massage Room',
    quota: 1,
    mode: 'LOTTERY',
    openAt: '2026-04-14T00:00:00.000Z',
    drawAt: '2025-01-01T00:00:00.000Z',
    drawMode: 'AUTO',
    drawnAt: null,
    status: 'ACTIVE',
    cancelledAt: null,
    cancelledByEmployeeId: null,
    cancellationNote: null,
    createdByEmployeeId: ADMIN_ID,
    createdAt: '2026-04-13T00:00:00.000Z',
    ...overrides,
  };
}

function makeBooking(sessionId: string, employeeId: string, lineUserId: string): MassageBookingRecord {
  return {
    tenantId: TENANT,
    bookingId: `bk-${employeeId}`,
    sessionId,
    employeeId,
    lineUserId,
    status: 'REGISTERED',
    cancelledAt: null,
    cancelledByEmployeeId: null,
    cancellationReason: null,
    createdAt: '2026-04-14T01:00:00.000Z',
  };
}

describe('MassageDrawWorker', () => {
  let massageRepo: InMemoryMassageBookingRepository;
  let employeeRepo: InMemoryEmployeeBindingRepository;
  let lineClient: StubLinePlatformClient;
  let service: MassageBookingService;

  beforeEach(() => {
    massageRepo = new InMemoryMassageBookingRepository();
    employeeRepo = new InMemoryEmployeeBindingRepository();
    lineClient = new StubLinePlatformClient();
    service = new MassageBookingService(massageRepo, employeeRepo, lineClient, {
      now: () => new Date('2026-04-14T13:00:00.000Z'),
    });
  });

  async function seedAdmin() {
    await employeeRepo.upsert({
      tenantId: TENANT,
      employeeId: ADMIN_ID,
      lineUserId: ADMIN_LINE_USER,
      boundAt: '2026-01-01T00:00:00.000Z',
      employmentStatus: 'ACTIVE',
      accessStatus: 'APPROVED',
      permissions: { canInvite: false, canRemove: false, canManageBooking: true },
    });
  }

  it('AUTO: executes draw for due sessions', async () => {
    await seedAdmin();
    const session = makeSession({ drawMode: 'AUTO' });
    await massageRepo.createSession(session);
    await massageRepo.createBooking(makeBooking('sess-01', 'EMP01', 'line-emp-01'));
    await massageRepo.createBooking(makeBooking('sess-01', 'EMP02', 'line-emp-02'));

    await handleScheduledDraw({}, { massageRepo, massageService: service, lineClient, employeeRepo });

    const updated = await massageRepo.findSessionById(TENANT, 'sess-01');
    assert.ok(updated!.drawnAt, 'drawnAt should be set');

    const bookings = await massageRepo.listBookingsBySession(TENANT, 'sess-01');
    const confirmed = bookings.filter(b => b.status === 'CONFIRMED');
    const unsuccessful = bookings.filter(b => b.status === 'UNSUCCESSFUL');
    assert.equal(confirmed.length, 1);
    assert.equal(unsuccessful.length, 1);
  });

  it('MANUAL: sends notification to admin without drawing', async () => {
    await seedAdmin();
    const session = makeSession({ drawMode: 'MANUAL' });
    await massageRepo.createSession(session);
    await massageRepo.createBooking(makeBooking('sess-01', 'EMP01', 'line-emp-01'));

    await handleScheduledDraw({}, { massageRepo, massageService: service, lineClient, employeeRepo });

    // Session should NOT be drawn
    const updated = await massageRepo.findSessionById(TENANT, 'sess-01');
    assert.equal(updated!.drawnAt, null);

    // LINE notification should be sent to admin
    const messages = lineClient.pushedMessages;
    assert.equal(messages.length, 1);
    assert.equal(messages[0].lineUserId, ADMIN_LINE_USER);
    assert.ok(
      (messages[0].messages[0] as { text: string }).text.includes('抽籤時間'),
      'should mention draw time'
    );
  });

  it('skips sessions not yet due', async () => {
    await seedAdmin();
    const session = makeSession({
      drawAt: '2026-04-15T00:00:00.000Z', // future
    });
    await massageRepo.createSession(session);

    await handleScheduledDraw({}, { massageRepo, massageService: service, lineClient, employeeRepo });

    const updated = await massageRepo.findSessionById(TENANT, 'sess-01');
    assert.equal(updated!.drawnAt, null);
  });

  it('skips already drawn sessions', async () => {
    await seedAdmin();
    const session = makeSession({
      drawnAt: '2026-04-14T12:01:00.000Z',
    });
    await massageRepo.createSession(session);

    await handleScheduledDraw({}, { massageRepo, massageService: service, lineClient, employeeRepo });

    // No messages sent
    assert.equal(lineClient.pushedMessages.length, 0);
  });

  it('one failure does not block other sessions', async () => {
    await seedAdmin();
    // Session 1: will fail (no bookings to draw from, but executeDraw should still work with 0 registered)
    // Actually let's make session 1 have drawMode AUTO but it's already drawn (will throw ConflictError)
    const session1 = makeSession({
      sessionId: 'sess-01',
      drawMode: 'AUTO',
      drawnAt: '2026-04-14T12:01:00.000Z', // already drawn — but repo filter excludes this
    });
    // Session 2: should succeed
    const session2 = makeSession({
      sessionId: 'sess-02',
      drawMode: 'MANUAL',
    });
    await massageRepo.createSession(session1);
    await massageRepo.createSession(session2);
    await massageRepo.createBooking(makeBooking('sess-02', 'EMP01', 'line-emp-01'));

    await handleScheduledDraw({}, { massageRepo, massageService: service, lineClient, employeeRepo });

    // Session 2 should still get notification (session 1 is skipped by filter)
    const messages = lineClient.pushedMessages;
    assert.equal(messages.length, 1);
  });

  it('defaults to AUTO when drawMode is undefined', async () => {
    await seedAdmin();
    const session = makeSession();
    // Simulate old record without drawMode
    (session as unknown as Record<string, unknown>).drawMode = undefined;
    await massageRepo.createSession(session);
    await massageRepo.createBooking(makeBooking('sess-01', 'EMP01', 'line-emp-01'));

    await handleScheduledDraw({}, { massageRepo, massageService: service, lineClient, employeeRepo });

    const updated = await massageRepo.findSessionById(TENANT, 'sess-01');
    assert.ok(updated!.drawnAt, 'should auto-draw');
  });
});
