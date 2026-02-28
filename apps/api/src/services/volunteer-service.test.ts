import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VolunteerService } from './volunteer-service.js';
import { InMemoryVolunteerRepository } from '../repositories/volunteer-repository.js';
import { InMemoryEmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';

function createContext() {
  const volunteerRepo = new InMemoryVolunteerRepository();
  const employeeRepo = new InMemoryEmployeeBindingRepository();
  const service = new VolunteerService(volunteerRepo, employeeRepo, {
    tenantId: 'default-tenant',
    signingSecret: 'test-secret-key-for-hmac-signing',
    now: () => new Date('2026-04-01T09:00:00.000Z'),
  });
  return { service, volunteerRepo, employeeRepo };
}

describe('VolunteerService — Activity CRUD', () => {
  it('creates an activity with organizer-scan mode', async () => {
    const { service, volunteerRepo } = createContext();

    const result = await service.createActivity({
      title: 'Beach Cleanup',
      description: 'Clean up the beach',
      location: 'Wanli',
      activityDate: '2026-04-15',
      startTime: '09:00',
      endTime: '16:00',
      capacity: 30,
      checkInMode: 'organizer-scan',
      createdBy: 'E001',
    });

    assert.ok(result.activityId);
    const stored = await volunteerRepo.findActivityById(result.activityId);
    assert.ok(stored);
    assert.equal(stored.title, 'Beach Cleanup');
    assert.equal(stored.status, 'OPEN');
    assert.equal(stored.checkInMode, 'organizer-scan');
    assert.equal(stored.selfScanPayload, null);
  });

  it('creates a self-scan activity with pre-generated QR payload', async () => {
    const { service, volunteerRepo } = createContext();

    const result = await service.createActivity({
      title: 'Lecture',
      description: 'Open lecture',
      location: 'Auditorium',
      activityDate: '2026-04-20',
      startTime: '14:00',
      endTime: '16:00',
      capacity: null,
      checkInMode: 'self-scan',
      createdBy: 'E002',
    });

    const stored = await volunteerRepo.findActivityById(result.activityId);
    assert.ok(stored);
    assert.ok(stored.selfScanPayload);
    assert.ok(stored.selfScanPayload.includes('.'));
  });

  it('lists open activities sorted by date', async () => {
    const { service } = createContext();

    await service.createActivity({
      title: 'Later',
      description: '',
      location: '',
      activityDate: '2026-05-01',
      startTime: '09:00',
      endTime: '17:00',
      capacity: null,
      checkInMode: 'self-scan',
      createdBy: 'E001',
    });
    await service.createActivity({
      title: 'Earlier',
      description: '',
      location: '',
      activityDate: '2026-04-10',
      startTime: '09:00',
      endTime: '17:00',
      capacity: null,
      checkInMode: 'self-scan',
      createdBy: 'E001',
    });

    const list = await service.listActivities({ status: 'OPEN' });
    assert.equal(list.length, 2);
    assert.equal(list[0].title, 'Earlier');
    assert.equal(list[1].title, 'Later');
  });

  it('gets activity detail with registration count', async () => {
    const { service } = createContext();

    const { activityId } = await service.createActivity({
      title: 'Event',
      description: '',
      location: '',
      activityDate: '2026-04-15',
      startTime: '09:00',
      endTime: '17:00',
      capacity: 10,
      checkInMode: 'organizer-scan',
      createdBy: 'E001',
    });

    const detail = await service.getActivityDetail(activityId);
    assert.ok(detail);
    assert.equal(detail.activity.title, 'Event');
    assert.equal(detail.registrationCount, 0);
  });

  it('cancels activity by creator', async () => {
    const { service, volunteerRepo } = createContext();

    const { activityId } = await service.createActivity({
      title: 'Cancel Me',
      description: '',
      location: '',
      activityDate: '2026-04-15',
      startTime: '09:00',
      endTime: '17:00',
      capacity: null,
      checkInMode: 'self-scan',
      createdBy: 'E001',
    });

    await service.cancelActivity(activityId, 'E001');
    const stored = await volunteerRepo.findActivityById(activityId);
    assert.ok(stored);
    assert.equal(stored.status, 'CANCELLED');
  });

  it('rejects cancel by non-creator non-admin', async () => {
    const { service } = createContext();

    const { activityId } = await service.createActivity({
      title: 'Not yours',
      description: '',
      location: '',
      activityDate: '2026-04-15',
      startTime: '09:00',
      endTime: '17:00',
      capacity: null,
      checkInMode: 'self-scan',
      createdBy: 'E001',
    });

    await assert.rejects(
      () => service.cancelActivity(activityId, 'E999'),
      (error) => {
        assert.ok(error instanceof Error);
        return true;
      }
    );
  });
});

describe('VolunteerService — Registration', () => {
  it('registers for an open activity', async () => {
    const { service } = createContext();
    const { activityId } = await service.createActivity({
      title: 'Event',
      description: '',
      location: '',
      activityDate: '2026-04-15',
      startTime: '09:00',
      endTime: '17:00',
      capacity: 10,
      checkInMode: 'organizer-scan',
      createdBy: 'E001',
    });

    await service.register(activityId, 'E002');
    const detail = await service.getActivityDetail(activityId);
    assert.equal(detail!.registrationCount, 1);
  });

  it('rejects registration when capacity is full', async () => {
    const { service } = createContext();
    const { activityId } = await service.createActivity({
      title: 'Small',
      description: '',
      location: '',
      activityDate: '2026-04-15',
      startTime: '09:00',
      endTime: '17:00',
      capacity: 1,
      checkInMode: 'organizer-scan',
      createdBy: 'E001',
    });

    await service.register(activityId, 'E002');
    await assert.rejects(
      () => service.register(activityId, 'E003'),
      (error) => {
        assert.ok(error instanceof ConflictError);
        return true;
      }
    );
  });

  it('rejects duplicate registration', async () => {
    const { service } = createContext();
    const { activityId } = await service.createActivity({
      title: 'Event',
      description: '',
      location: '',
      activityDate: '2026-04-15',
      startTime: '09:00',
      endTime: '17:00',
      capacity: null,
      checkInMode: 'self-scan',
      createdBy: 'E001',
    });

    await service.register(activityId, 'E002');
    await assert.rejects(
      () => service.register(activityId, 'E002'),
      (error) => {
        assert.ok(error instanceof ConflictError);
        return true;
      }
    );
  });

  it('cancels registration', async () => {
    const { service } = createContext();
    const { activityId } = await service.createActivity({
      title: 'Event',
      description: '',
      location: '',
      activityDate: '2026-04-15',
      startTime: '09:00',
      endTime: '17:00',
      capacity: null,
      checkInMode: 'self-scan',
      createdBy: 'E001',
    });

    await service.register(activityId, 'E002');
    await service.cancelRegistration(activityId, 'E002');
    const detail = await service.getActivityDetail(activityId);
    assert.equal(detail!.registrationCount, 0);
  });

  it('lists my registrations', async () => {
    const { service } = createContext();
    await service.createActivity({
      title: 'A',
      description: '',
      location: '',
      activityDate: '2026-04-10',
      startTime: '09:00',
      endTime: '17:00',
      capacity: null,
      checkInMode: 'self-scan',
      createdBy: 'E001',
    });
    const { activityId: id2 } = await service.createActivity({
      title: 'B',
      description: '',
      location: '',
      activityDate: '2026-04-20',
      startTime: '09:00',
      endTime: '17:00',
      capacity: null,
      checkInMode: 'self-scan',
      createdBy: 'E001',
    });

    await service.register(id2, 'E002');
    const mine = await service.myActivities('E002');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].activityId, id2);
  });
});

describe('VolunteerService — Check-in', () => {
  it('organizer-scan: checks in a registered employee via digital ID payload', async () => {
    const { service } = createContext();
    const { activityId } = await service.createActivity({
      title: 'Event',
      description: '',
      location: '',
      activityDate: '2026-04-15',
      startTime: '09:00',
      endTime: '17:00',
      capacity: null,
      checkInMode: 'organizer-scan',
      createdBy: 'E001',
    });
    await service.register(activityId, 'E002');

    await service.organizerScanCheckIn(activityId, 'E002', 'E001');

    const checkIn = await service.getCheckInStatus(activityId, 'E002');
    assert.ok(checkIn);
    assert.equal(checkIn.mode, 'organizer-scan');
    assert.equal(checkIn.checkedInBy, 'E001');
  });

  it('self-scan: checks in via activity QR payload', async () => {
    const { service, volunteerRepo } = createContext();
    const { activityId } = await service.createActivity({
      title: 'Lecture',
      description: '',
      location: '',
      activityDate: '2026-04-01',
      startTime: '09:00',
      endTime: '17:00',
      capacity: null,
      checkInMode: 'self-scan',
      createdBy: 'E001',
    });
    await service.register(activityId, 'E002');

    const activity = await volunteerRepo.findActivityById(activityId);
    assert.ok(activity!.selfScanPayload);

    await service.selfScanCheckIn(activityId, activity!.selfScanPayload!, 'E002');

    const checkIn = await service.getCheckInStatus(activityId, 'E002');
    assert.ok(checkIn);
    assert.equal(checkIn.mode, 'self-scan');
  });

  it('rejects check-in for unregistered employee', async () => {
    const { service } = createContext();
    const { activityId } = await service.createActivity({
      title: 'Event',
      description: '',
      location: '',
      activityDate: '2026-04-15',
      startTime: '09:00',
      endTime: '17:00',
      capacity: null,
      checkInMode: 'organizer-scan',
      createdBy: 'E001',
    });

    await assert.rejects(
      () => service.organizerScanCheckIn(activityId, 'E999', 'E001'),
      (error) => {
        assert.ok(error instanceof ValidationError);
        return true;
      }
    );
  });

  it('rejects duplicate check-in', async () => {
    const { service } = createContext();
    const { activityId } = await service.createActivity({
      title: 'Event',
      description: '',
      location: '',
      activityDate: '2026-04-15',
      startTime: '09:00',
      endTime: '17:00',
      capacity: null,
      checkInMode: 'organizer-scan',
      createdBy: 'E001',
    });
    await service.register(activityId, 'E002');
    await service.organizerScanCheckIn(activityId, 'E002', 'E001');

    await assert.rejects(
      () => service.organizerScanCheckIn(activityId, 'E002', 'E001'),
      (error) => {
        assert.ok(error instanceof ConflictError);
        return true;
      }
    );
  });

  it('rejects self-scan with invalid QR payload', async () => {
    const { service } = createContext();
    const { activityId } = await service.createActivity({
      title: 'Event',
      description: '',
      location: '',
      activityDate: '2026-04-01',
      startTime: '09:00',
      endTime: '17:00',
      capacity: null,
      checkInMode: 'self-scan',
      createdBy: 'E001',
    });
    await service.register(activityId, 'E002');

    await assert.rejects(
      () => service.selfScanCheckIn(activityId, 'invalid.payload', 'E002'),
      (error) => {
        assert.ok(error instanceof ValidationError);
        return true;
      }
    );
  });
});

describe('VolunteerService — Report', () => {
  it('generates activity report with registrations and check-ins', async () => {
    const { service } = createContext();
    const { activityId } = await service.createActivity({
      title: 'Event',
      description: '',
      location: 'HQ',
      activityDate: '2026-04-15',
      startTime: '09:00',
      endTime: '17:00',
      capacity: null,
      checkInMode: 'organizer-scan',
      createdBy: 'E001',
    });
    await service.register(activityId, 'E002');
    await service.register(activityId, 'E003');
    await service.organizerScanCheckIn(activityId, 'E002', 'E001');

    const report = await service.getReport(activityId);
    assert.equal(report.activity.title, 'Event');
    assert.equal(report.registrations.length, 2);
    assert.equal(report.checkIns.length, 1);
  });

  it('exports CSV with correct headers and data', async () => {
    const { service } = createContext();
    const { activityId } = await service.createActivity({
      title: 'CSV Test',
      description: '',
      location: '',
      activityDate: '2026-04-15',
      startTime: '09:00',
      endTime: '17:00',
      capacity: null,
      checkInMode: 'organizer-scan',
      createdBy: 'E001',
    });
    await service.register(activityId, 'E002');
    await service.organizerScanCheckIn(activityId, 'E002', 'E001');

    const csv = await service.exportCsv(activityId);
    assert.ok(csv.includes('employeeId'));
    assert.ok(csv.includes('E002'));
    assert.ok(csv.includes('checkedInAt'));
  });
});
