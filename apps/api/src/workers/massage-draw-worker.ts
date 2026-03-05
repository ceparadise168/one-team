import type { MassageBookingRepository } from '../repositories/massage-booking-repository.js';
import type { EmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
import type { MassageBookingService } from '../services/massage-booking-service.js';
import type { LinePlatformClient } from '../line/line-platform-client.js';

export interface MassageDrawWorkerDeps {
  massageRepo: MassageBookingRepository;
  massageService: MassageBookingService;
  lineClient: LinePlatformClient;
  employeeRepo: EmployeeBindingRepository;
}

export async function handleScheduledDraw(
  _event: unknown,
  deps: MassageDrawWorkerDeps
): Promise<void> {
  const now = new Date().toISOString();
  const sessions = await deps.massageRepo.listSessionsDueForDraw(now);
  console.log(`[massage-draw] now=${now}, found ${sessions.length} sessions due for draw`);

  for (const session of sessions) {
    try {
      const drawMode = session.drawMode ?? 'AUTO';

      console.log(`[massage-draw] processing session ${session.sessionId}, drawMode=${drawMode}`);
      if (drawMode === 'AUTO') {
        await deps.massageService.executeDraw(session.tenantId, session.sessionId);
        console.log(`[massage-draw] auto-draw completed for session ${session.sessionId}`);
      } else {
        // MANUAL: notify the admin who created this session
        const admin = await deps.employeeRepo.findByEmployeeId(session.tenantId, session.createdByEmployeeId);
        if (admin?.lineUserId) {
          await deps.lineClient.pushMessage({
            tenantId: session.tenantId,
            lineUserId: admin.lineUserId,
            messages: [{
              type: 'text',
              text: `⏰ 場次「${session.date} ${session.location}」已到抽籤時間，請前往管理介面執行抽籤。`,
            }],
          });
        }
      }
    } catch (err) {
      // Log but don't fail other sessions
      console.error(`Failed to process draw for session ${session.sessionId}:`, err);
    }
  }
}

// Lambda handler entry point
let depsPromise: Promise<MassageDrawWorkerDeps> | null = null;

async function initDeps(): Promise<MassageDrawWorkerDeps> {
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

  return { massageRepo, massageService, lineClient, employeeRepo };
}

export async function handler(event: unknown): Promise<void> {
  if (!depsPromise) depsPromise = initDeps();
  const deps = await depsPromise;
  await handleScheduledDraw(event, deps);
}
