import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VolunteerService } from './volunteer-service.js';
import { InMemoryVolunteerRepository } from '../repositories/volunteer-repository.js';
import { InMemoryEmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
import { ConflictError, ValidationError } from '../errors.js';

function createContext() {
  const volunteerRepo = new InMemoryVolunteerRepository();
  const employeeRepo = new InMemoryEmployeeBindingRepository();
  const service = new VolunteerService(volunteerRepo, employeeRepo, {
    tenantId: 'default-tenant',
    signingSecret: 'test-secret-key-for-hmac-signing',
    now: () => new Date('2026-04-01T10:00:00.000Z'),
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
