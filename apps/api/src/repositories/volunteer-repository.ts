import type {
  VolunteerActivity,
  VolunteerRegistration,
  VolunteerCheckIn,
} from '../domain/volunteer.js';

export interface VolunteerRepository {
  // Activities
  createActivity(activity: VolunteerActivity): Promise<void>;
  findActivityById(activityId: string): Promise<VolunteerActivity | null>;
  updateActivity(activity: VolunteerActivity): Promise<void>;
  listActivitiesByStatus(status: string, fromDate?: string): Promise<VolunteerActivity[]>;

  // Registrations
  createRegistration(registration: VolunteerRegistration): Promise<void>;
  findRegistration(activityId: string, employeeId: string): Promise<VolunteerRegistration | null>;
  updateRegistration(registration: VolunteerRegistration): Promise<void>;
  listRegistrationsByActivity(activityId: string): Promise<VolunteerRegistration[]>;
  listRegistrationsByEmployee(employeeId: string): Promise<VolunteerRegistration[]>;
  countActiveRegistrations(activityId: string): Promise<number>;

  // Check-ins
  createCheckIn(checkIn: VolunteerCheckIn): Promise<void>;
  findCheckIn(activityId: string, employeeId: string): Promise<VolunteerCheckIn | null>;
  listCheckInsByActivity(activityId: string): Promise<VolunteerCheckIn[]>;
}

export class InMemoryVolunteerRepository implements VolunteerRepository {
  private readonly activities = new Map<string, VolunteerActivity>();
  private readonly registrations = new Map<string, VolunteerRegistration>();
  private readonly checkIns = new Map<string, VolunteerCheckIn>();

  private regKey(activityId: string, employeeId: string): string {
    return `${activityId}::${employeeId}`;
  }

  async createActivity(activity: VolunteerActivity): Promise<void> {
    this.activities.set(activity.activityId, { ...activity });
  }

  async findActivityById(activityId: string): Promise<VolunteerActivity | null> {
    return this.activities.get(activityId) ?? null;
  }

  async updateActivity(activity: VolunteerActivity): Promise<void> {
    this.activities.set(activity.activityId, { ...activity });
  }

  async listActivitiesByStatus(status: string, fromDate?: string): Promise<VolunteerActivity[]> {
    return [...this.activities.values()]
      .filter((a) => a.status === status)
      .filter((a) => !fromDate || a.activityDate >= fromDate)
      .sort((a, b) => a.activityDate.localeCompare(b.activityDate));
  }

  async createRegistration(registration: VolunteerRegistration): Promise<void> {
    this.registrations.set(this.regKey(registration.activityId, registration.employeeId), {
      ...registration,
    });
  }

  async findRegistration(
    activityId: string,
    employeeId: string
  ): Promise<VolunteerRegistration | null> {
    return this.registrations.get(this.regKey(activityId, employeeId)) ?? null;
  }

  async updateRegistration(registration: VolunteerRegistration): Promise<void> {
    this.registrations.set(this.regKey(registration.activityId, registration.employeeId), {
      ...registration,
    });
  }

  async listRegistrationsByActivity(activityId: string): Promise<VolunteerRegistration[]> {
    return [...this.registrations.values()].filter((r) => r.activityId === activityId);
  }

  async listRegistrationsByEmployee(employeeId: string): Promise<VolunteerRegistration[]> {
    return [...this.registrations.values()].filter((r) => r.employeeId === employeeId);
  }

  async countActiveRegistrations(activityId: string): Promise<number> {
    return [...this.registrations.values()].filter(
      (r) => r.activityId === activityId && r.status === 'REGISTERED'
    ).length;
  }

  async createCheckIn(checkIn: VolunteerCheckIn): Promise<void> {
    this.checkIns.set(this.regKey(checkIn.activityId, checkIn.employeeId), { ...checkIn });
  }

  async findCheckIn(activityId: string, employeeId: string): Promise<VolunteerCheckIn | null> {
    return this.checkIns.get(this.regKey(activityId, employeeId)) ?? null;
  }

  async listCheckInsByActivity(activityId: string): Promise<VolunteerCheckIn[]> {
    return [...this.checkIns.values()].filter((c) => c.activityId === activityId);
  }
}
