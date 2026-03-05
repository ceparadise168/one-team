import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CampingSplitService } from './camping-split-service.js';
import { InMemoryCampingRepository } from '../repositories/camping-repository.js';
import { StubLinePlatformClient } from '../line/line-platform-client.js';
import { ForbiddenError } from '../errors.js';

const TENANT = 'test-tenant';

function createContext(nowStr = '2026-03-01T09:00:00.000Z') {
  const repo = new InMemoryCampingRepository();
  const lineClient = new StubLinePlatformClient();
  const service = new CampingSplitService(repo, lineClient, { now: () => new Date(nowStr) });
  return { service, repo, lineClient };
}

describe('CampingSplitService — Trip CRUD', () => {
  it('creates a trip and adds creator as participant', async () => {
    const { service, repo } = createContext();

    const result = await service.createTrip({
      tenantId: TENANT,
      title: '冬季露營',
      startDate: '2026-12-20',
      endDate: '2026-12-22',
      creatorEmployeeId: 'EMP01',
      creatorName: 'Alice',
      creatorLineUserId: 'line-alice',
    });

    assert.ok(result.tripId);
    const trip = await repo.findTripById(result.tripId);
    assert.ok(trip);
    assert.equal(trip.status, 'OPEN');

    const participants = await repo.listParticipants(result.tripId);
    assert.equal(participants.length, 1);
    assert.equal(participants[0].name, 'Alice');
    assert.equal(participants[0].employeeId, 'EMP01');
  });
});

describe('CampingSplitService — Participants', () => {
  it('adds a household with members', async () => {
    const { service, repo } = createContext();
    const { tripId } = await service.createTrip({
      tenantId: TENANT, title: 'Test', startDate: '2026-12-20', endDate: '2026-12-22',
      creatorEmployeeId: 'EMP01', creatorName: 'Alice', creatorLineUserId: null,
    });

    const result = await service.addHousehold(tripId, {
      head: { name: 'Bob', employeeId: null, lineUserId: null, splitWeight: 1 },
      members: [
        { name: 'Bob太太', employeeId: null, lineUserId: null, splitWeight: 1 },
        { name: 'Bob小孩', employeeId: null, lineUserId: null, splitWeight: 0.5 },
      ],
      settleAsHousehold: true,
    });

    assert.ok(result.householdId);
    const participants = await repo.listParticipants(tripId);
    assert.equal(participants.length, 4);
    const householdMembers = participants.filter(p => p.householdId === result.householdId);
    assert.equal(householdMembers.length, 3);
    const head = householdMembers.find(p => p.isHouseholdHead);
    assert.ok(head);
    assert.equal(head.name, 'Bob');
  });
});

describe('CampingSplitService — Settlement', () => {
  it('only the creator can settle', async () => {
    const { service } = createContext();
    const { tripId } = await service.createTrip({
      tenantId: TENANT, title: 'Test', startDate: '2026-12-20', endDate: '2026-12-22',
      creatorEmployeeId: 'EMP01', creatorName: 'Alice', creatorLineUserId: null,
    });

    await assert.rejects(
      () => service.settle(tripId, 'OTHER_EMPLOYEE'),
      (err: Error) => err instanceof ForbiddenError,
    );
  });

  it('settles and sends LINE push notifications', async () => {
    const { service, repo, lineClient } = createContext();
    const { tripId } = await service.createTrip({
      tenantId: TENANT, title: '冬季露營', startDate: '2026-12-20', endDate: '2026-12-22',
      creatorEmployeeId: 'EMP01', creatorName: 'Can', creatorLineUserId: 'line-can',
    });

    await service.addParticipant(tripId, {
      name: 'Bob', employeeId: 'EMP02', lineUserId: 'line-bob', splitWeight: 1,
    });

    const participants = await repo.listParticipants(tripId);
    const canId = participants.find(p => p.name === 'Can')!.participantId;
    await service.addExpense(tripId, {
      description: '食材',
      amount: 2000,
      paidByParticipantId: canId,
      splitType: 'ALL',
      splitAmong: null,
    });

    const settlement = await service.settle(tripId, 'EMP01');

    assert.ok(settlement.transfers.length > 0);
    assert.ok(lineClient.pushedMessages.length > 0);

    const trip = await repo.findTripById(tripId);
    assert.equal(trip!.status, 'SETTLED');
  });
});
