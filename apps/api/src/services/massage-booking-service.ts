import { randomUUID } from 'node:crypto';
import type { MassageSessionRecord, MassageSessionMode, MassageDrawMode, MassageBookingRecord, MassageScheduleRecord, MassageScheduleStatus } from '../domain/massage-booking.js';
import { generateSlots } from '../domain/massage-booking.js';
import type { MassageBookingRepository } from '../repositories/massage-booking-repository.js';
import type { EmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
import type { LinePlatformClient } from '../line/line-platform-client.js';
import { ForbiddenError, NotFoundError, ValidationError, ConflictError } from '../errors.js';

interface MassageBookingServiceOptions {
  now: () => Date;
}

interface CreateSessionInput {
  tenantId: string;
  date: string;
  startAt: string;
  endAt: string;
  location: string;
  quota: number;
  slotDurationMinutes?: number;
  therapistCount?: number;
  mode: MassageSessionMode;
  openAt: string;
  drawAt: string | null;
  drawMode?: MassageDrawMode;
  createdByEmployeeId: string;
}

interface CreateScheduleInput {
  tenantId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  location: string;
  slotDurationMinutes?: number;
  therapistCount?: number;
  mode: MassageSessionMode;
  drawMode?: MassageDrawMode;
  drawLeadMinutes?: number;
  openLeadDays?: number;
  timezone?: string;
  createdByEmployeeId: string;
}

function localTimeToISO(date: string, time: string): string {
  // For Asia/Taipei (+08:00), convert "2026-03-12" + "12:00" → "2026-03-12T04:00:00.000Z"
  return new Date(`${date}T${time}:00+08:00`).toISOString();
}

export class MassageBookingService {
  constructor(
    private readonly massageRepo: MassageBookingRepository,
    private readonly employeeRepo: EmployeeBindingRepository,
    private readonly lineClient: LinePlatformClient,
    private readonly options: MassageBookingServiceOptions
  ) {}

  async createSession(input: CreateSessionInput): Promise<{ sessionId: string }> {
    await this.requireManageBookingPermission(input.tenantId, input.createdByEmployeeId);
    return this.createSessionRecord(input);
  }

  private async createSessionRecord(input: CreateSessionInput): Promise<{ sessionId: string }> {
    if (input.mode === 'LOTTERY' && !input.drawAt) {
      throw new ValidationError('drawAt is required for LOTTERY mode');
    }

    const sessionId = randomUUID().slice(0, 8);
    const session: MassageSessionRecord = {
      tenantId: input.tenantId,
      sessionId,
      date: input.date,
      startAt: input.startAt,
      endAt: input.endAt,
      location: input.location,
      quota: input.quota,
      slotDurationMinutes: input.slotDurationMinutes ?? 20,
      therapistCount: input.therapistCount ?? 1,
      mode: input.mode,
      openAt: input.openAt,
      drawAt: input.drawAt,
      drawMode: input.drawMode ?? 'AUTO',
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

  async listSessions(tenantId: string, input: { fromDate?: string } = {}): Promise<MassageSessionRecord[]> {
    return this.massageRepo.listActiveSessions(tenantId, input.fromDate);
  }

  async getSession(tenantId: string, sessionId: string): Promise<MassageSessionRecord> {
    const session = await this.massageRepo.findSessionById(tenantId, sessionId);
    if (!session) throw new NotFoundError('Session not found');
    return session;
  }

  async cancelSession(tenantId: string, sessionId: string, cancelledBy: string, note?: string): Promise<void> {
    await this.requireManageBookingPermission(tenantId, cancelledBy);
    const session = await this.getSession(tenantId, sessionId);
    if (session.status !== 'ACTIVE') throw new ValidationError('Session is not active');

    session.status = 'CANCELLED';
    session.cancelledAt = this.options.now().toISOString();
    session.cancelledByEmployeeId = cancelledBy;
    session.cancellationNote = note ?? null;
    await this.massageRepo.updateSession(session);
  }

  async bookSession(
    tenantId: string, sessionId: string, employeeId: string, lineUserId: string,
    options?: { slotStartAt?: string }
  ): Promise<{ bookingId: string }> {
    const session = await this.getSession(tenantId, sessionId);
    if (session.status !== 'ACTIVE') throw new ValidationError('Session is not active');

    const now = this.options.now();
    if (now < new Date(session.openAt)) throw new ValidationError('Booking is not open yet');

    // Mode B: reject after drawAt
    if (session.mode === 'LOTTERY') {
      if (session.drawAt && now >= new Date(session.drawAt)) {
        throw new ValidationError('Registration period has ended');
      }
    }

    // Validate slotStartAt
    const slotStartAt = options?.slotStartAt;
    if (!slotStartAt) {
      throw new ValidationError('slotStartAt is required');
    }
    const validSlots = generateSlots(session);
    if (!validSlots.includes(slotStartAt)) {
      throw new ValidationError('Invalid slot time');
    }

    // Check duplicate
    const existing = await this.massageRepo.findBooking(tenantId, sessionId, employeeId);
    if (existing && existing.status !== 'CANCELLED') throw new ConflictError('Already booked this session');

    let status: 'CONFIRMED' | 'REGISTERED' | 'WAITLISTED';
    if (session.mode === 'FIRST_COME') {
      const confirmedCount = await this.massageRepo.countConfirmedBySlot(tenantId, sessionId, slotStartAt);
      if (confirmedCount >= session.therapistCount) {
        status = 'WAITLISTED';
      } else {
        status = 'CONFIRMED';
      }
    } else {
      status = 'REGISTERED';
    }

    const bookingId = randomUUID().slice(0, 8);

    const booking: MassageBookingRecord = {
      tenantId,
      bookingId,
      sessionId,
      slotStartAt,
      employeeId,
      lineUserId,
      status,
      cancelledAt: null,
      cancelledByEmployeeId: null,
      cancellationReason: null,
      createdAt: now.toISOString(),
    };
    await this.massageRepo.createBooking(booking);

    if (status === 'CONFIRMED') {
      await this.notify(tenantId, lineUserId, this.formatConfirmedMessage(session, slotStartAt));
    } else if (status === 'WAITLISTED') {
      const range = this.formatSlotTimeRange(slotStartAt, session.slotDurationMinutes);
      await this.notify(tenantId, lineUserId, `📝 你已加入 ${session.date} ${range} 按摩的候補名單，如有名額將自動通知你`);
    } else {
      await this.notify(tenantId, lineUserId, this.formatRegisteredMessage(session, slotStartAt));
    }

    return { bookingId };
  }

  async executeDraw(tenantId: string, sessionId: string): Promise<void> {
    const session = await this.getSession(tenantId, sessionId);
    if (session.mode !== 'LOTTERY') throw new ValidationError('Session is not LOTTERY mode');
    if (session.drawnAt) throw new ConflictError('Draw already executed');

    const bookings = await this.massageRepo.listBookingsBySession(tenantId, sessionId);
    const registered = bookings.filter(b => b.status === 'REGISTERED');

    // Group by slot
    const bySlot = new Map<string, MassageBookingRecord[]>();
    for (const b of registered) {
      const slot = b.slotStartAt;
      if (!bySlot.has(slot)) bySlot.set(slot, []);
      bySlot.get(slot)!.push(b);
    }

    const allWinners: MassageBookingRecord[] = [];
    const allLosers: MassageBookingRecord[] = [];

    for (const [, slotBookings] of bySlot) {
      // Fisher-Yates shuffle
      for (let i = slotBookings.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [slotBookings[i], slotBookings[j]] = [slotBookings[j], slotBookings[i]];
      }

      const winners = slotBookings.slice(0, session.therapistCount);
      const losers = slotBookings.slice(session.therapistCount);

      for (const booking of winners) {
        booking.status = 'CONFIRMED';
        await this.massageRepo.updateBooking(booking);
        allWinners.push(booking);
      }
      for (const booking of losers) {
        booking.status = 'WAITLISTED';
        await this.massageRepo.updateBooking(booking);
        allLosers.push(booking);
      }
    }

    session.drawnAt = this.options.now().toISOString();
    await this.massageRepo.updateSession(session);

    await Promise.all([
      ...allWinners.map((booking) => {
        const range = this.formatSlotTimeRange(booking.slotStartAt, session.slotDurationMinutes);
        const msg = `🎉 恭喜！你已中籤 ${session.date} ${range} 的按摩（${session.location}）\n⚠️ 若需取消請提早操作，以便候補者遞補。`;
        return this.notify(tenantId, booking.lineUserId, msg);
      }),
      ...allLosers.map((booking) => {
        const range = this.formatSlotTimeRange(booking.slotStartAt, session.slotDurationMinutes);
        const msg = `📋 ${session.date} ${range} 的按摩未中籤，已加入候補名單，如有名額將自動通知你`;
        return this.notify(tenantId, booking.lineUserId, msg);
      }),
    ]);
  }

  async cancelBooking(tenantId: string, bookingId: string, employeeId: string, reason?: string): Promise<void> {
    const booking = await this.massageRepo.findBookingById(tenantId, bookingId);
    if (!booking) throw new NotFoundError('Booking not found');
    if (booking.employeeId !== employeeId) throw new ForbiddenError('Not your booking');
    if (booking.status === 'CANCELLED') throw new ValidationError('Booking already cancelled');

    const session = await this.getSession(tenantId, booking.sessionId);
    const now = this.options.now();
    const twoHoursBefore = new Date(new Date(session.startAt).getTime() - 2 * 60 * 60 * 1000);
    if (now >= twoHoursBefore) throw new ValidationError('Cannot cancel within 2 hours of session start');

    const wasConfirmed = booking.status === 'CONFIRMED';

    booking.status = 'CANCELLED';
    booking.cancelledAt = now.toISOString();
    booking.cancelledByEmployeeId = employeeId;
    booking.cancellationReason = reason ?? null;
    await this.massageRepo.updateBooking(booking);

    await this.notify(tenantId, booking.lineUserId, `❌ 你的 ${session.date} 按摩預約已取消`);

    if (wasConfirmed) {
      await this.tryPromoteWaitlisted(tenantId, booking.sessionId, booking.slotStartAt);
    }
  }

  async adminCancelBooking(tenantId: string, bookingId: string, adminEmployeeId: string, reason?: string): Promise<void> {
    await this.requireManageBookingPermission(tenantId, adminEmployeeId);
    const booking = await this.massageRepo.findBookingById(tenantId, bookingId);
    if (!booking) throw new NotFoundError('Booking not found');
    if (booking.status === 'CANCELLED') throw new ValidationError('Booking already cancelled');

    const wasConfirmed = booking.status === 'CONFIRMED';

    booking.status = 'CANCELLED';
    booking.cancelledAt = this.options.now().toISOString();
    booking.cancelledByEmployeeId = adminEmployeeId;
    booking.cancellationReason = reason ?? null;
    await this.massageRepo.updateBooking(booking);

    const session = await this.getSession(tenantId, booking.sessionId);
    await this.notify(tenantId, booking.lineUserId, `❌ 你的 ${session.date} 按摩預約已被管理員取消`);

    if (wasConfirmed) {
      await this.tryPromoteWaitlisted(tenantId, booking.sessionId, booking.slotStartAt);
    }
  }

  async listMyBookings(tenantId: string, employeeId: string): Promise<MassageBookingRecord[]> {
    return this.massageRepo.listBookingsByEmployee(tenantId, employeeId);
  }

  async listSessionBookings(tenantId: string, sessionId: string, requestedBy: string): Promise<MassageBookingRecord[]> {
    await this.requireManageBookingPermission(tenantId, requestedBy);
    return this.massageRepo.listBookingsBySession(tenantId, sessionId);
  }

  // ─── Recurring Schedule Methods ──────────────────────────────────────

  async createSchedule(input: CreateScheduleInput): Promise<{ scheduleId: string }> {
    await this.requireManageBookingPermission(input.tenantId, input.createdByEmployeeId);

    const scheduleId = randomUUID().slice(0, 8);
    const schedule: MassageScheduleRecord = {
      tenantId: input.tenantId,
      scheduleId,
      dayOfWeek: input.dayOfWeek,
      startTime: input.startTime,
      endTime: input.endTime,
      location: input.location,
      slotDurationMinutes: input.slotDurationMinutes ?? 20,
      therapistCount: input.therapistCount ?? 1,
      mode: input.mode,
      drawMode: input.drawMode ?? 'AUTO',
      drawLeadMinutes: input.drawLeadMinutes ?? 60,
      openLeadDays: input.openLeadDays ?? 7,
      timezone: input.timezone ?? 'Asia/Taipei',
      status: 'ACTIVE',
      createdByEmployeeId: input.createdByEmployeeId,
      createdAt: this.options.now().toISOString(),
    };

    await this.massageRepo.createSchedule(schedule);
    return { scheduleId };
  }

  async listSchedules(tenantId: string, requestedBy: string): Promise<MassageScheduleRecord[]> {
    await this.requireManageBookingPermission(tenantId, requestedBy);
    return this.massageRepo.listSchedules(tenantId);
  }

  async toggleSchedule(tenantId: string, scheduleId: string, requestedBy: string): Promise<{ status: MassageScheduleStatus }> {
    await this.requireManageBookingPermission(tenantId, requestedBy);

    const schedule = await this.massageRepo.findScheduleById(tenantId, scheduleId);
    if (!schedule) throw new NotFoundError('Schedule not found');

    schedule.status = schedule.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    await this.massageRepo.updateSchedule(schedule);

    return { status: schedule.status };
  }

  async generateScheduledSessions(tenantId: string, targetDate: string): Promise<number> {
    const schedules = await this.massageRepo.listSchedules(tenantId);
    const activeSchedules = schedules.filter(s => s.status === 'ACTIVE');

    // Determine day of week for target date
    const targetDayOfWeek = new Date(`${targetDate}T00:00:00Z`).getUTCDay();

    // Get existing sessions for dedup check
    const existingSessions = await this.massageRepo.listActiveSessions(tenantId, targetDate);

    let created = 0;

    for (const schedule of activeSchedules) {
      if (schedule.dayOfWeek !== targetDayOfWeek) continue;

      // Check if session already exists for this date + location
      const duplicate = existingSessions.find(
        s => s.date === targetDate && s.location === schedule.location
      );
      if (duplicate) continue;

      const startAt = localTimeToISO(targetDate, schedule.startTime);
      const endAt = localTimeToISO(targetDate, schedule.endTime);

      // Calculate openAt: targetDate - openLeadDays at midnight UTC
      const openDate = new Date(`${targetDate}T00:00:00Z`);
      openDate.setUTCDate(openDate.getUTCDate() - schedule.openLeadDays);
      const openAt = openDate.toISOString();

      // Calculate drawAt for LOTTERY mode
      let drawAt: string | null = null;
      if (schedule.mode === 'LOTTERY') {
        const startMs = new Date(startAt).getTime();
        drawAt = new Date(startMs - schedule.drawLeadMinutes * 60 * 1000).toISOString();
      }

      // Calculate quota = therapistCount * slotCount
      const durationMs = new Date(endAt).getTime() - new Date(startAt).getTime();
      const slotCount = Math.floor(durationMs / (schedule.slotDurationMinutes * 60 * 1000));
      const quota = schedule.therapistCount * slotCount;

      await this.createSessionRecord({
        tenantId,
        date: targetDate,
        startAt,
        endAt,
        location: schedule.location,
        quota,
        slotDurationMinutes: schedule.slotDurationMinutes,
        therapistCount: schedule.therapistCount,
        mode: schedule.mode,
        openAt,
        drawAt,
        drawMode: schedule.drawMode,
        createdByEmployeeId: schedule.createdByEmployeeId,
      });

      created++;
    }

    return created;
  }

  private async tryPromoteWaitlisted(tenantId: string, sessionId: string, slotStartAt: string): Promise<void> {
    const session = await this.getSession(tenantId, sessionId);
    const waitlisted = await this.massageRepo.listWaitlistedBySlot(tenantId, sessionId, slotStartAt);
    if (waitlisted.length === 0) return;

    const next = waitlisted[0];
    next.status = 'CONFIRMED';
    await this.massageRepo.updateBooking(next);

    const range = this.formatSlotTimeRange(slotStartAt, session.slotDurationMinutes);
    await this.notify(tenantId, next.lineUserId,
      `🎉 你已遞補成功！${session.date} ${range} 的按摩（${session.location}）\n⚠️ 若需取消請提早操作，以便候補者遞補。`);
  }

  private formatSlotTimeRange(slotStartAt: string, durationMinutes: number): string {
    const start = new Date(slotStartAt);
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
    const fmt = (d: Date) => d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${fmt(start)}–${fmt(end)}`;
  }

  private formatConfirmedMessage(session: MassageSessionRecord, slotStartAt?: string): string {
    const time = slotStartAt ?? session.startAt;
    const range = this.formatSlotTimeRange(time, session.slotDurationMinutes);
    return `✅ 你已成功預約 ${session.date} ${range} 的按摩（${session.location}）\n⚠️ 若需取消請提早操作，以便候補者遞補。`;
  }

  private formatRegisteredMessage(session: MassageSessionRecord, slotStartAt?: string): string {
    const slotInfo = slotStartAt
      ? ` ${this.formatSlotTimeRange(slotStartAt, session.slotDurationMinutes)}`
      : '';
    const resultTime = session.drawAt
      ? (() => {
          const d = new Date(new Date(session.drawAt).getTime() + 5 * 60 * 1000);
          return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
        })()
      : null;
    const timeHint = resultTime ? `，預計 ${resultTime} 後公布結果` : '，結果將於抽籤後通知';
    return `📝 已登記 ${session.date}${slotInfo} 的按摩抽籤${timeHint}`;
  }

  private async notify(tenantId: string, lineUserId: string, text: string): Promise<void> {
    try {
      await this.lineClient.pushMessage({
        tenantId,
        lineUserId,
        messages: [{ type: 'text', text }],
      });
    } catch {
      // Notification failure should not break the booking flow
    }
  }

  private async requireManageBookingPermission(tenantId: string, employeeId: string): Promise<void> {
    const bindings = await this.employeeRepo.listByTenant(tenantId);
    const binding = bindings.find(
      b => b.employeeId === employeeId && b.employmentStatus === 'ACTIVE'
    );
    if (!binding) throw new ForbiddenError('Employee not found');
    if (!binding.permissions?.canManageBooking) {
      throw new ForbiddenError('canManageBooking permission required');
    }
  }
}
