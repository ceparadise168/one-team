import type { MassageBookingRepository } from '../repositories/massage-booking-repository.js';
import type { MassageBookingService } from '../services/massage-booking-service.js';

export interface MassageScheduleWorkerDeps {
  massageRepo: MassageBookingRepository;
  massageService: MassageBookingService;
}

export async function handleScheduleGeneration(
  _event: unknown,
  deps: MassageScheduleWorkerDeps
): Promise<void> {
  console.log('[massage-schedule] starting session generation');

  const schedules = await deps.massageRepo.listAllActiveSchedules();
  const tenantIds = [...new Set(schedules.map(s => s.tenantId))];

  console.log(`[massage-schedule] found ${tenantIds.length} tenants with active schedules`);

  const now = new Date();
  let totalCreated = 0;

  for (const tenantId of tenantIds) {
    for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + dayOffset);
      const dateStr = targetDate.toISOString().slice(0, 10);

      try {
        const count = await deps.massageService.generateScheduledSessions(tenantId, dateStr);
        if (count > 0) {
          console.log(`[massage-schedule] created ${count} sessions for ${tenantId} on ${dateStr}`);
          totalCreated += count;
        }
      } catch (err) {
        console.error(`[massage-schedule] error for ${tenantId} on ${dateStr}:`, err);
      }
    }
  }

  console.log(`[massage-schedule] done, created ${totalCreated} sessions total`);
}

// Lambda handler entry point
let depsPromise: Promise<MassageScheduleWorkerDeps> | null = null;

async function initDeps(): Promise<MassageScheduleWorkerDeps> {
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');
  const { DynamoDbMassageBookingRepository } = await import('../repositories/dynamodb-massage-booking-repository.js');
  const { DynamoDbEmployeeBindingRepository } = await import('../repositories/dynamodb-repositories.js');
  const { MassageBookingService } = await import('../services/massage-booking-service.js');
  const { RealLinePlatformClient } = await import('../line/line-platform-client.js');
  const { AwsSecretsManagerLineCredentialStore } = await import('../security/line-credential-store.js');

  const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({
    region: process.env.AWS_REGION ?? 'ap-northeast-1',
  }));

  const massageRepo = new DynamoDbMassageBookingRepository(
    dynamoClient,
    process.env.MASSAGE_TABLE_NAME!
  );

  const employeeRepo = new DynamoDbEmployeeBindingRepository(
    dynamoClient,
    process.env.EMPLOYEES_TABLE_NAME!
  );

  const lineCredentialStore = new AwsSecretsManagerLineCredentialStore({
    region: process.env.AWS_REGION ?? 'ap-northeast-1',
    secretPrefix: process.env.LINE_SECRET_PREFIX ?? 'one-team/dev/tenants',
  });

  const lineClient = new RealLinePlatformClient(lineCredentialStore, {
    apiBaseUrl: 'https://api.line.me',
  });

  const massageService = new MassageBookingService(
    massageRepo,
    employeeRepo,
    lineClient,
    { now: () => new Date() }
  );

  return { massageRepo, massageService };
}

export async function handler(event: unknown): Promise<void> {
  if (!depsPromise) depsPromise = initDeps();
  const deps = await depsPromise;
  await handleScheduleGeneration(event, deps);
}
