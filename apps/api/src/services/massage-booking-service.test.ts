import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MassageBookingService } from './massage-booking-service.js';
import { InMemoryMassageBookingRepository } from '../repositories/massage-booking-repository.js';
import { InMemoryEmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
import { ForbiddenError, ValidationError, ConflictError } from '../errors.js';

function createContext(nowStr = '2026-04-01T09:00:00.000Z') {
  const massageRepo = new InMemoryMassageBookingRepository();
  const employeeRepo = new InMemoryEmployeeBindingRepository();
  const service = new MassageBookingService(massageRepo, employeeRepo, {
    tenantId: 'test-tenant',
    now: () => new Date(nowStr),
  });
  return { service, massageRepo, employeeRepo };
}

async function seedAdmin(employeeRepo: InMemoryEmployeeBindingRepository) {
  await employeeRepo.upsert({
    tenantId: 'test-tenant',
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
    tenantId: 'test-tenant',
    employeeId: id,
    lineUserId,
    boundAt: '2026-01-01T00:00:00.000Z',
    employmentStatus: 'ACTIVE',
    accessStatus: 'APPROVED',
    permissions: { canInvite: false, canRemove: false, canManageBooking: false },
  });
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

    const result = await service.createSession({
      date: '2026-04-15',
      startAt: '2026-04-15T10:00:00.000Z',
      endAt: '2026-04-15T10:30:00.000Z',
      location: '3F Massage Room',
      quota: 1,
      mode: 'FIRST_COME',
      openAt: '2026-04-14T00:00:00.000Z',
      drawAt: null,
      createdByEmployeeId: 'ADMIN01',
    });

    assert.ok(result.sessionId);
    const stored = await massageRepo.findSessionById('test-tenant', result.sessionId);
    assert.ok(stored);
    assert.equal(stored.mode, 'FIRST_COME');
    assert.equal(stored.status, 'ACTIVE');
    assert.equal(stored.quota, 1);
  });

  it('creates a Mode B session with drawAt', async () => {
    const { service, massageRepo, employeeRepo } = createContext();
    await seedAdmin(employeeRepo);

    const result = await service.createSession({
      date: '2026-04-15',
      startAt: '2026-04-15T10:00:00.000Z',
      endAt: '2026-04-15T10:30:00.000Z',
      location: '3F Massage Room',
      quota: 1,
      mode: 'LOTTERY',
      openAt: '2026-04-10T00:00:00.000Z',
      drawAt: '2026-04-14T12:00:00.000Z',
      createdByEmployeeId: 'ADMIN01',
    });

    const stored = await massageRepo.findSessionById('test-tenant', result.sessionId);
    assert.ok(stored);
    assert.equal(stored.mode, 'LOTTERY');
    assert.equal(stored.drawAt, '2026-04-14T12:00:00.000Z');
  });

  it('rejects session creation by non-admin', async () => {
    const { service, employeeRepo } = createContext();
    await seedEmployee(employeeRepo);

    await assert.rejects(
      () => service.createSession({
        date: '2026-04-15',
        startAt: '2026-04-15T10:00:00.000Z',
        endAt: '2026-04-15T10:30:00.000Z',
        location: '3F',
        quota: 1,
        mode: 'FIRST_COME',
        openAt: '2026-04-14T00:00:00.000Z',
        drawAt: null,
        createdByEmployeeId: 'EMP01',
      }),
      (err: unknown) => err instanceof ForbiddenError
    );
  });

  it('lists active sessions from a given date', async () => {
    const { service, employeeRepo } = createContext();
    await seedAdmin(employeeRepo);

    await service.createSession({
      date: '2026-04-10',
      startAt: '2026-04-10T10:00:00.000Z',
      endAt: '2026-04-10T10:30:00.000Z',
      location: '3F',
      quota: 1,
      mode: 'FIRST_COME',
      openAt: '2026-04-09T00:00:00.000Z',
      drawAt: null,
      createdByEmployeeId: 'ADMIN01',
    });
    await service.createSession({
      date: '2026-04-20',
      startAt: '2026-04-20T10:00:00.000Z',
      endAt: '2026-04-20T10:30:00.000Z',
      location: '3F',
      quota: 1,
      mode: 'FIRST_COME',
      openAt: '2026-04-19T00:00:00.000Z',
      drawAt: null,
      createdByEmployeeId: 'ADMIN01',
    });

    const sessions = await service.listSessions({ fromDate: '2026-04-15' });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].date, '2026-04-20');
  });

  it('cancels a session', async () => {
    const { service, massageRepo, employeeRepo } = createContext();
    await seedAdmin(employeeRepo);

    const { sessionId } = await service.createSession({
      date: '2026-04-15',
      startAt: '2026-04-15T10:00:00.000Z',
      endAt: '2026-04-15T10:30:00.000Z',
      location: '3F',
      quota: 1,
      mode: 'FIRST_COME',
      openAt: '2026-04-14T00:00:00.000Z',
      drawAt: null,
      createdByEmployeeId: 'ADMIN01',
    });

    await service.cancelSession(sessionId, 'ADMIN01', 'Room unavailable');
    const stored = await massageRepo.findSessionById('test-tenant', sessionId);
    assert.equal(stored!.status, 'CANCELLED');
    assert.equal(stored!.cancellationNote, 'Room unavailable');
  });
});

describe('MassageBookingService — Mode A Booking', () => {
  it('books a Mode A session when open and has quota', async () => {
    const { service, massageRepo, employeeRepo } = createContext('2026-04-14T12:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession({
      date: '2026-04-15',
      startAt: '2026-04-15T10:00:00.000Z',
      endAt: '2026-04-15T10:30:00.000Z',
      location: '3F',
      quota: 2,
      mode: 'FIRST_COME',
      openAt: '2026-04-14T00:00:00.000Z',
      drawAt: null,
      createdByEmployeeId: 'ADMIN01',
    });

    const result = await service.bookSession(sessionId, 'EMP01', 'line-emp-01');
    assert.ok(result.bookingId);

    const booking = await massageRepo.findBooking('test-tenant', sessionId, 'EMP01');
    assert.ok(booking);
    assert.equal(booking.status, 'CONFIRMED');
  });

  it('rejects booking before openAt', async () => {
    const { service, employeeRepo } = createContext('2026-04-13T00:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession({
      date: '2026-04-15',
      startAt: '2026-04-15T10:00:00.000Z',
      endAt: '2026-04-15T10:30:00.000Z',
      location: '3F',
      quota: 2,
      mode: 'FIRST_COME',
      openAt: '2026-04-14T00:00:00.000Z',
      drawAt: null,
      createdByEmployeeId: 'ADMIN01',
    });

    await assert.rejects(
      () => service.bookSession(sessionId, 'EMP01', 'line-emp-01'),
      (err: unknown) => err instanceof ValidationError
    );
  });

  it('rejects booking when quota is full', async () => {
    const { service, employeeRepo } = createContext('2026-04-14T12:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo, 'EMP01', 'line-emp-01');
    await seedEmployee(employeeRepo, 'EMP02', 'line-emp-02');

    const { sessionId } = await service.createSession({
      date: '2026-04-15',
      startAt: '2026-04-15T10:00:00.000Z',
      endAt: '2026-04-15T10:30:00.000Z',
      location: '3F',
      quota: 1,
      mode: 'FIRST_COME',
      openAt: '2026-04-14T00:00:00.000Z',
      drawAt: null,
      createdByEmployeeId: 'ADMIN01',
    });

    await service.bookSession(sessionId, 'EMP01', 'line-emp-01');
    await assert.rejects(
      () => service.bookSession(sessionId, 'EMP02', 'line-emp-02'),
      (err: unknown) => err instanceof ConflictError
    );
  });

  it('rejects duplicate booking', async () => {
    const { service, employeeRepo } = createContext('2026-04-14T12:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession({
      date: '2026-04-15',
      startAt: '2026-04-15T10:00:00.000Z',
      endAt: '2026-04-15T10:30:00.000Z',
      location: '3F',
      quota: 5,
      mode: 'FIRST_COME',
      openAt: '2026-04-14T00:00:00.000Z',
      drawAt: null,
      createdByEmployeeId: 'ADMIN01',
    });

    await service.bookSession(sessionId, 'EMP01', 'line-emp-01');
    await assert.rejects(
      () => service.bookSession(sessionId, 'EMP01', 'line-emp-01'),
      (err: unknown) => err instanceof ConflictError
    );
  });
});

describe('MassageBookingService — Mode B Lottery', () => {
  it('registers for Mode B session (status=REGISTERED)', async () => {
    const { service, massageRepo, employeeRepo } = createContext('2026-04-11T00:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession({
      date: '2026-04-15',
      startAt: '2026-04-15T10:00:00.000Z',
      endAt: '2026-04-15T10:30:00.000Z',
      location: '3F',
      quota: 1,
      mode: 'LOTTERY',
      openAt: '2026-04-10T00:00:00.000Z',
      drawAt: '2026-04-14T12:00:00.000Z',
      createdByEmployeeId: 'ADMIN01',
    });

    const result = await service.bookSession(sessionId, 'EMP01', 'line-emp-01');
    const booking = await massageRepo.findBooking('test-tenant', sessionId, 'EMP01');
    assert.equal(booking!.status, 'REGISTERED');
  });

  it('rejects Mode B registration after drawAt', async () => {
    const { service, employeeRepo } = createContext('2026-04-14T13:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession({
      date: '2026-04-15',
      startAt: '2026-04-15T10:00:00.000Z',
      endAt: '2026-04-15T10:30:00.000Z',
      location: '3F',
      quota: 1,
      mode: 'LOTTERY',
      openAt: '2026-04-10T00:00:00.000Z',
      drawAt: '2026-04-14T12:00:00.000Z',
      createdByEmployeeId: 'ADMIN01',
    });

    await assert.rejects(
      () => service.bookSession(sessionId, 'EMP01', 'line-emp-01'),
      (err: unknown) => err instanceof ValidationError
    );
  });

  it('executeDraw picks winners and losers', async () => {
    const { service, massageRepo, employeeRepo } = createContext('2026-04-10T12:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo, 'EMP01', 'line-emp-01');
    await seedEmployee(employeeRepo, 'EMP02', 'line-emp-02');
    await seedEmployee(employeeRepo, 'EMP03', 'line-emp-03');

    const { sessionId } = await service.createSession({
      date: '2026-04-15',
      startAt: '2026-04-15T10:00:00.000Z',
      endAt: '2026-04-15T10:30:00.000Z',
      location: '3F',
      quota: 1,
      mode: 'LOTTERY',
      openAt: '2026-04-10T00:00:00.000Z',
      drawAt: '2026-04-14T12:00:00.000Z',
      createdByEmployeeId: 'ADMIN01',
    });

    await service.bookSession(sessionId, 'EMP01', 'line-emp-01');
    await service.bookSession(sessionId, 'EMP02', 'line-emp-02');
    await service.bookSession(sessionId, 'EMP03', 'line-emp-03');

    await service.executeDraw(sessionId);

    const bookings = await massageRepo.listBookingsBySession('test-tenant', sessionId);
    const confirmed = bookings.filter(b => b.status === 'CONFIRMED');
    const unsuccessful = bookings.filter(b => b.status === 'UNSUCCESSFUL');
    assert.equal(confirmed.length, 1);
    assert.equal(unsuccessful.length, 2);

    const session = await massageRepo.findSessionById('test-tenant', sessionId);
    assert.ok(session!.drawnAt);
  });

  it('executeDraw rejects if already drawn', async () => {
    const { service, employeeRepo } = createContext('2026-04-10T12:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession({
      date: '2026-04-15',
      startAt: '2026-04-15T10:00:00.000Z',
      endAt: '2026-04-15T10:30:00.000Z',
      location: '3F',
      quota: 1,
      mode: 'LOTTERY',
      openAt: '2026-04-10T00:00:00.000Z',
      drawAt: '2026-04-14T12:00:00.000Z',
      createdByEmployeeId: 'ADMIN01',
    });

    await service.bookSession(sessionId, 'EMP01', 'line-emp-01');
    await service.executeDraw(sessionId);
    await assert.rejects(
      () => service.executeDraw(sessionId),
      (err: unknown) => err instanceof ConflictError
    );
  });
});

describe('MassageBookingService — Cancellation', () => {
  it('employee cancels booking more than 2h before session', async () => {
    const { service, massageRepo, employeeRepo } = createContext('2026-04-15T07:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession({
      date: '2026-04-15',
      startAt: '2026-04-15T10:00:00.000Z',
      endAt: '2026-04-15T10:30:00.000Z',
      location: '3F',
      quota: 2,
      mode: 'FIRST_COME',
      openAt: '2026-04-14T00:00:00.000Z',
      drawAt: null,
      createdByEmployeeId: 'ADMIN01',
    });

    const { bookingId } = await service.bookSession(sessionId, 'EMP01', 'line-emp-01');
    await service.cancelBooking(bookingId, 'EMP01', 'Changed my mind');

    const booking = await massageRepo.findBookingById('test-tenant', bookingId);
    assert.equal(booking!.status, 'CANCELLED');
    assert.equal(booking!.cancellationReason, 'Changed my mind');
  });

  it('rejects employee cancel within 2h of session start', async () => {
    const { service, employeeRepo } = createContext('2026-04-15T08:30:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession({
      date: '2026-04-15',
      startAt: '2026-04-15T10:00:00.000Z',
      endAt: '2026-04-15T10:30:00.000Z',
      location: '3F',
      quota: 2,
      mode: 'FIRST_COME',
      openAt: '2026-04-14T00:00:00.000Z',
      drawAt: null,
      createdByEmployeeId: 'ADMIN01',
    });

    const { bookingId } = await service.bookSession(sessionId, 'EMP01', 'line-emp-01');
    await assert.rejects(
      () => service.cancelBooking(bookingId, 'EMP01'),
      (err: unknown) => err instanceof ValidationError
    );
  });

  it('admin cancels booking regardless of time', async () => {
    const { service, massageRepo, employeeRepo } = createContext('2026-04-15T09:30:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession({
      date: '2026-04-15',
      startAt: '2026-04-15T10:00:00.000Z',
      endAt: '2026-04-15T10:30:00.000Z',
      location: '3F',
      quota: 2,
      mode: 'FIRST_COME',
      openAt: '2026-04-14T00:00:00.000Z',
      drawAt: null,
      createdByEmployeeId: 'ADMIN01',
    });

    const { bookingId } = await service.bookSession(sessionId, 'EMP01', 'line-emp-01');
    await service.adminCancelBooking(bookingId, 'ADMIN01', 'Schedule conflict');

    const booking = await massageRepo.findBookingById('test-tenant', bookingId);
    assert.equal(booking!.status, 'CANCELLED');
  });
});

describe('MassageBookingService — My Bookings', () => {
  it('lists bookings for an employee', async () => {
    const { service, employeeRepo } = createContext('2026-04-14T12:00:00.000Z');
    await seedAdmin(employeeRepo);
    await seedEmployee(employeeRepo);

    const { sessionId } = await service.createSession({
      date: '2026-04-15',
      startAt: '2026-04-15T10:00:00.000Z',
      endAt: '2026-04-15T10:30:00.000Z',
      location: '3F',
      quota: 2,
      mode: 'FIRST_COME',
      openAt: '2026-04-14T00:00:00.000Z',
      drawAt: null,
      createdByEmployeeId: 'ADMIN01',
    });

    await service.bookSession(sessionId, 'EMP01', 'line-emp-01');
    const bookings = await service.listMyBookings('EMP01');
    assert.equal(bookings.length, 1);
    assert.equal(bookings[0].sessionId, sessionId);
  });
});
