export interface VolunteerActivity {
  tenantId: string;
  activityId: string;
  title: string;
  description: string;
  location: string;
  activityDate: string;
  startTime: string;
  endTime: string;
  capacity: number | null;
  checkInMode: 'organizer-scan' | 'self-scan';
  selfScanPayload: string | null;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  createdBy: string;
  createdAt: string;
}

export interface VolunteerRegistration {
  tenantId: string;
  activityId: string;
  employeeId: string;
  registeredAt: string;
  status: 'REGISTERED' | 'CANCELLED';
}

export interface VolunteerCheckIn {
  tenantId: string;
  activityId: string;
  employeeId: string;
  checkedInAt: string;
  checkedInBy: string | null;
  mode: 'organizer-scan' | 'self-scan';
}

export type CheckInMode = VolunteerActivity['checkInMode'];
