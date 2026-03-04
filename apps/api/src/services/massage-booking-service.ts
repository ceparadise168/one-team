import { randomUUID } from 'node:crypto';
import type { MassageSessionRecord, MassageSessionMode, MassageBookingRecord } from '../domain/massage-booking.js';
import type { MassageBookingRepository } from '../repositories/massage-booking-repository.js';
import type { EmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
import { ForbiddenError, NotFoundError, ValidationError, ConflictError } from '../errors.js';

interface MassageBookingServiceOptions {
  tenantId: string;
  now: () => Date;
}

interface CreateSessionInput {
  date: string;
  startAt: string;
  endAt: string;
  location: string;
  quota: number;
  mode: MassageSessionMode;
  openAt: string;
  drawAt: string | null;
  createdByEmployeeId: string;
}

export class MassageBookingService {
  constructor(
    private readonly massageRepo: MassageBookingRepository,
    private readonly employeeRepo: EmployeeBindingRepository,
    private readonly options: MassageBookingServiceOptions
  ) {}

  async createSession(input: CreateSessionInput): Promise<{ sessionId: string }> {
    await this.requireManageBookingPermission(input.createdByEmployeeId);

    if (input.mode === 'LOTTERY' && !input.drawAt) {
      throw new ValidationError('drawAt is required for LOTTERY mode');
    }

    const sessionId = randomUUID().slice(0, 8);
    const session: MassageSessionRecord = {
      tenantId: this.options.tenantId,
      sessionId,
      date: input.date,
      startAt: input.startAt,
      endAt: input.endAt,
      location: input.location,
      quota: input.quota,
      mode: input.mode,
      openAt: input.openAt,
      drawAt: input.drawAt,
      drawnAt: null,
      status: 'ACTIVE',
      cancelledAt: null,
      cancelledByEmployeeId: null,
      cancellationNote: null,
      createdByEmployeeId: input.createdByEmployeeId,
      createdAt: this.options.now().toISOString(),
    };

    await this.massageRepo.createSession(session);
    return { sessionId };
  }

  async listSessions(input: { fromDate?: string } = {}): Promise<MassageSessionRecord[]> {
    return this.massageRepo.listActiveSessions(this.options.tenantId, input.fromDate);
  }

  async getSession(sessionId: string): Promise<MassageSessionRecord> {
    const session = await this.massageRepo.findSessionById(this.options.tenantId, sessionId);
    if (!session) throw new NotFoundError('Session not found');
    return session;
  }

  async cancelSession(sessionId: string, cancelledBy: string, note?: string): Promise<void> {
    await this.requireManageBookingPermission(cancelledBy);
    const session = await this.getSession(sessionId);
    if (session.status !== 'ACTIVE') throw new ValidationError('Session is not active');

    session.status = 'CANCELLED';
    session.cancelledAt = this.options.now().toISOString();
    session.cancelledByEmployeeId = cancelledBy;
    session.cancellationNote = note ?? null;
    await this.massageRepo.updateSession(session);
  }

  async bookSession(sessionId: string, employeeId: string, lineUserId: string): Promise<{ bookingId: string }> {
    const session = await this.getSession(sessionId);
    if (session.status !== 'ACTIVE') throw new ValidationError('Session is not active');

    const now = this.options.now();
    if (now < new Date(session.openAt)) throw new ValidationError('Booking is not open yet');

    // Mode B: reject after drawAt
    if (session.mode === 'LOTTERY') {
      if (session.drawAt && now >= new Date(session.drawAt)) {
        throw new ValidationError('Registration period has ended');
      }
    }

    // Check duplicate
    const existing = await this.massageRepo.findBooking(this.options.tenantId, sessionId, employeeId);
    if (existing && existing.status !== 'CANCELLED') throw new ConflictError('Already booked this session');

    if (session.mode === 'FIRST_COME') {
      const confirmedCount = await this.massageRepo.countConfirmedBookings(this.options.tenantId, sessionId);
      if (confirmedCount >= session.quota) throw new ConflictError('Session is full');
    }

    const bookingId = randomUUID().slice(0, 8);
    const status = session.mode === 'FIRST_COME' ? 'CONFIRMED' : 'REGISTERED';

    await this.massageRepo.createBooking({
      tenantId: this.options.tenantId,
      bookingId,
      sessionId,
      employeeId,
      lineUserId,
      status,
      cancelledAt: null,
      cancelledByEmployeeId: null,
      cancellationReason: null,
      createdAt: now.toISOString(),
    });

    return { bookingId };
  }

  async executeDraw(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (session.mode !== 'LOTTERY') throw new ValidationError('Session is not LOTTERY mode');
    if (session.drawnAt) throw new ConflictError('Draw already executed');

    const bookings = await this.massageRepo.listBookingsBySession(this.options.tenantId, sessionId);
    const registered = bookings.filter(b => b.status === 'REGISTERED');

    // Fisher-Yates shuffle
    for (let i = registered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [registered[i], registered[j]] = [registered[j], registered[i]];
    }

    const winners = registered.slice(0, session.quota);
    const losers = registered.slice(session.quota);

    for (const booking of winners) {
      booking.status = 'CONFIRMED';
      await this.massageRepo.updateBooking(booking);
    }
    for (const booking of losers) {
      booking.status = 'UNSUCCESSFUL';
      await this.massageRepo.updateBooking(booking);
    }

    session.drawnAt = this.options.now().toISOString();
    await this.massageRepo.updateSession(session);
  }

  async cancelBooking(bookingId: string, employeeId: string, reason?: string): Promise<void> {
    const booking = await this.massageRepo.findBookingById(this.options.tenantId, bookingId);
    if (!booking) throw new NotFoundError('Booking not found');
    if (booking.employeeId !== employeeId) throw new ForbiddenError('Not your booking');
    if (booking.status === 'CANCELLED') throw new ValidationError('Booking already cancelled');

    const session = await this.getSession(booking.sessionId);
    const now = this.options.now();
    const twoHoursBefore = new Date(new Date(session.startAt).getTime() - 2 * 60 * 60 * 1000);
    if (now >= twoHoursBefore) throw new ValidationError('Cannot cancel within 2 hours of session start');

    booking.status = 'CANCELLED';
    booking.cancelledAt = now.toISOString();
    booking.cancelledByEmployeeId = employeeId;
    booking.cancellationReason = reason ?? null;
    await this.massageRepo.updateBooking(booking);
  }

  async adminCancelBooking(bookingId: string, adminEmployeeId: string, reason?: string): Promise<void> {
    await this.requireManageBookingPermission(adminEmployeeId);
    const booking = await this.massageRepo.findBookingById(this.options.tenantId, bookingId);
    if (!booking) throw new NotFoundError('Booking not found');
    if (booking.status === 'CANCELLED') throw new ValidationError('Booking already cancelled');

    booking.status = 'CANCELLED';
    booking.cancelledAt = this.options.now().toISOString();
    booking.cancelledByEmployeeId = adminEmployeeId;
    booking.cancellationReason = reason ?? null;
    await this.massageRepo.updateBooking(booking);
  }

  async listMyBookings(employeeId: string): Promise<MassageBookingRecord[]> {
    return this.massageRepo.listBookingsByEmployee(this.options.tenantId, employeeId);
  }

  async listSessionBookings(sessionId: string, requestedBy: string): Promise<MassageBookingRecord[]> {
    await this.requireManageBookingPermission(requestedBy);
    return this.massageRepo.listBookingsBySession(this.options.tenantId, sessionId);
  }

  private async requireManageBookingPermission(employeeId: string): Promise<void> {
    const bindings = await this.employeeRepo.listByTenant(this.options.tenantId);
    const binding = bindings.find(
      b => b.employeeId === employeeId && b.employmentStatus === 'ACTIVE'
    );
    if (!binding) throw new ForbiddenError('Employee not found');
    if (!binding.permissions?.canManageBooking) {
      throw new ForbiddenError('canManageBooking permission required');
    }
  }
}
