import type { MassageSessionRecord, MassageBookingRecord, MassageScheduleRecord } from '../domain/massage-booking.js';

export interface MassageBookingRepository {
  // Sessions
  createSession(session: MassageSessionRecord): Promise<void>;
  findSessionById(tenantId: string, sessionId: string): Promise<MassageSessionRecord | null>;
  updateSession(session: MassageSessionRecord): Promise<void>;
  listActiveSessions(tenantId: string, fromDate?: string): Promise<MassageSessionRecord[]>;
  listSessionsDueForDraw(now: string): Promise<MassageSessionRecord[]>;

  // Bookings
  createBooking(booking: MassageBookingRecord): Promise<void>;
  findBooking(tenantId: string, sessionId: string, employeeId: string): Promise<MassageBookingRecord | null>;
  findBookingById(tenantId: string, bookingId: string): Promise<MassageBookingRecord | null>;
  updateBooking(booking: MassageBookingRecord): Promise<void>;
  listBookingsBySession(tenantId: string, sessionId: string): Promise<MassageBookingRecord[]>;
  listBookingsByEmployee(tenantId: string, employeeId: string): Promise<MassageBookingRecord[]>;
  countConfirmedBookings(tenantId: string, sessionId: string): Promise<number>;
  countConfirmedBySlot(tenantId: string, sessionId: string, slotStartAt: string): Promise<number>;
  listWaitlistedBySlot(tenantId: string, sessionId: string, slotStartAt: string): Promise<MassageBookingRecord[]>;

  // Schedules
  createSchedule(schedule: MassageScheduleRecord): Promise<void>;
  findScheduleById(tenantId: string, scheduleId: string): Promise<MassageScheduleRecord | null>;
  updateSchedule(schedule: MassageScheduleRecord): Promise<void>;
  listSchedules(tenantId: string): Promise<MassageScheduleRecord[]>;
}

export class InMemoryMassageBookingRepository implements MassageBookingRepository {
  private sessions: MassageSessionRecord[] = [];
  private bookings: MassageBookingRecord[] = [];
  private schedules: MassageScheduleRecord[] = [];

  async createSession(session: MassageSessionRecord): Promise<void> {
    this.sessions.push({ ...session });
  }

  async findSessionById(tenantId: string, sessionId: string): Promise<MassageSessionRecord | null> {
    return this.sessions.find(s => s.tenantId === tenantId && s.sessionId === sessionId) ?? null;
  }

  async updateSession(session: MassageSessionRecord): Promise<void> {
    const idx = this.sessions.findIndex(s => s.tenantId === session.tenantId && s.sessionId === session.sessionId);
    if (idx >= 0) this.sessions[idx] = { ...session };
  }

  async listActiveSessions(tenantId: string, fromDate?: string): Promise<MassageSessionRecord[]> {
    return this.sessions.filter(s =>
      s.tenantId === tenantId &&
      s.status === 'ACTIVE' &&
      (!fromDate || s.date >= fromDate)
    );
  }

  async listSessionsDueForDraw(now: string): Promise<MassageSessionRecord[]> {
    return this.sessions.filter(s =>
      s.mode === 'LOTTERY' &&
      s.status === 'ACTIVE' &&
      s.drawAt !== null &&
      s.drawAt <= now &&
      !s.drawnAt
    );
  }

  async createBooking(booking: MassageBookingRecord): Promise<void> {
    const existing = this.bookings.find(
      b => b.tenantId === booking.tenantId && b.sessionId === booking.sessionId && b.employeeId === booking.employeeId
    );
    if (existing) throw new Error('Booking already exists for this session and employee');
    this.bookings.push({ ...booking });
  }

  async findBooking(tenantId: string, sessionId: string, employeeId: string): Promise<MassageBookingRecord | null> {
    return this.bookings.find(
      b => b.tenantId === tenantId && b.sessionId === sessionId && b.employeeId === employeeId
    ) ?? null;
  }

  async findBookingById(tenantId: string, bookingId: string): Promise<MassageBookingRecord | null> {
    return this.bookings.find(b => b.tenantId === tenantId && b.bookingId === bookingId) ?? null;
  }

  async updateBooking(booking: MassageBookingRecord): Promise<void> {
    const idx = this.bookings.findIndex(b => b.tenantId === booking.tenantId && b.bookingId === booking.bookingId);
    if (idx >= 0) this.bookings[idx] = { ...booking };
  }

  async listBookingsBySession(tenantId: string, sessionId: string): Promise<MassageBookingRecord[]> {
    return this.bookings.filter(b => b.tenantId === tenantId && b.sessionId === sessionId);
  }

  async listBookingsByEmployee(tenantId: string, employeeId: string): Promise<MassageBookingRecord[]> {
    return this.bookings.filter(b => b.tenantId === tenantId && b.employeeId === employeeId);
  }

  async countConfirmedBookings(tenantId: string, sessionId: string): Promise<number> {
    return this.bookings.filter(
      b => b.tenantId === tenantId && b.sessionId === sessionId && b.status === 'CONFIRMED'
    ).length;
  }

  async countConfirmedBySlot(tenantId: string, sessionId: string, slotStartAt: string): Promise<number> {
    return this.bookings.filter(
      b => b.tenantId === tenantId && b.sessionId === sessionId
        && b.slotStartAt === slotStartAt && b.status === 'CONFIRMED'
    ).length;
  }

  async listWaitlistedBySlot(tenantId: string, sessionId: string, slotStartAt: string): Promise<MassageBookingRecord[]> {
    return this.bookings
      .filter(b => b.tenantId === tenantId && b.sessionId === sessionId
        && b.slotStartAt === slotStartAt && b.status === 'WAITLISTED')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createSchedule(schedule: MassageScheduleRecord): Promise<void> {
    this.schedules.push({ ...schedule });
  }

  async findScheduleById(tenantId: string, scheduleId: string): Promise<MassageScheduleRecord | null> {
    return this.schedules.find(s => s.tenantId === tenantId && s.scheduleId === scheduleId) ?? null;
  }

  async updateSchedule(schedule: MassageScheduleRecord): Promise<void> {
    const idx = this.schedules.findIndex(s => s.tenantId === schedule.tenantId && s.scheduleId === schedule.scheduleId);
    if (idx >= 0) this.schedules[idx] = { ...schedule };
  }

  async listSchedules(tenantId: string): Promise<MassageScheduleRecord[]> {
    return this.schedules.filter(s => s.tenantId === tenantId);
  }
}
