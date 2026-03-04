export type MassageSessionMode = 'FIRST_COME' | 'LOTTERY';
export type MassageSessionStatus = 'ACTIVE' | 'CANCELLED';
export type MassageBookingStatus = 'REGISTERED' | 'CONFIRMED' | 'UNSUCCESSFUL' | 'CANCELLED';

export interface MassageSessionRecord {
  tenantId: string;
  sessionId: string;
  date: string;
  startAt: string;
  endAt: string;
  location: string;
  quota: number;
  mode: MassageSessionMode;
  openAt: string;
  drawAt: string | null;
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
  employeeId: string;
  lineUserId: string;
  status: MassageBookingStatus;
  cancelledAt: string | null;
  cancelledByEmployeeId: string | null;
  cancellationReason: string | null;
  createdAt: string;
}
