import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MassageBookingService } from './massage-booking-service.js';
import { InMemoryMassageBookingRepository } from '../repositories/massage-booking-repository.js';
import { InMemoryEmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
import { StubLinePlatformClient } from '../line/line-platform-client.js';
import { ForbiddenError, ValidationError, ConflictError } from '../errors.js';

const TENANT = 'test-tenant';
const DEFAULT_SLOT = '2026-04-15T10:00:00.000Z';

function createContext(nowStr = '2026-04-01T09:00:00.000Z') {
  const massageRepo = new InMemoryMassageBookingRepository();
  const employeeRepo = new InMemoryEmployeeBindingRepository();
  const lineClient = new StubLinePlatformClient();
  const service = new MassageBookingService(massageRepo, employeeRepo, lineClient, {
    now: () => new Date(nowStr),
  });
  return { service, massageRepo, employeeRepo, lineClient };
}

async function seedAdmin(employeeRepo: InMemoryEmployeeBindingRepository) {
  await employeeRepo.upsert({
    tenantId: TENANT,
    employeeId: 'ADMIN01',
    lineUserId: 'line-admin-01',
    boundAt: '2026-01-01T00:00:00.000Z',
    employmentStatus: 'ACTIVE',
    accessStatus: 'APPROVED',
    permissions: { canInvite: false, canRemove: false, canManageBooking: true },
  });
}

async function seedEmployee(employeeRepo: InMemoryEmployeeBindingRepository, id = 'EMP01', lineUserId = 'line-emp-01') {
  await employeeRepo.upsert({
    tenantId: TENANT,
    employeeId: id,
    lineUserId,
    boundAt: '2026-01-01T00:00:00.000Z',
    employmentStatus: 'ACTIVE',
    accessStatus: 'APPROVED',
    permissions: { canInvite: false, canRemove: false, canManageBooking: false },
  });
}

function sessionInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    date: '2026-04-15',
    startAt: '2026-04-15T10:00:00.000Z',
    endAt: '2026-04-15T10:30:00.000Z',
    location: '3F Massage Room',
    quota: 1,
    slotDurationMinutes: 20,
    therapistCount: 1,
    mode: 'FIRST_COME' as const,
    openAt: '2026-04-14T00:00:00.000Z',
    drawAt: null,
    createdByEmployeeId: 'ADMIN01',
    ...overrides,
  };
}

describe('canManageBooking permission', () => {
  it('EmployeePermissions includes canManageBooking', async () => {
    const permissions: import('../domain/invitation-binding.js').EmployeePermissions = {
      canInvite: false,
      canRemove: false,
      canManageBooking: true,
    };
    assert.equal(permissions.canManageBooking, true);
  });
});

describe('MassageBookingService — Session CRUD', () => {
  it('creates a Mode A session', async () => {
    const { service, massageRepo, employeeRepo } = createContext();
    await seedAdmin(employeeRepo);

    const result = await service.createSession(sessionInput());

    assert.ok(result.sessionId);
    const stored = await massageRepo.findSessionById(TENANT, result.sessionId);
    assert.ok(stored);
    assert.equal(stored.mode, 'FIRST_COME');
    assert.equal(stored.status, 'ACTIVE');
    assert.equal(stored.quota, 1);
    assert.equal(stored.slotDurationMinutes, 20);
    assert.equal(stored.therapistCount, 1);
  });

  it('creates a Mode B session with drawAt', async () => {
    const { service, massageRepo, employeeRepo } = createContext();
    await seedAdmin(employeeRepo);

    const result = await service.createSession(sessionInput({
      mode: 'LOTTERY',
      openAt: '2026-04-10T00:00:00.000Z',
      drawAt: '2026-04-14T12:00:00.000Z',
    }));

    const stored = await massageRepo.findSessionById(TENANT, result.sessionId);
    assert.ok(stored);
    assert.equal(stored.mode, 'LOTTERY');
    assert.equal(stored.drawAt, '2026-04-14T12:00:00.000Z');
  });

  it('rejects session creation by non-admin', async () => {
    const { service, employeeRepo } = createContext();
    await seedEmployee(employeeRepo);

    await assert.rejects(
      () => service.createSession(sessionInput({ createdByEmployeeId: 'EMP01' })),
      (err: unknown) => err instanceof ForbiddenError
    );
  });

  it('lists active sessions from a given date', async () => {
    const { service, employeeRepo } = createContext();
    await seedAdmin(employeeRepo);

    await service.createSession(sessionInput({
      date: '2026-04-10',
      startAt: '2026-04-10T10:00:00.000Z',
      endAt: '2026-04-10T10:30:00.000Z',
      location: '3F',
      openAt: '2026-04-09T00:00:00.000Z',
    }));
    await service.createSession(sessionInput({
      date: '2026-04-20',
      startAt: '2026-04-20T10:00:00.000Z',
      endAt: '2026-04-20T10:30:00.000Z',
      location: '3F',
      openAt: '2026-04-19T00:00:00.000Z',
    }));

    const sessions = await service.listSessions(TENANT, { fromDate: '2026-04-15' });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].date, '2026-04-20');
  });

  it('cancels a session', async () => {
    const { service, massageRepo, employeeRepo } = createContext();
    await seedAdmin(employeeRepo);

    const { sessionId } = await service.createSession(sessionInput());

    await service.cancelSession(TENANT, sessionId, 'ADMIN01', 'Room unavailable');
    const stored = await massageRepo.findSessionById(TENANT, sessionId);
    assert.equal(stored!.status, 'CANCELLED');
    assert.equal(stored!.cancellationNote, 'Room unavailable');
  });

  it('defaults slotDurationMinutes to 20 and therapistCount to 1', async () => {
    const { service, massageRepo, employeeRepo } = createContext();
    await seedAdmin(employeeRepo);

    const result = await service.createSession(sessionInput({
      slotDurationMinutes: undefined,
      therapistCount: undefined,
    }));

    const stored = await massageRepo.findSessionById(TENANT, result.sessionId);
    assert.ok(stored);
    assert.equal(stored.slotDurationMinutes, 20);
    assert.equal(stored.therapistCount, 1);
  });
});

describe('MassageBookingService — Mode A Booking', () => {
  it('books a Mode A session when open and has quota', async () => {
    const { service, massageRepo, employeeRepo } = createContext('2026-04-14T12:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession(sessionInput({ quota: 2, therapistCount: 2 }));

    const result = await service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', { slotStartAt: DEFAULT_SLOT });
    assert.ok(result.bookingId);

    const booking = await massageRepo.findBooking(TENANT, sessionId, 'EMP01');
    assert.ok(booking);
    assert.equal(booking.status, 'CONFIRMED');
  });

  it('rejects booking before openAt', async () => {
    const { service, employeeRepo } = createContext('2026-04-13T00:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession(sessionInput({ quota: 2, therapistCount: 2 }));

    await assert.rejects(
      () => service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', { slotStartAt: DEFAULT_SLOT }),
      (err: unknown) => err instanceof ValidationError
    );
  });

  it('waitlists booking when slot is full', async () => {
    const { service, massageRepo, employeeRepo } = createContext('2026-04-14T12:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo, 'EMP01', 'line-emp-01');
    await seedEmployee(employeeRepo, 'EMP02', 'line-emp-02');

    const { sessionId } = await service.createSession(sessionInput());

    await service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', { slotStartAt: DEFAULT_SLOT });
    const result = await service.bookSession(TENANT, sessionId, 'EMP02', 'line-emp-02', { slotStartAt: DEFAULT_SLOT });
    assert.ok(result.bookingId);

    const booking = await massageRepo.findBooking(TENANT, sessionId, 'EMP02');
    assert.equal(booking!.status, 'WAITLISTED');
  });

  it('rejects duplicate booking', async () => {
    const { service, employeeRepo } = createContext('2026-04-14T12:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession(sessionInput({ quota: 5, therapistCount: 5 }));

    await service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', { slotStartAt: DEFAULT_SLOT });
    await assert.rejects(
      () => service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', { slotStartAt: DEFAULT_SLOT }),
      (err: unknown) => err instanceof ConflictError
    );
  });
});

describe('MassageBookingService — Mode B Lottery', () => {
  it('registers for Mode B session (status=REGISTERED)', async () => {
    const { service, massageRepo, employeeRepo } = createContext('2026-04-11T00:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession(sessionInput({
      mode: 'LOTTERY',
      openAt: '2026-04-10T00:00:00.000Z',
      drawAt: '2026-04-14T12:00:00.000Z',
    }));

    await service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', { slotStartAt: DEFAULT_SLOT });
    const booking = await massageRepo.findBooking(TENANT, sessionId, 'EMP01');
    assert.equal(booking!.status, 'REGISTERED');
  });

  it('rejects Mode B registration after drawAt', async () => {
    const { service, employeeRepo } = createContext('2026-04-14T13:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession(sessionInput({
      mode: 'LOTTERY',
      openAt: '2026-04-10T00:00:00.000Z',
      drawAt: '2026-04-14T12:00:00.000Z',
    }));

    await assert.rejects(
      () => service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', { slotStartAt: DEFAULT_SLOT }),
      (err: unknown) => err instanceof ValidationError
    );
  });

  it('executeDraw picks winners and waitlists losers', async () => {
    const { service, massageRepo, employeeRepo } = createContext('2026-04-10T12:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo, 'EMP01', 'line-emp-01');
    await seedEmployee(employeeRepo, 'EMP02', 'line-emp-02');
    await seedEmployee(employeeRepo, 'EMP03', 'line-emp-03');

    const { sessionId } = await service.createSession(sessionInput({
      mode: 'LOTTERY',
      openAt: '2026-04-10T00:00:00.000Z',
      drawAt: '2026-04-14T12:00:00.000Z',
    }));

    await service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', { slotStartAt: DEFAULT_SLOT });
    await service.bookSession(TENANT, sessionId, 'EMP02', 'line-emp-02', { slotStartAt: DEFAULT_SLOT });
    await service.bookSession(TENANT, sessionId, 'EMP03', 'line-emp-03', { slotStartAt: DEFAULT_SLOT });

    await service.executeDraw(TENANT, sessionId);

    const bookings = await massageRepo.listBookingsBySession(TENANT, sessionId);
    const confirmed = bookings.filter(b => b.status === 'CONFIRMED');
    const waitlisted = bookings.filter(b => b.status === 'WAITLISTED');
    assert.equal(confirmed.length, 1);
    assert.equal(waitlisted.length, 2);

    const session = await massageRepo.findSessionById(TENANT, sessionId);
    assert.ok(session!.drawnAt);
  });

  it('executeDraw rejects if already drawn', async () => {
    const { service, employeeRepo } = createContext('2026-04-10T12:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession(sessionInput({
      mode: 'LOTTERY',
      openAt: '2026-04-10T00:00:00.000Z',
      drawAt: '2026-04-14T12:00:00.000Z',
    }));

    await service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', { slotStartAt: DEFAULT_SLOT });
    await service.executeDraw(TENANT, sessionId);
    await assert.rejects(
      () => service.executeDraw(TENANT, sessionId),
      (err: unknown) => err instanceof ConflictError
    );
  });
});

describe('MassageBookingService — Cancellation', () => {
  it('employee cancels booking more than 2h before session', async () => {
    const { service, massageRepo, employeeRepo } = createContext('2026-04-15T07:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession(sessionInput({ quota: 2, therapistCount: 2 }));

    const { bookingId } = await service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', { slotStartAt: DEFAULT_SLOT });
    await service.cancelBooking(TENANT, bookingId, 'EMP01', 'Changed my mind');

    const booking = await massageRepo.findBookingById(TENANT, bookingId);
    assert.equal(booking!.status, 'CANCELLED');
    assert.equal(booking!.cancellationReason, 'Changed my mind');
  });

  it('rejects employee cancel within 2h of session start', async () => {
    const { service, employeeRepo } = createContext('2026-04-15T08:30:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession(sessionInput({ quota: 2, therapistCount: 2 }));

    const { bookingId } = await service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', { slotStartAt: DEFAULT_SLOT });
    await assert.rejects(
      () => service.cancelBooking(TENANT, bookingId, 'EMP01'),
      (err: unknown) => err instanceof ValidationError
    );
  });

  it('admin cancels booking regardless of time', async () => {
    const { service, massageRepo, employeeRepo } = createContext('2026-04-15T09:30:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession(sessionInput({ quota: 2, therapistCount: 2 }));

    const { bookingId } = await service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', { slotStartAt: DEFAULT_SLOT });
    await service.adminCancelBooking(TENANT, bookingId, 'ADMIN01', 'Schedule conflict');

    const booking = await massageRepo.findBookingById(TENANT, bookingId);
    assert.equal(booking!.status, 'CANCELLED');
  });
});

describe('MassageBookingService — LINE Notifications', () => {
  it('sends confirmation notification for Mode A booking', async () => {
    const { service, employeeRepo, lineClient } = createContext('2026-04-14T12:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession(sessionInput({ quota: 2, therapistCount: 2 }));

    await service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', { slotStartAt: DEFAULT_SLOT });
    assert.equal(lineClient.pushedMessages.length, 1);
    assert.equal(lineClient.pushedMessages[0].lineUserId, 'line-emp-01');
    assert.ok(lineClient.pushedMessages[0].messages[0].text!.includes('成功預約'));
  });

  it('sends draw result notifications', async () => {
    const { service, employeeRepo, lineClient } = createContext('2026-04-10T12:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo, 'EMP01', 'line-emp-01');
    await seedEmployee(employeeRepo, 'EMP02', 'line-emp-02');

    const { sessionId } = await service.createSession(sessionInput({
      mode: 'LOTTERY',
      openAt: '2026-04-10T00:00:00.000Z',
      drawAt: '2026-04-14T12:00:00.000Z',
    }));

    await service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', { slotStartAt: DEFAULT_SLOT });
    await service.bookSession(TENANT, sessionId, 'EMP02', 'line-emp-02', { slotStartAt: DEFAULT_SLOT });
    lineClient.pushedMessages.length = 0;

    await service.executeDraw(TENANT, sessionId);
    assert.equal(lineClient.pushedMessages.length, 2);
    const texts = lineClient.pushedMessages.map(m => m.messages[0].text!);
    assert.ok(texts.some(t => t.includes('恭喜')));
    assert.ok(texts.some(t => t.includes('候補')));
  });

  it('sends cancellation notification', async () => {
    const { service, employeeRepo, lineClient } = createContext('2026-04-15T07:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession(sessionInput({ quota: 2, therapistCount: 2 }));

    const { bookingId } = await service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', { slotStartAt: DEFAULT_SLOT });
    lineClient.pushedMessages.length = 0;

    await service.cancelBooking(TENANT, bookingId, 'EMP01');
    assert.equal(lineClient.pushedMessages.length, 1);
    assert.ok(lineClient.pushedMessages[0].messages[0].text!.includes('已取消'));
  });
});

describe('MassageBookingService — My Bookings', () => {
  it('lists bookings for an employee', async () => {
    const { service, employeeRepo } = createContext('2026-04-14T12:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession(sessionInput({ quota: 2, therapistCount: 2 }));

    await service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', { slotStartAt: DEFAULT_SLOT });
    const bookings = await service.listMyBookings(TENANT, 'EMP01');
    assert.equal(bookings.length, 1);
    assert.equal(bookings[0].sessionId, sessionId);
  });
});

// ─── New Slot-based Tests ────────────────────────────────────────────

describe('MassageBookingService — Slot-based Booking', () => {
  it('books a specific time slot in FIRST_COME mode', async () => {
    const { service, massageRepo, employeeRepo } = createContext('2026-04-14T12:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    // Session 12:00-13:00, 20-min slots, 2 therapists → slots: 12:00, 12:20, 12:40
    const { sessionId } = await service.createSession(sessionInput({
      startAt: '2026-04-15T12:00:00.000Z',
      endAt: '2026-04-15T13:00:00.000Z',
      slotDurationMinutes: 20,
      therapistCount: 2,
      quota: 6,
    }));

    const result = await service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', {
      slotStartAt: '2026-04-15T12:00:00.000Z',
    });
    assert.ok(result.bookingId);

    const booking = await massageRepo.findBooking(TENANT, sessionId, 'EMP01');
    assert.ok(booking);
    assert.equal(booking.status, 'CONFIRMED');
    assert.equal(booking.slotStartAt, '2026-04-15T12:00:00.000Z');
  });

  it('rejects booking for invalid slot time', async () => {
    const { service, employeeRepo } = createContext('2026-04-14T12:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    // Slots: 12:00, 12:20, 12:40
    const { sessionId } = await service.createSession(sessionInput({
      startAt: '2026-04-15T12:00:00.000Z',
      endAt: '2026-04-15T13:00:00.000Z',
      slotDurationMinutes: 20,
      therapistCount: 2,
      quota: 6,
    }));

    await assert.rejects(
      () => service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', {
        slotStartAt: '2026-04-15T12:15:00.000Z',
      }),
      (err: unknown) => err instanceof ValidationError
    );
  });

  it('slot full → books as WAITLISTED', async () => {
    const { service, massageRepo, employeeRepo } = createContext('2026-04-14T12:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo, 'EMP01', 'line-emp-01');
    await seedEmployee(employeeRepo, 'EMP02', 'line-emp-02');

    // therapistCount=1, so only 1 person per slot
    const { sessionId } = await service.createSession(sessionInput({
      startAt: '2026-04-15T12:00:00.000Z',
      endAt: '2026-04-15T13:00:00.000Z',
      slotDurationMinutes: 20,
      therapistCount: 1,
      quota: 3,
    }));

    const slot = '2026-04-15T12:00:00.000Z';
    await service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', { slotStartAt: slot });
    await service.bookSession(TENANT, sessionId, 'EMP02', 'line-emp-02', { slotStartAt: slot });

    const first = await massageRepo.findBooking(TENANT, sessionId, 'EMP01');
    const second = await massageRepo.findBooking(TENANT, sessionId, 'EMP02');
    assert.equal(first!.status, 'CONFIRMED');
    assert.equal(second!.status, 'WAITLISTED');
  });
});

describe('MassageBookingService — Slot-based Lottery', () => {
  it('registers for preferred slot in LOTTERY mode', async () => {
    const { service, massageRepo, employeeRepo } = createContext('2026-04-11T00:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession(sessionInput({
      mode: 'LOTTERY',
      openAt: '2026-04-10T00:00:00.000Z',
      drawAt: '2026-04-14T12:00:00.000Z',
      startAt: '2026-04-15T12:00:00.000Z',
      endAt: '2026-04-15T13:00:00.000Z',
      slotDurationMinutes: 20,
      therapistCount: 1,
      quota: 3,
    }));

    const slot = '2026-04-15T12:00:00.000Z';
    await service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', { slotStartAt: slot });

    const booking = await massageRepo.findBooking(TENANT, sessionId, 'EMP01');
    assert.equal(booking!.status, 'REGISTERED');
    assert.equal(booking!.slotStartAt, slot);
  });

  it('executeDraw draws per-slot', async () => {
    const { service, massageRepo, employeeRepo } = createContext('2026-04-10T12:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo, 'EMP01', 'line-emp-01');
    await seedEmployee(employeeRepo, 'EMP02', 'line-emp-02');
    await seedEmployee(employeeRepo, 'EMP03', 'line-emp-03');

    // therapistCount=1, so 1 winner per slot
    const { sessionId } = await service.createSession(sessionInput({
      mode: 'LOTTERY',
      openAt: '2026-04-10T00:00:00.000Z',
      drawAt: '2026-04-14T12:00:00.000Z',
      startAt: '2026-04-15T12:00:00.000Z',
      endAt: '2026-04-15T13:00:00.000Z',
      slotDurationMinutes: 20,
      therapistCount: 1,
      quota: 3,
    }));

    // All 3 register for the same slot
    const slot = '2026-04-15T12:00:00.000Z';
    await service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', { slotStartAt: slot });
    await service.bookSession(TENANT, sessionId, 'EMP02', 'line-emp-02', { slotStartAt: slot });
    await service.bookSession(TENANT, sessionId, 'EMP03', 'line-emp-03', { slotStartAt: slot });

    await service.executeDraw(TENANT, sessionId);

    const bookings = await massageRepo.listBookingsBySession(TENANT, sessionId);
    const confirmed = bookings.filter(b => b.status === 'CONFIRMED');
    const waitlisted = bookings.filter(b => b.status === 'WAITLISTED');
    assert.equal(confirmed.length, 1);
    assert.equal(waitlisted.length, 2);
  });
});

describe('MassageBookingService — Waitlist Auto-Promote', () => {
  it('auto-promotes first waitlisted person when confirmed booking cancelled', async () => {
    const { service, massageRepo, employeeRepo } = createContext('2026-04-15T07:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo, 'EMP01', 'line-emp-01');
    await seedEmployee(employeeRepo, 'EMP02', 'line-emp-02');
    await seedEmployee(employeeRepo, 'EMP03', 'line-emp-03');

    // therapistCount=1
    const { sessionId } = await service.createSession(sessionInput());

    const { bookingId: b1 } = await service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', { slotStartAt: DEFAULT_SLOT });
    await service.bookSession(TENANT, sessionId, 'EMP02', 'line-emp-02', { slotStartAt: DEFAULT_SLOT });
    await service.bookSession(TENANT, sessionId, 'EMP03', 'line-emp-03', { slotStartAt: DEFAULT_SLOT });

    // EMP01 is CONFIRMED, EMP02 & EMP03 are WAITLISTED
    // Cancel EMP01 → EMP02 should auto-promote
    await service.cancelBooking(TENANT, b1, 'EMP01');

    const emp2 = await massageRepo.findBooking(TENANT, sessionId, 'EMP02');
    assert.equal(emp2!.status, 'CONFIRMED');

    const emp3 = await massageRepo.findBooking(TENANT, sessionId, 'EMP03');
    assert.equal(emp3!.status, 'WAITLISTED');
  });

  it('sends LINE notification when auto-promoted', async () => {
    const { service, employeeRepo, lineClient } = createContext('2026-04-15T07:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo, 'EMP01', 'line-emp-01');
    await seedEmployee(employeeRepo, 'EMP02', 'line-emp-02');

    const { sessionId } = await service.createSession(sessionInput());

    const { bookingId: b1 } = await service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', { slotStartAt: DEFAULT_SLOT });
    await service.bookSession(TENANT, sessionId, 'EMP02', 'line-emp-02', { slotStartAt: DEFAULT_SLOT });

    lineClient.pushedMessages.length = 0;

    await service.cancelBooking(TENANT, b1, 'EMP01');

    // Should have cancel notification + auto-promote notification
    const promoteMsg = lineClient.pushedMessages.find(m => m.lineUserId === 'line-emp-02');
    assert.ok(promoteMsg);
    assert.ok(promoteMsg.messages[0].text!.includes('遞補成功'));
  });

  it('no auto-promote when no waitlisted bookings exist', async () => {
    const { service, massageRepo, employeeRepo } = createContext('2026-04-15T07:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession(sessionInput());

    const { bookingId } = await service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', { slotStartAt: DEFAULT_SLOT });
    await service.cancelBooking(TENANT, bookingId, 'EMP01');

    const booking = await massageRepo.findBookingById(TENANT, bookingId);
    assert.equal(booking!.status, 'CANCELLED');
    // No error thrown, just no promotion
  });

  it('admin cancel also triggers auto-promote', async () => {
    const { service, massageRepo, employeeRepo } = createContext('2026-04-15T09:30:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo, 'EMP01', 'line-emp-01');
    await seedEmployee(employeeRepo, 'EMP02', 'line-emp-02');

    const { sessionId } = await service.createSession(sessionInput());

    const { bookingId: b1 } = await service.bookSession(TENANT, sessionId, 'EMP01', 'line-emp-01', { slotStartAt: DEFAULT_SLOT });
    await service.bookSession(TENANT, sessionId, 'EMP02', 'line-emp-02', { slotStartAt: DEFAULT_SLOT });

    await service.adminCancelBooking(TENANT, b1, 'ADMIN01', 'Schedule conflict');

    const emp2 = await massageRepo.findBooking(TENANT, sessionId, 'EMP02');
    assert.equal(emp2!.status, 'CONFIRMED');
  });
});
