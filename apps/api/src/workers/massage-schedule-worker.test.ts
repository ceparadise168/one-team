import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleScheduleGeneration } from './massage-schedule-worker.js';
import { InMemoryMassageBookingRepository } from '../repositories/massage-booking-repository.js';
import { InMemoryEmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
import { StubLinePlatformClient } from '../line/line-platform-client.js';
import { MassageBookingService } from '../services/massage-booking-service.js';
import type { MassageScheduleRecord } from '../domain/massage-booking.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const ADMIN_ID = 'ADMIN01';

function makeSchedule(overrides: Partial<MassageScheduleRecord> = {}): MassageScheduleRecord {
  return {
    tenantId: TENANT_A,
    scheduleId: 'sched-01',
    dayOfWeek: 1, // Monday
    startTime: '12:00',
    endTime: '15:00',
    location: 'B1 Massage Room',
    slotDurationMinutes: 20,
    therapistCount: 1,
    mode: 'FIRST_COME',
    drawMode: 'AUTO',
    drawLeadMinutes: 60,
    openLeadDays: 7,
    timezone: 'Asia/Taipei',
    status: 'ACTIVE',
    createdByEmployeeId: ADMIN_ID,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}


describe('MassageScheduleWorker', () => {
  let massageRepo: InMemoryMassageBookingRepository;
  let employeeRepo: InMemoryEmployeeBindingRepository;
  let lineClient: StubLinePlatformClient;
  let service: MassageBookingService;

  // Use a fixed "now" that is a Sunday so Monday falls within the 14-day window
  const fixedNow = new Date('2026-03-01T00:00:00.000Z'); // Sunday

  beforeEach(() => {
    massageRepo = new InMemoryMassageBookingRepository();
    employeeRepo = new InMemoryEmployeeBindingRepository();
    lineClient = new StubLinePlatformClient();
    service = new MassageBookingService(massageRepo, employeeRepo, lineClient, {
      now: () => fixedNow,
    });
  });

  it('generates sessions for active schedules across tenants', async () => {
    // Two tenants, each with an active Monday schedule
    await massageRepo.createSchedule(makeSchedule({ tenantId: TENANT_A, scheduleId: 'sched-a' }));
    await massageRepo.createSchedule(makeSchedule({ tenantId: TENANT_B, scheduleId: 'sched-b' }));

    await handleScheduleGeneration({}, { massageRepo, massageService: service });

    // There should be 2 Mondays in the 14-day window from 2026-03-01 (Sun)
    // 2026-03-02 (Mon) and 2026-03-09 (Mon)
    const sessionsA = await massageRepo.listActiveSessions(TENANT_A);
    const sessionsB = await massageRepo.listActiveSessions(TENANT_B);

    assert.equal(sessionsA.length, 2, 'tenant A should have 2 sessions (2 Mondays)');
    assert.equal(sessionsB.length, 2, 'tenant B should have 2 sessions (2 Mondays)');
  });

  it('skips paused schedules', async () => {
    await massageRepo.createSchedule(makeSchedule({ status: 'PAUSED' }));

    await handleScheduleGeneration({}, { massageRepo, massageService: service });

    const sessions = await massageRepo.listActiveSessions(TENANT_A);
    assert.equal(sessions.length, 0, 'paused schedules should not generate sessions');
  });

  it('handles errors gracefully without blocking other tenants', async () => {
    // Tenant A has a valid schedule
    await massageRepo.createSchedule(makeSchedule({ tenantId: TENANT_A, scheduleId: 'sched-a' }));

    // Create a service that will throw for tenant B
    const failingService = new MassageBookingService(massageRepo, employeeRepo, lineClient, {
      now: () => fixedNow,
    });

    // Monkey-patch generateScheduledSessions to fail for TENANT_B
    const originalMethod = failingService.generateScheduledSessions.bind(failingService);
    let callCount = 0;
    failingService.generateScheduledSessions = async (tenantId: string, date: string) => {
      if (tenantId === TENANT_B) {
        callCount++;
        throw new Error('simulated failure');
      }
      return originalMethod(tenantId, date);
    };

    // Add tenant B schedule
    await massageRepo.createSchedule(makeSchedule({ tenantId: TENANT_B, scheduleId: 'sched-b' }));

    // Should not throw
    await handleScheduleGeneration({}, { massageRepo, massageService: failingService });

    // Tenant A sessions should still be created
    const sessionsA = await massageRepo.listActiveSessions(TENANT_A);
    assert.ok(sessionsA.length > 0, 'tenant A sessions should be created despite tenant B failures');
    assert.ok(callCount > 0, 'tenant B should have been attempted');
  });

  it('is idempotent - does not duplicate sessions on re-run', async () => {
    await massageRepo.createSchedule(makeSchedule());

    // Run twice
    await handleScheduleGeneration({}, { massageRepo, massageService: service });
    await handleScheduleGeneration({}, { massageRepo, massageService: service });

    const sessions = await massageRepo.listActiveSessions(TENANT_A);
    // Should still only have 2 sessions (2 Mondays), not 4
    assert.equal(sessions.length, 2, 'should not create duplicate sessions');
  });
});
