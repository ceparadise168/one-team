import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import type { VolunteerRepository } from '../repositories/volunteer-repository.js';
import type { EmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
import type {
  VolunteerActivity,
  VolunteerRegistration,
  VolunteerCheckIn,
} from '../domain/volunteer.js';
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from '../errors.js';

interface VolunteerServiceOptions {
  tenantId: string;
  signingSecret: string;
  now: () => Date;
}

export class VolunteerService {
  constructor(
    private readonly volunteerRepo: VolunteerRepository,
    private readonly employeeRepo: EmployeeBindingRepository,
    private readonly options: VolunteerServiceOptions
  ) {}

  async createActivity(input: {
    title: string;
    description: string;
    location: string;
    city: string | null;
    activityDate: string;
    startTime: string;
    endTime: string;
    capacity: number | null;
    checkInMode: 'organizer-scan' | 'self-scan';
    createdBy: string;
  }): Promise<{ activityId: string }> {
    const activityId = randomUUID().slice(0, 8);
    const now = this.options.now();

    let selfScanPayload: string | null = null;
    if (input.checkInMode === 'self-scan') {
      selfScanPayload = this.generateActivityQrPayload(
        activityId,
        input.activityDate,
        input.startTime,
        input.endTime
      );
    }

    const activity: VolunteerActivity = {
      tenantId: this.options.tenantId,
      activityId,
      title: input.title,
      description: input.description,
      location: input.location,
      city: input.city,
      activityDate: input.activityDate,
      startTime: input.startTime,
      endTime: input.endTime,
      capacity: input.capacity,
      checkInMode: input.checkInMode,
      selfScanPayload,
      status: 'OPEN',
      createdBy: input.createdBy,
      createdAt: now.toISOString(),
    };

    await this.volunteerRepo.createActivity(activity);
    return { activityId };
  }

  async listActivities(input: {
    status?: string;
    fromDate?: string;
  }): Promise<VolunteerActivity[]> {
    return this.volunteerRepo.listActivitiesByStatus(input.status ?? 'OPEN', input.fromDate);
  }

  async getActivityDetail(
    activityId: string,
    employeeId?: string
  ): Promise<{
    activity: VolunteerActivity;
    registrationCount: number;
    myRegistration?: { status: string; registeredAt: string } | null;
  } | null> {
    const activity = await this.volunteerRepo.findActivityById(activityId);
    if (!activity) return null;
    const registrationCount = await this.volunteerRepo.countActiveRegistrations(activityId);
    let myRegistration: { status: string; registeredAt: string } | null | undefined;
    if (employeeId) {
      const reg = await this.volunteerRepo.findRegistration(activityId, employeeId);
      myRegistration = reg ? { status: reg.status, registeredAt: reg.registeredAt } : null;
    }
    return { activity, registrationCount, myRegistration };
  }

  async cancelActivity(activityId: string, employeeId: string): Promise<void> {
    const activity = await this.volunteerRepo.findActivityById(activityId);
    if (!activity) throw new NotFoundError('Activity not found');
    if (activity.createdBy !== employeeId) {
      const isAdmin = await this.checkIsAdmin(employeeId);
      if (!isAdmin) throw new ForbiddenError('Only creator or admin can cancel');
    }
    activity.status = 'CANCELLED';
    await this.volunteerRepo.updateActivity(activity);
  }

  async register(activityId: string, employeeId: string): Promise<void> {
    const activity = await this.volunteerRepo.findActivityById(activityId);
    if (!activity) throw new NotFoundError('Activity not found');
    if (activity.status !== 'OPEN') throw new ValidationError('Activity is not open');

    const existing = await this.volunteerRepo.findRegistration(activityId, employeeId);
    if (existing && existing.status === 'REGISTERED') {
      throw new ConflictError('Already registered');
    }

    if (activity.capacity !== null) {
      const count = await this.volunteerRepo.countActiveRegistrations(activityId);
      if (count >= activity.capacity) throw new ConflictError('Activity is full');
    }

    await this.volunteerRepo.createRegistration({
      tenantId: this.options.tenantId,
      activityId,
      employeeId,
      registeredAt: this.options.now().toISOString(),
      status: 'REGISTERED',
    });
  }

  async cancelRegistration(activityId: string, employeeId: string): Promise<void> {
    const reg = await this.volunteerRepo.findRegistration(activityId, employeeId);
    if (!reg || reg.status !== 'REGISTERED') {
      throw new NotFoundError('Registration not found');
    }
    reg.status = 'CANCELLED';
    await this.volunteerRepo.updateRegistration(reg);
  }

  async myActivities(employeeId: string): Promise<VolunteerRegistration[]> {
    const registrations = await this.volunteerRepo.listRegistrationsByEmployee(employeeId);
    return registrations.filter((r) => r.status === 'REGISTERED');
  }

  async organizerScanCheckIn(
    activityId: string,
    employeeId: string,
    scannedBy: string
  ): Promise<void> {
    await this.validateCheckIn(activityId, employeeId);

    await this.volunteerRepo.createCheckIn({
      tenantId: this.options.tenantId,
      activityId,
      employeeId,
      checkedInAt: this.options.now().toISOString(),
      checkedInBy: scannedBy,
      mode: 'organizer-scan',
    });
  }

  async selfScanCheckIn(
    activityId: string,
    qrPayload: string,
    employeeId: string
  ): Promise<void> {
    this.verifyActivityQrPayload(qrPayload, activityId);
    await this.validateCheckIn(activityId, employeeId);

    await this.volunteerRepo.createCheckIn({
      tenantId: this.options.tenantId,
      activityId,
      employeeId,
      checkedInAt: this.options.now().toISOString(),
      checkedInBy: null,
      mode: 'self-scan',
    });
  }

  async getCheckInStatus(
    activityId: string,
    employeeId: string
  ): Promise<VolunteerCheckIn | null> {
    return this.volunteerRepo.findCheckIn(activityId, employeeId);
  }

  async getReport(activityId: string): Promise<{
    activity: VolunteerActivity;
    registrations: VolunteerRegistration[];
    checkIns: VolunteerCheckIn[];
  }> {
    const activity = await this.volunteerRepo.findActivityById(activityId);
    if (!activity) throw new NotFoundError('Activity not found');
    const registrations = await this.volunteerRepo.listRegistrationsByActivity(activityId);
    const checkIns = await this.volunteerRepo.listCheckInsByActivity(activityId);
    return { activity, registrations, checkIns };
  }

  async exportCsv(activityId: string): Promise<string> {
    const { registrations, checkIns } = await this.getReport(activityId);

    const checkInMap = new Map(checkIns.map((c) => [c.employeeId, c]));
    const headers = ['employeeId', 'registeredAt', 'status', 'checkedInAt', 'checkInMode'];
    const rows = registrations.map((r) => {
      const c = checkInMap.get(r.employeeId);
      return [
        r.employeeId,
        r.registeredAt,
        r.status,
        c?.checkedInAt ?? '',
        c?.mode ?? '',
      ];
    });

    return [headers, ...rows].map((r) => r.join(',')).join('\n');
  }

  private async checkIsAdmin(employeeId: string): Promise<boolean> {
    const bindings = await this.employeeRepo.listByTenant(this.options.tenantId);
    const binding = bindings.find(
      (b) => b.employeeId === employeeId && b.employmentStatus === 'ACTIVE'
    );
    if (!binding) return false;
    const permissions = binding.permissions ?? {};
    return permissions.canInvite === true || permissions.canRemove === true;
  }

  private async validateCheckIn(activityId: string, employeeId: string): Promise<void> {
    const activity = await this.volunteerRepo.findActivityById(activityId);
    if (!activity) throw new NotFoundError('Activity not found');

    const reg = await this.volunteerRepo.findRegistration(activityId, employeeId);
    if (!reg || reg.status !== 'REGISTERED') {
      throw new ValidationError('Employee is not registered for this activity');
    }

    const existing = await this.volunteerRepo.findCheckIn(activityId, employeeId);
    if (existing) throw new ConflictError('Already checked in');
  }

  private generateActivityQrPayload(
    activityId: string,
    activityDate: string,
    startTime: string,
    endTime: string
  ): string {
    const validFrom = new Date(`${activityDate}T${startTime}:00`);
    validFrom.setMinutes(validFrom.getMinutes() - 30);
    const validUntil = new Date(`${activityDate}T${endTime}:00`);
    validUntil.setMinutes(validUntil.getMinutes() + 30);

    const payload = {
      v: 1,
      type: 'activity-checkin',
      activityId,
      validFrom: validFrom.toISOString(),
      validUntil: validUntil.toISOString(),
    };
    const payloadSegment = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', this.options.signingSecret)
      .update(payloadSegment)
      .digest('base64url');
    return `${payloadSegment}.${signature}`;
  }

  private verifyActivityQrPayload(token: string, expectedActivityId: string): void {
    const parts = token.split('.');
    if (parts.length !== 2) throw new ValidationError('Invalid QR payload format');

    const [payloadSegment, signatureSegment] = parts;
    const expectedSig = createHmac('sha256', this.options.signingSecret)
      .update(payloadSegment)
      .digest('base64url');

    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    const providedBuf = Buffer.from(signatureSegment, 'utf8');

    if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
      throw new ValidationError('Invalid QR payload signature');
    }

    const payload = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8'));
    if (payload.type !== 'activity-checkin') throw new ValidationError('Wrong QR type');
    if (payload.activityId !== expectedActivityId)
      throw new ValidationError('QR does not match activity');

    const now = this.options.now();
    if (new Date(payload.validFrom) > now || new Date(payload.validUntil) < now) {
      throw new ValidationError('QR payload expired or not yet valid');
    }
  }
}
