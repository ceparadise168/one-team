export type MassageSessionMode = 'FIRST_COME' | 'LOTTERY';
export type MassageDrawMode = 'AUTO' | 'MANUAL';
export type MassageSessionStatus = 'ACTIVE' | 'CANCELLED';
export type MassageBookingStatus = 'REGISTERED' | 'CONFIRMED' | 'UNSUCCESSFUL' | 'WAITLISTED' | 'CANCELLED';

export interface MassageSessionRecord {
  tenantId: string;
  sessionId: string;
  date: string;
  startAt: string;
  endAt: string;
  location: string;
  quota: number;
  slotDurationMinutes: number;
  therapistCount: number;
  mode: MassageSessionMode;
  openAt: string;
  drawAt: string | null;
  drawMode: MassageDrawMode;
  drawnAt: string | null;
  status: MassageSessionStatus;
  cancelledAt: string | null;
  cancelledByEmployeeId: string | null;
  cancellationNote: string | null;
  createdByEmployeeId: string;
  createdAt: string;
}

export interface MassageBookingRecord {
  tenantId: string;
  bookingId: string;
  sessionId: string;
  slotStartAt: string;
  employeeId: string;
  lineUserId: string;
  status: MassageBookingStatus;
  cancelledAt: string | null;
  cancelledByEmployeeId: string | null;
  cancellationReason: string | null;
  createdAt: string;
}

export function generateSlots(session: MassageSessionRecord): string[] {
  const slots: string[] = [];
  const start = new Date(session.startAt).getTime();
  const end = new Date(session.endAt).getTime();
  const duration = (session.slotDurationMinutes ?? 20) * 60 * 1000;
  for (let t = start; t + duration <= end; t += duration) {
    slots.push(new Date(t).toISOString());
  }
  return slots;
}

export function getSessionTotalCapacity(session: MassageSessionRecord): number {
  const slots = generateSlots(session);
  return slots.length * (session.therapistCount ?? 1);
}

export type MassageScheduleStatus = 'ACTIVE' | 'PAUSED';

export interface MassageScheduleRecord {
  tenantId: string;
  scheduleId: string;
  dayOfWeek: number;        // 0=Sun, 1=Mon, ..., 6=Sat
  startTime: string;        // "12:00" (local time HH:mm)
  endTime: string;          // "15:00"
  location: string;
  slotDurationMinutes: number;
  therapistCount: number;
  mode: MassageSessionMode;
  drawMode: MassageDrawMode;
  drawLeadMinutes: number;  // how many minutes before session to draw (for LOTTERY)
  openLeadDays: number;     // how many days before to open booking (e.g., 7)
  timezone: string;         // e.g., "Asia/Taipei"
  status: MassageScheduleStatus;
  createdByEmployeeId: string;
  createdAt: string;
}
