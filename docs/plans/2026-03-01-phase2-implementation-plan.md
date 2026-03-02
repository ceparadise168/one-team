# Phase 2: Volunteer Service Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a volunteer activity management system (browse, register, check-in, report) as a LINE Mini App, serving as the first advanced service to win HR adoption of the ONE TEAM platform.

**Architecture:** Extend existing Lambda API with new `/v1/volunteer/*` routes and a dedicated `one-team-{stage}-volunteer` DynamoDB table. Frontend added as React Router pages within existing `liff-web/` SPA, hosted on S3 + CloudFront via CDK.

**Tech Stack:** Node 20 ESM, TypeScript strict, DynamoDB single-table, Lambda + API Gateway, React 19, Vite, LIFF SDK 2.27, CDK

**Design doc:** `docs/plans/2026-03-01-phase2-mini-app-volunteer-design.md`

---

## Task 1: CDK — Add Volunteer DynamoDB Table

**Files:**
- Modify: `infra/cdk/src/stacks/platform-stack.ts`

**Step 1: Add volunteer table with GSIs**

In `platform-stack.ts`, after the existing table definitions (around the audit-events table), add:

```typescript
const volunteerTable = new dynamodb.Table(this, 'VolunteerTable', {
  ...tableProps,
  tableName: `${prefix}-volunteer`,
});

volunteerTable.addGlobalSecondaryIndex({
  indexName: 'gsi-status-date',
  partitionKey: { name: 'gsi_status', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'activity_date', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
});

volunteerTable.addGlobalSecondaryIndex({
  indexName: 'gsi-employee',
  partitionKey: { name: 'employee_id', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'registered_at', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
});

volunteerTable.grantReadWriteData(apiRuntimeHandler);
```

**Step 2: Add environment variables to Lambda**

In the `apiRuntimeHandler` environment block, add:

```typescript
VOLUNTEER_TABLE_NAME: `${prefix}-volunteer`,
DEFAULT_TENANT_ID: process.env.DEFAULT_TENANT_ID ?? 'default-tenant',
```

**Step 3: Run typecheck**

Run: `pnpm --filter @one-team/infra-cdk exec tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add infra/cdk/src/stacks/platform-stack.ts
git commit -m "feat(infra): add volunteer DynamoDB table with GSIs"
```

---

## Task 2: Domain Types — Volunteer Activity

**Files:**
- Create: `apps/api/src/domain/volunteer.ts`

**Step 1: Define domain types**

```typescript
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
```

**Step 2: Run typecheck**

Run: `pnpm --filter @one-team/api exec tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/api/src/domain/volunteer.ts
git commit -m "feat: add volunteer domain types"
```

---

## Task 3: Repository — Volunteer Repository Interface + In-Memory Implementation

**Files:**
- Create: `apps/api/src/repositories/volunteer-repository.ts`

**Step 1: Define repository interface and in-memory implementation**

Follow existing pattern from `invitation-binding-repository.ts`: interface + InMemory class in same file, Map-based storage with composite keys.

```typescript
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
```

**Step 2: Run typecheck**

Run: `pnpm --filter @one-team/api exec tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/api/src/repositories/volunteer-repository.ts
git commit -m "feat: add volunteer repository interface and in-memory implementation"
```

---

## Task 4: Service — Activity CRUD (Create + List + Get + Update + Cancel)

**Files:**
- Create: `apps/api/src/services/volunteer-service.ts`
- Create: `apps/api/src/services/volunteer-service.test.ts`

**Step 1: Write failing tests for activity CRUD**

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VolunteerService } from './volunteer-service.js';
import { InMemoryVolunteerRepository } from '../repositories/volunteer-repository.js';
import { InMemoryEmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';

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
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @one-team/api test`
Expected: FAIL — `volunteer-service.js` does not exist

**Step 3: Implement VolunteerService (activity CRUD methods)**

```typescript
import { randomUUID } from 'node:crypto';
import { createHmac } from 'node:crypto';
import type { VolunteerRepository } from '../repositories/volunteer-repository.js';
import type { EmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
import type { VolunteerActivity } from '../domain/volunteer.js';
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
    activityId: string
  ): Promise<{ activity: VolunteerActivity; registrationCount: number } | null> {
    const activity = await this.volunteerRepo.findActivityById(activityId);
    if (!activity) return null;
    const registrationCount = await this.volunteerRepo.countActiveRegistrations(activityId);
    return { activity, registrationCount };
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

  private async checkIsAdmin(employeeId: string): Promise<boolean> {
    const bindings = await this.employeeRepo.listByTenant(this.options.tenantId);
    const binding = bindings.find(
      (b) => b.employeeId === employeeId && b.employmentStatus === 'ACTIVE'
    );
    if (!binding) return false;
    const permissions = binding.permissions ?? {};
    return permissions.canInvite === true || permissions.canRemove === true;
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
}
```

**Step 4: Run tests**

Run: `pnpm --filter @one-team/api test`
Expected: PASS (all 6 activity CRUD tests)

**Step 5: Commit**

```bash
git add apps/api/src/services/volunteer-service.ts apps/api/src/services/volunteer-service.test.ts
git commit -m "feat: add volunteer service with activity CRUD and tests"
```

---

## Task 5: Service — Registration (Register + Cancel + My Activities)

**Files:**
- Modify: `apps/api/src/services/volunteer-service.ts`
- Modify: `apps/api/src/services/volunteer-service.test.ts`

**Step 1: Add failing registration tests**

Append to the test file:

```typescript
describe('VolunteerService — Registration', () => {
  it('registers for an open activity', async () => {
    const { service } = createContext();
    const { activityId } = await service.createActivity({
      title: 'Event', description: '', location: '', activityDate: '2026-04-15',
      startTime: '09:00', endTime: '17:00', capacity: 10,
      checkInMode: 'organizer-scan', createdBy: 'E001',
    });

    await service.register(activityId, 'E002');
    const detail = await service.getActivityDetail(activityId);
    assert.equal(detail!.registrationCount, 1);
  });

  it('rejects registration when capacity is full', async () => {
    const { service } = createContext();
    const { activityId } = await service.createActivity({
      title: 'Small', description: '', location: '', activityDate: '2026-04-15',
      startTime: '09:00', endTime: '17:00', capacity: 1,
      checkInMode: 'organizer-scan', createdBy: 'E001',
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
      title: 'Event', description: '', location: '', activityDate: '2026-04-15',
      startTime: '09:00', endTime: '17:00', capacity: null,
      checkInMode: 'self-scan', createdBy: 'E001',
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
      title: 'Event', description: '', location: '', activityDate: '2026-04-15',
      startTime: '09:00', endTime: '17:00', capacity: null,
      checkInMode: 'self-scan', createdBy: 'E001',
    });

    await service.register(activityId, 'E002');
    await service.cancelRegistration(activityId, 'E002');
    const detail = await service.getActivityDetail(activityId);
    assert.equal(detail!.registrationCount, 0);
  });

  it('lists my registrations', async () => {
    const { service } = createContext();
    await service.createActivity({
      title: 'A', description: '', location: '', activityDate: '2026-04-10',
      startTime: '09:00', endTime: '17:00', capacity: null,
      checkInMode: 'self-scan', createdBy: 'E001',
    });
    const { activityId: id2 } = await service.createActivity({
      title: 'B', description: '', location: '', activityDate: '2026-04-20',
      startTime: '09:00', endTime: '17:00', capacity: null,
      checkInMode: 'self-scan', createdBy: 'E001',
    });

    await service.register(id2, 'E002');
    const mine = await service.myActivities('E002');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].activityId, id2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @one-team/api test`
Expected: FAIL — `service.register` is not a function

**Step 3: Implement registration methods in VolunteerService**

Add to `volunteer-service.ts`:

```typescript
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
```

Add import at top:

```typescript
import type { VolunteerActivity, VolunteerRegistration } from '../domain/volunteer.js';
```

**Step 4: Run tests**

Run: `pnpm --filter @one-team/api test`
Expected: PASS (all registration tests)

**Step 5: Commit**

```bash
git add apps/api/src/services/volunteer-service.ts apps/api/src/services/volunteer-service.test.ts
git commit -m "feat: add volunteer registration with capacity check and cancellation"
```

---

## Task 6: Service — Check-in (Both Modes)

**Files:**
- Modify: `apps/api/src/services/volunteer-service.ts`
- Modify: `apps/api/src/services/volunteer-service.test.ts`

**Step 1: Add failing check-in tests**

Append to the test file:

```typescript
describe('VolunteerService — Check-in', () => {
  it('organizer-scan: checks in a registered employee via digital ID payload', async () => {
    const { service } = createContext();
    const { activityId } = await service.createActivity({
      title: 'Event', description: '', location: '', activityDate: '2026-04-15',
      startTime: '09:00', endTime: '17:00', capacity: null,
      checkInMode: 'organizer-scan', createdBy: 'E001',
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
      title: 'Lecture', description: '', location: '', activityDate: '2026-04-01',
      startTime: '09:00', endTime: '17:00', capacity: null,
      checkInMode: 'self-scan', createdBy: 'E001',
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
      title: 'Event', description: '', location: '', activityDate: '2026-04-15',
      startTime: '09:00', endTime: '17:00', capacity: null,
      checkInMode: 'organizer-scan', createdBy: 'E001',
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
      title: 'Event', description: '', location: '', activityDate: '2026-04-15',
      startTime: '09:00', endTime: '17:00', capacity: null,
      checkInMode: 'organizer-scan', createdBy: 'E001',
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
      title: 'Event', description: '', location: '', activityDate: '2026-04-01',
      startTime: '09:00', endTime: '17:00', capacity: null,
      checkInMode: 'self-scan', createdBy: 'E001',
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
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @one-team/api test`
Expected: FAIL — methods not found

**Step 3: Implement check-in methods**

Add to `volunteer-service.ts`:

```typescript
import { timingSafeEqual } from 'node:crypto';

// ... inside VolunteerService class:

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
  if (payload.activityId !== expectedActivityId) throw new ValidationError('QR does not match activity');

  const now = this.options.now();
  if (new Date(payload.validFrom) > now || new Date(payload.validUntil) < now) {
    throw new ValidationError('QR payload expired or not yet valid');
  }
}
```

Add to imports: `import type { VolunteerCheckIn } from '../domain/volunteer.js';`

**Step 4: Run tests**

Run: `pnpm --filter @one-team/api test`
Expected: PASS (all check-in tests)

**Step 5: Commit**

```bash
git add apps/api/src/services/volunteer-service.ts apps/api/src/services/volunteer-service.test.ts
git commit -m "feat: add dual-mode volunteer check-in with QR verification"
```

---

## Task 7: Service — Report + CSV Export

**Files:**
- Modify: `apps/api/src/services/volunteer-service.ts`
- Modify: `apps/api/src/services/volunteer-service.test.ts`

**Step 1: Add failing report tests**

```typescript
describe('VolunteerService — Report', () => {
  it('generates activity report with registrations and check-ins', async () => {
    const { service } = createContext();
    const { activityId } = await service.createActivity({
      title: 'Event', description: '', location: 'HQ', activityDate: '2026-04-15',
      startTime: '09:00', endTime: '17:00', capacity: null,
      checkInMode: 'organizer-scan', createdBy: 'E001',
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
      title: 'CSV Test', description: '', location: '', activityDate: '2026-04-15',
      startTime: '09:00', endTime: '17:00', capacity: null,
      checkInMode: 'organizer-scan', createdBy: 'E001',
    });
    await service.register(activityId, 'E002');
    await service.organizerScanCheckIn(activityId, 'E002', 'E001');

    const csv = await service.exportCsv(activityId);
    assert.ok(csv.includes('employeeId'));
    assert.ok(csv.includes('E002'));
    assert.ok(csv.includes('checkedInAt'));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @one-team/api test`
Expected: FAIL — methods not found

**Step 3: Implement report methods**

Add to `volunteer-service.ts`:

```typescript
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
```

**Step 4: Run tests**

Run: `pnpm --filter @one-team/api test`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/services/volunteer-service.ts apps/api/src/services/volunteer-service.test.ts
git commit -m "feat: add volunteer report generation and CSV export"
```

---

## Task 8: API Routes — Wire Volunteer Endpoints in Lambda

**Files:**
- Modify: `apps/api/src/lambda.ts`

**Step 1: Instantiate VolunteerService**

In the service instantiation section of `lambda.ts` (around lines 308-405), add:

```typescript
import { VolunteerService } from './services/volunteer-service.js';
import { InMemoryVolunteerRepository } from './repositories/volunteer-repository.js';

// After existing service instantiation:
const volunteerRepository = new InMemoryVolunteerRepository();
// TODO Task 11: Replace with DynamoDbVolunteerRepository when USE_DYNAMODB_REPOSITORIES is set
const volunteerService = new VolunteerService(volunteerRepository, employeeBindingRepository, {
  tenantId: process.env.DEFAULT_TENANT_ID ?? 'default-tenant',
  signingSecret: process.env.ACCESS_TOKEN_SECRET ?? 'dev-signing-secret',
  now: () => new Date(),
});
```

**Step 2: Add route matching in handler function**

After existing route matches (before the 404 fallback), add volunteer routes:

```typescript
// Volunteer: list activities
const volunteerActivitiesMatch = path.match(/^\/v1\/volunteer\/activities$/);
if (volunteerActivitiesMatch) {
  if (method === 'GET') {
    const status = event.queryStringParameters?.status ?? 'OPEN';
    const fromDate = event.queryStringParameters?.from;
    const activities = await volunteerService.listActivities({ status, fromDate });
    return jsonResponse(200, { activities }, responseOptions);
  }
  if (method === 'POST') {
    const principal = await requireEmployeePrincipal({ event, authSessionService });
    const body = parseBody(event);
    const result = await volunteerService.createActivity({
      ...body,
      createdBy: principal.employeeId,
    });
    return jsonResponse(201, result, responseOptions);
  }
}

// Volunteer: single activity
const volunteerActivityMatch = path.match(/^\/v1\/volunteer\/activities\/([^/]+)$/);
if (volunteerActivityMatch) {
  const activityId = volunteerActivityMatch[1];
  if (method === 'GET') {
    const detail = await volunteerService.getActivityDetail(activityId);
    if (!detail) return jsonResponse(404, { error: 'Activity not found' }, responseOptions);
    return jsonResponse(200, detail, responseOptions);
  }
  if (method === 'DELETE') {
    const principal = await requireEmployeePrincipal({ event, authSessionService });
    await volunteerService.cancelActivity(activityId, principal.employeeId);
    return jsonResponse(200, { ok: true }, responseOptions);
  }
}

// Volunteer: register
const volunteerRegisterMatch = path.match(
  /^\/v1\/volunteer\/activities\/([^/]+)\/register$/
);
if (volunteerRegisterMatch) {
  const activityId = volunteerRegisterMatch[1];
  const principal = await requireEmployeePrincipal({ event, authSessionService });
  if (method === 'POST') {
    await volunteerService.register(activityId, principal.employeeId);
    return jsonResponse(201, { ok: true }, responseOptions);
  }
  if (method === 'DELETE') {
    await volunteerService.cancelRegistration(activityId, principal.employeeId);
    return jsonResponse(200, { ok: true }, responseOptions);
  }
}

// Volunteer: my activities
if (path === '/v1/volunteer/my-activities' && method === 'GET') {
  const principal = await requireEmployeePrincipal({ event, authSessionService });
  const registrations = await volunteerService.myActivities(principal.employeeId);
  return jsonResponse(200, { registrations }, responseOptions);
}

// Volunteer: self-scan check-in
const volunteerCheckInMatch = path.match(
  /^\/v1\/volunteer\/activities\/([^/]+)\/check-in$/
);
if (volunteerCheckInMatch && method === 'POST') {
  const activityId = volunteerCheckInMatch[1];
  const principal = await requireEmployeePrincipal({ event, authSessionService });
  const body = parseBody(event);
  await volunteerService.selfScanCheckIn(activityId, body.activityQrPayload, principal.employeeId);
  return jsonResponse(200, { ok: true }, responseOptions);
}

// Volunteer: organizer scan check-in
const volunteerScanCheckInMatch = path.match(
  /^\/v1\/volunteer\/activities\/([^/]+)\/scan-check-in$/
);
if (volunteerScanCheckInMatch && method === 'POST') {
  const activityId = volunteerScanCheckInMatch[1];
  const principal = await requireEmployeePrincipal({ event, authSessionService });
  const body = parseBody(event);
  await volunteerService.organizerScanCheckIn(activityId, body.employeeId, principal.employeeId);
  return jsonResponse(200, { ok: true }, responseOptions);
}

// Volunteer: report
const volunteerReportMatch = path.match(
  /^\/v1\/volunteer\/activities\/([^/]+)\/report$/
);
if (volunteerReportMatch && method === 'GET') {
  const activityId = volunteerReportMatch[1];
  const principal = await requireEmployeePrincipal({ event, authSessionService });
  const report = await volunteerService.getReport(activityId);
  return jsonResponse(200, report, responseOptions);
}

// Volunteer: export CSV
const volunteerExportMatch = path.match(
  /^\/v1\/volunteer\/activities\/([^/]+)\/report\/export$/
);
if (volunteerExportMatch && method === 'GET') {
  const activityId = volunteerExportMatch[1];
  const principal = await requireEmployeePrincipal({ event, authSessionService });
  const csv = await volunteerService.exportCsv(activityId);
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="volunteer-${activityId}.csv"`,
      ...responseOptions.cors,
    },
    body: csv,
  };
}
```

**Step 3: Run typecheck and tests**

Run: `pnpm --filter @one-team/api test`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/api/src/lambda.ts
git commit -m "feat: wire volunteer API routes in Lambda handler"
```

---

## Task 9: Flex Message — Update Services Menu with Mini App Links

**Files:**
- Modify: `apps/api/src/line/flex-message-templates.ts`

**Step 1: Update `buildServicesMenuFlexMessage` to include Mini App service entries**

Replace the existing `buildServicesMenuFlexMessage` function. The new version shows enabled services with URI actions (Mini App links) and disabled services with greyed-out "Coming soon" styling. The `miniAppBaseUrl` parameter should be passed in.

```typescript
export function buildServicesMenuFlexMessage(options?: {
  isAdmin?: boolean;
  miniAppBaseUrl?: string;
}): LineMessage {
  const miniAppBase = options?.miniAppBaseUrl ?? 'https://miniapp.line.me/';

  const enabledServices = ['volunteer'];

  const allServices = [
    { id: 'volunteer', label: '志工活動', desc: '查詢與報名志工活動', path: '/volunteer' },
    { id: 'voting', label: '投票', desc: '參與公司投票', path: '/voting' },
    { id: 'packages', label: '包裹簽收', desc: '簽收包裹通知', path: '/packages' },
    { id: 'repair', label: '總務報修', desc: '提交報修申請', path: '/repair' },
    { id: 'visitor', label: '訪客登記', desc: '登記訪客到訪', path: '/visitor' },
  ];

  // ... build bubbles from allServices, grey out if not in enabledServices
  // Enabled: URI action → miniAppBase + path
  // Disabled: postback action → action=coming_soon&service={id}
}
```

Refer to the existing bubble pattern (body + footer with button). Enabled services use `type: 'uri'` action; disabled use `type: 'postback'` with `data: 'action=coming_soon'`.

**Step 2: Add `coming_soon` postback handler in webhook-event-service.ts**

In the postback handler switch, add:

```typescript
case 'coming_soon':
  await this.linePlatformClient.replyMessage({
    tenantId,
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: '此功能即將推出，敬請期待！' }],
  });
  break;
```

**Step 3: Pass `miniAppBaseUrl` from lambda.ts when building Flex Messages**

Update the `handleServicesMenu` call in `webhook-event-service.ts` to pass the Mini App URL (from environment or config).

**Step 4: Run tests**

Run: `pnpm --filter @one-team/api test`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/line/flex-message-templates.ts apps/api/src/services/webhook-event-service.ts
git commit -m "feat: update services menu with Mini App links and coming-soon handling"
```

---

## Task 10: DynamoDB Repository — Volunteer

**Files:**
- Modify: `apps/api/src/repositories/dynamo-db-repository.ts` (or create `apps/api/src/repositories/dynamodb-volunteer-repository.ts`)

**Step 1: Implement DynamoDbVolunteerRepository**

Follow existing `DynamoDbEmployeeBindingRepository` pattern. Key operations:

- `createActivity`: PutCommand with `pk: ACTIVITY#{id}`, `sk: DETAIL`, plus GSI attributes `gsi_status` and `activity_date`
- `findActivityById`: GetCommand
- `updateActivity`: PutCommand (full replace, same as existing pattern)
- `listActivitiesByStatus`: QueryCommand on `gsi-status-date` GSI
- `createRegistration`: PutCommand with `pk: ACTIVITY#{id}`, `sk: REG#{employeeId}`, plus GSI attributes `employee_id` and `registered_at`
- `findRegistration`: GetCommand
- `listRegistrationsByActivity`: QueryCommand with `sk begins_with REG#`
- `listRegistrationsByEmployee`: QueryCommand on `gsi-employee` GSI
- `countActiveRegistrations`: QueryCommand with `sk begins_with REG#`, filter `status = REGISTERED`, count in memory
- `createCheckIn`: PutCommand with `pk: ACTIVITY#{id}`, `sk: CHECKIN#{employeeId}`
- All items include `entityType` and are stripped on read via `stripMetadata()`

**Step 2: Wire DynamoDB repo in lambda.ts when `USE_DYNAMODB_REPOSITORIES` is set**

Replace the `InMemoryVolunteerRepository` with conditional:

```typescript
const volunteerRepository = process.env.USE_DYNAMODB_REPOSITORIES === 'true'
  ? new DynamoDbVolunteerRepository(dynamoClient, process.env.VOLUNTEER_TABLE_NAME!)
  : new InMemoryVolunteerRepository();
```

**Step 3: Run tests**

Run: `pnpm --filter @one-team/api test`
Expected: PASS (in-memory tests still pass; DynamoDB tested via deployment)

**Step 4: Commit**

```bash
git add apps/api/src/repositories/dynamodb-volunteer-repository.ts apps/api/src/lambda.ts
git commit -m "feat: add DynamoDB volunteer repository implementation"
```

---

## Task 11: CDK — S3 + CloudFront for Mini App Hosting

**Files:**
- Modify: `infra/cdk/src/stacks/platform-stack.ts`

**Step 1: Add S3 bucket and CloudFront distribution**

```typescript
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';

// After existing resource definitions:
const miniAppBucket = new s3.Bucket(this, 'MiniAppBucket', {
  bucketName: `${prefix}-miniapp`,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  removalPolicy: RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
});

const miniAppDistribution = new cloudfront.Distribution(this, 'MiniAppDistribution', {
  defaultBehavior: {
    origin: origins.S3BucketOrigin.withOriginAccessControl(miniAppBucket),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
  },
  defaultRootObject: 'index.html',
  errorResponses: [
    {
      httpStatus: 403,
      responseHttpStatus: 200,
      responsePagePath: '/index.html',  // SPA fallback
    },
    {
      httpStatus: 404,
      responseHttpStatus: 200,
      responsePagePath: '/index.html',  // SPA fallback
    },
  ],
});

new CfnOutput(this, 'MiniAppDistributionDomain', {
  value: miniAppDistribution.distributionDomainName,
  description: 'Mini App CloudFront domain',
});

new CfnOutput(this, 'MiniAppBucketName', {
  value: miniAppBucket.bucketName,
  description: 'Mini App S3 bucket for deployment',
});
```

**Step 2: Add MINI_APP_BASE_URL to Lambda environment**

```typescript
MINI_APP_BASE_URL: `https://${miniAppDistribution.distributionDomainName}`,
```

**Step 3: Run typecheck**

Run: `pnpm --filter @one-team/infra-cdk exec tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add infra/cdk/src/stacks/platform-stack.ts
git commit -m "feat(infra): add S3 + CloudFront for Mini App static hosting"
```

---

## Task 12: Frontend — Add React Router to liff-web

**Files:**
- Modify: `apps/liff-web/package.json` (add react-router-dom)
- Modify: `apps/liff-web/src/main.tsx`

**Step 1: Install React Router**

Run: `pnpm --filter @one-team/liff-web add react-router-dom`

**Step 2: Replace manual path routing with React Router**

Refactor `main.tsx` from manual `window.location.pathname` checks to React Router:

```typescript
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { RegistrationForm } from './features/registration/registration-form.js';
import { DigitalIdCard } from './features/digital-id/digital-id-card.js';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
const liffId = import.meta.env.VITE_LIFF_ID ?? '';

function App() {
  const params = new URLSearchParams(window.location.search);
  const tenantId = params.get('tenantId') ?? '';
  const accessToken = params.get('accessToken') ?? '';

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/register"
          element={
            <RegistrationForm apiBaseUrl={apiBaseUrl} liffId={liffId} tenantId={tenantId} />
          }
        />
        <Route
          path="/digital-id"
          element={
            <DigitalIdCard
              apiBaseUrl={apiBaseUrl}
              tenantId={tenantId}
              accessToken={accessToken}
            />
          }
        />
        <Route path="/" element={<div>ONE TEAM</div>} />
      </Routes>
    </BrowserRouter>
  );
}
```

**Step 3: Move existing components into features/ directory**

```bash
mkdir -p apps/liff-web/src/features/registration
mkdir -p apps/liff-web/src/features/digital-id
# Move existing files (adjust paths based on current structure)
mv apps/liff-web/src/registration/* apps/liff-web/src/features/registration/
mv apps/liff-web/src/digital-id/* apps/liff-web/src/features/digital-id/
```

Update imports in `main.tsx` accordingly.

**Step 4: Verify build**

Run: `pnpm --filter @one-team/liff-web build`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/liff-web/
git commit -m "refactor: add React Router and reorganize into features/ directory"
```

---

## Task 13: Frontend — Volunteer Activity List Page

**Files:**
- Create: `apps/liff-web/src/features/volunteer/activity-list.tsx`
- Create: `apps/liff-web/src/features/volunteer/use-volunteer.ts`
- Modify: `apps/liff-web/src/main.tsx` (add route)

**Step 1: Create the volunteer API hook**

`use-volunteer.ts` — Single hook managing all volunteer API calls:

```typescript
import { useState, useEffect } from 'react';

export function useActivities(apiBaseUrl: string, accessToken: string) {
  const [activities, setActivities] = useState<VolunteerActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiBaseUrl}/v1/volunteer/activities?status=OPEN`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json())
      .then((data) => setActivities(data.activities))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiBaseUrl, accessToken]);

  return { activities, loading, error };
}
```

**Step 2: Create activity list page**

`activity-list.tsx` — Shows upcoming volunteer activities with "Register" buttons:

- Fetches from `GET /v1/volunteer/activities?status=OPEN`
- Renders cards with title, date, location, capacity
- Link to detail page: `/volunteer/{activityId}`
- "Create Activity" button linking to `/volunteer/create`

**Step 3: Add route in main.tsx**

```typescript
<Route path="/volunteer" element={<ActivityList apiBaseUrl={apiBaseUrl} accessToken={accessToken} />} />
```

**Step 4: Verify build**

Run: `pnpm --filter @one-team/liff-web build`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/liff-web/src/features/volunteer/ apps/liff-web/src/main.tsx
git commit -m "feat: add volunteer activity list page"
```

---

## Task 14: Frontend — Activity Detail + Registration Page

**Files:**
- Create: `apps/liff-web/src/features/volunteer/activity-detail.tsx`
- Modify: `apps/liff-web/src/main.tsx` (add route)

**Step 1: Create activity detail page**

Shows full activity info + registration status + action buttons:

- Fetches `GET /v1/volunteer/activities/:id`
- Shows: title, description, date/time, location, capacity, check-in mode, registration count
- "Register" button → `POST /v1/volunteer/activities/:id/register`
- "Cancel Registration" → `DELETE /v1/volunteer/activities/:id/register`
- If user is creator: show "Cancel Activity" button, show report link
- If activity is `self-scan`: show QR code display for organizer

**Step 2: Add route**

```typescript
<Route path="/volunteer/:activityId" element={<ActivityDetail apiBaseUrl={apiBaseUrl} accessToken={accessToken} />} />
```

**Step 3: Verify build, commit**

```bash
git commit -m "feat: add volunteer activity detail and registration page"
```

---

## Task 15: Frontend — Create Activity Page

**Files:**
- Create: `apps/liff-web/src/features/volunteer/create-activity.tsx`
- Modify: `apps/liff-web/src/main.tsx`

**Step 1: Create the form page**

Form fields:
- Title (required text)
- Description (textarea)
- Location (text)
- Date (date picker)
- Start Time / End Time (time inputs)
- Capacity (number, optional — leave empty for unlimited)
- Check-in Mode (radio: organizer-scan / self-scan, with descriptions)

Submit → `POST /v1/volunteer/activities` → redirect to activity detail page.

**Step 2: Add route**

```typescript
<Route path="/volunteer/create" element={<CreateActivity apiBaseUrl={apiBaseUrl} accessToken={accessToken} />} />
```

**Step 3: Verify build, commit**

```bash
git commit -m "feat: add create volunteer activity page"
```

---

## Task 16: Frontend — Check-in Page

**Files:**
- Create: `apps/liff-web/src/features/volunteer/check-in.tsx`
- Modify: `apps/liff-web/src/main.tsx`

**Step 1: Create check-in page**

Two modes based on activity's `checkInMode`:

**Organizer-scan mode** (`/volunteer/:activityId/scan`):
- Uses `liff.scanCodeV2()` to scan employee's Digital ID QR
- Sends scanned payload to `POST /v1/volunteer/activities/:id/scan-check-in`
- Shows success with employee ID

**Self-scan mode** (accessed by scanning activity QR):
- Employee opens Mini App via activity QR link or scans QR in-app
- Sends QR payload to `POST /v1/volunteer/activities/:id/check-in`
- Shows check-in confirmation

**Step 2: Add routes**

```typescript
<Route path="/volunteer/:activityId/scan" element={<CheckIn mode="organizer" ... />} />
<Route path="/volunteer/:activityId/check-in" element={<CheckIn mode="self" ... />} />
```

**Step 3: Verify build, commit**

```bash
git commit -m "feat: add volunteer check-in page with dual scan modes"
```

---

## Task 17: Integration Test + Full Check

**Files:**
- Modify or create: `apps/api/src/services/volunteer-service.integration.test.ts`

**Step 1: Write integration test using LambdaTestClient**

Test the full flow: create activity → register → check in → get report.

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeLambda } from '../testing/lambda-test-client.js';

test('integration: volunteer full flow', async () => {
  // This test requires a valid auth token — use the stub auth pattern
  // Step 1: Create activity
  // Step 2: Register
  // Step 3: Check in
  // Step 4: Get report
  // Step 5: Export CSV
});
```

**Step 2: Run full check**

Run: `pnpm check`
Expected: PASS (lint + typecheck + all tests)

**Step 3: Commit**

```bash
git commit -m "test: add volunteer service integration tests"
```

---

## Task Summary

| # | Task | Type | Estimated |
|---|------|------|-----------|
| 1 | CDK: volunteer DynamoDB table | Infra | 15 min |
| 2 | Domain types | Types | 10 min |
| 3 | Repository interface + InMemory | Data | 20 min |
| 4 | Service: activity CRUD + tests | Backend TDD | 30 min |
| 5 | Service: registration + tests | Backend TDD | 25 min |
| 6 | Service: check-in + tests | Backend TDD | 30 min |
| 7 | Service: report + CSV + tests | Backend TDD | 20 min |
| 8 | Lambda routes | Backend | 25 min |
| 9 | Flex Message: services menu | Backend | 20 min |
| 10 | DynamoDB repository | Data | 30 min |
| 11 | CDK: S3 + CloudFront | Infra | 15 min |
| 12 | Frontend: React Router | Frontend | 20 min |
| 13 | Frontend: activity list | Frontend | 25 min |
| 14 | Frontend: activity detail | Frontend | 30 min |
| 15 | Frontend: create activity | Frontend | 25 min |
| 16 | Frontend: check-in page | Frontend | 30 min |
| 17 | Integration test + full check | Test | 20 min |

**Dependencies:**
- Tasks 1-3: can run in parallel (infra, types, repo are independent)
- Tasks 4-7: sequential (each builds on previous service methods)
- Task 8: depends on 4-7 (needs all service methods)
- Task 9: independent of 4-8 (Flex Message change)
- Task 10: depends on 3 (implements repo interface)
- Task 11: independent (CDK only)
- Tasks 12-16: sequential (each page builds on router)
- Task 17: depends on all
