import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError
} from './errors.js';
import { requireEmployeePrincipal } from './http/auth-middleware.js';
import { jsonResponse, preflightResponse, CorsConfig } from './http/response.js';
import { RealLineAuthClient, StubLineAuthClient } from './line/line-auth-client.js';
import { RealLinePlatformClient, StubLinePlatformClient } from './line/line-platform-client.js';
import { AccessControlRepository, InMemoryAccessControlRepository } from './repositories/access-control-repository.js';
import {
  BatchInviteJobRepository,
  BindingSessionRepository,
  EmployeeBindingRepository,
  EmployeeEnrollmentRepository,
  InMemoryBatchInviteJobRepository,
  InMemoryBindingSessionRepository,
  InMemoryEmployeeBindingRepository,
  InMemoryEmployeeEnrollmentRepository,
  InMemoryInvitationRepository,
  InvitationRepository
} from './repositories/invitation-binding-repository.js';
import {
  RefreshSessionRepository,
  InMemoryRefreshSessionRepository,
  InMemoryRevokedJtiRepository,
  RevokedJtiRepository
} from './repositories/auth-repository.js';
import {
  AuditEventRepository,
  InMemoryAuditEventRepository,
  InMemoryOffboardingJobRepository,
  OffboardingJobRepository
} from './repositories/offboarding-repository.js';
import { InMemoryTenantRepository, TenantRepository } from './repositories/tenant-repository.js';
import {
  createDynamoDbDocumentClient,
  DynamoDbAccessControlRepository,
  DynamoDbAdminAccountRepository,
  DynamoDbAuditEventRepository,
  DynamoDbBatchInviteJobRepository,
  DynamoDbBindingSessionRepository,
  DynamoDbEmployeeBindingRepository,
  DynamoDbEmployeeEnrollmentRepository,
  DynamoDbInvitationRepository,
  DynamoDbOffboardingJobRepository,
  DynamoDbRefreshSessionRepository,
  DynamoDbRevokedJtiRepository,
  DynamoDbTenantRepository
} from './repositories/dynamodb-repositories.js';
import {
  AwsSecretsManagerLineCredentialStore,
  InMemoryLineCredentialStore
} from './security/line-credential-store.js';
import { AuthSessionService } from './services/auth-session-service.js';
import { DigitalIdService } from './services/digital-id-service.js';
import { InvitationBindingService } from './services/invitation-binding-service.js';
import { OffboardingService } from './services/offboarding-service.js';
import { EmployeeAccessGovernanceService } from './services/employee-access-governance-service.js';
import { TenantOnboardingService } from './services/tenant-onboarding-service.js';
import { AdminAuthService } from './services/admin-auth-service.js';
import { SelfRegistrationService } from './services/self-registration-service.js';
import { WebhookEventService } from './services/webhook-event-service.js';
import { InMemoryAdminAccountRepository } from './repositories/admin-repository.js';
import { InMemoryWebhookEventRepository } from './repositories/webhook-event-repository.js';
import { InMemoryAsyncJobDispatcher, SqsAsyncJobDispatcher, AsyncJobDispatcher } from './workers/async-job-dispatcher.js';
import { createRequestLogger } from './logging/request-context.js';
import { Logger } from './logging/logger.js';
import { InMemoryMetricEmitter, CloudWatchEmfMetricEmitter, MetricEmitter } from './observability/metrics.js';
import {
  InMemoryRateLimiter,
  NoOpRateLimiter,
  RateLimiter,
  classifyRoute,
  buildRateLimitKey,
  RATE_LIMITS
} from './http/rate-limiter.js';
import { LineWebhookEvent } from './domain/webhook.js';

const createTenantSchema = z.object({
  tenantName: z.string().min(1),
  adminEmail: z.string().email()
});

const connectLineSchema = z
  .object({
    channelId: z.string().min(1),
    channelSecret: z.string().min(1),
    loginChannelId: z.string().min(1).optional(),
    loginChannelSecret: z.string().min(1).optional()
  })
  .superRefine((value, ctx) => {
    const hasLoginChannelId = value.loginChannelId !== undefined;
    const hasLoginChannelSecret = value.loginChannelSecret !== undefined;

    if (hasLoginChannelId !== hasLoginChannelSecret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['loginChannelSecret'],
        message: 'loginChannelId and loginChannelSecret must be provided together'
      });
    }
  });

const verifyWebhookSchema = z.object({
  verificationToken: z.string().min(1)
});

const lineWebhookPayloadSchema = z
  .object({
    events: z.array(z.unknown()).default([])
  })
  .passthrough();

const lineLoginSchema = z.object({
  tenantId: z.string().min(1),
  lineIdToken: z.string().min(1)
});

const refreshSessionSchema = z.object({
  refreshToken: z.string().min(1)
});

const accessDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reviewerId: z.string().min(1).optional(),
  permissions: z
    .object({
      canInvite: z.boolean().optional(),
      canRemove: z.boolean().optional()
    })
    .optional()
});

const scannerVerifySchema = z.object({
  payload: z.string().min(1)
});

const offboardEmployeeSchema = z.object({
  actorId: z.string().min(1).optional()
});

const retryOffboardingJobSchema = z.object({
  actorId: z.string().min(1).optional()
});

const selfRegisterSchema = z.object({
  tenantId: z.string().min(1),
  lineIdToken: z.string().min(1),
  employeeId: z.string().min(1).max(50)
});

const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const adminSetupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const useDynamoDbRepositories = process.env.USE_DYNAMODB_REPOSITORIES === 'true';
const dynamoDbRegion = process.env.AWS_REGION ?? 'ap-northeast-1';
const dynamoDbClient = useDynamoDbRepositories
  ? createDynamoDbDocumentClient(dynamoDbRegion)
  : undefined;

const tenantRepository: TenantRepository = useDynamoDbRepositories
  ? new DynamoDbTenantRepository(dynamoDbClient!, requireEnv('TENANTS_TABLE_NAME'))
  : new InMemoryTenantRepository();

const invitationRepository: InvitationRepository = useDynamoDbRepositories
  ? new DynamoDbInvitationRepository(dynamoDbClient!, requireEnv('INVITATIONS_TABLE_NAME'))
  : new InMemoryInvitationRepository();

const batchInviteJobRepository: BatchInviteJobRepository = useDynamoDbRepositories
  ? new DynamoDbBatchInviteJobRepository(dynamoDbClient!, requireEnv('INVITATIONS_TABLE_NAME'))
  : new InMemoryBatchInviteJobRepository();

const bindingSessionRepository: BindingSessionRepository = useDynamoDbRepositories
  ? new DynamoDbBindingSessionRepository(dynamoDbClient!, requireEnv('INVITATIONS_TABLE_NAME'))
  : new InMemoryBindingSessionRepository();

const employeeEnrollmentRepository: EmployeeEnrollmentRepository = useDynamoDbRepositories
  ? new DynamoDbEmployeeEnrollmentRepository(dynamoDbClient!, requireEnv('EMPLOYEES_TABLE_NAME'))
  : new InMemoryEmployeeEnrollmentRepository();

const employeeBindingRepository: EmployeeBindingRepository = useDynamoDbRepositories
  ? new DynamoDbEmployeeBindingRepository(dynamoDbClient!, requireEnv('EMPLOYEES_TABLE_NAME'))
  : new InMemoryEmployeeBindingRepository();

const accessControlRepository: AccessControlRepository = useDynamoDbRepositories
  ? new DynamoDbAccessControlRepository(dynamoDbClient!, requireEnv('EMPLOYEES_TABLE_NAME'))
  : new InMemoryAccessControlRepository();

const refreshSessionRepository: RefreshSessionRepository = useDynamoDbRepositories
  ? new DynamoDbRefreshSessionRepository(dynamoDbClient!, requireEnv('SESSIONS_TABLE_NAME'))
  : new InMemoryRefreshSessionRepository();

const revokedJtiRepository: RevokedJtiRepository = useDynamoDbRepositories
  ? new DynamoDbRevokedJtiRepository(dynamoDbClient!, requireEnv('TOKEN_REVOCATIONS_TABLE_NAME'))
  : new InMemoryRevokedJtiRepository();

const offboardingJobRepository: OffboardingJobRepository = useDynamoDbRepositories
  ? new DynamoDbOffboardingJobRepository(dynamoDbClient!, requireEnv('AUDIT_EVENTS_TABLE_NAME'))
  : new InMemoryOffboardingJobRepository();

const auditEventRepository: AuditEventRepository = useDynamoDbRepositories
  ? new DynamoDbAuditEventRepository(dynamoDbClient!, requireEnv('AUDIT_EVENTS_TABLE_NAME'))
  : new InMemoryAuditEventRepository();

const adminAccountRepository = useDynamoDbRepositories
  ? new DynamoDbAdminAccountRepository(dynamoDbClient!, requireEnv('TENANTS_TABLE_NAME'))
  : new InMemoryAdminAccountRepository();

const webhookEventRepository = new InMemoryWebhookEventRepository();

const lineCredentialStore = process.env.USE_AWS_SECRETS_MANAGER === 'true'
  ? new AwsSecretsManagerLineCredentialStore({
      region: process.env.AWS_REGION ?? 'ap-northeast-1',
      secretPrefix: process.env.LINE_SECRET_PREFIX ?? 'one-team/dev/tenants'
    })
  : new InMemoryLineCredentialStore();

const lineIntegrationMode = (process.env.LINE_INTEGRATION_MODE ?? 'stub').toLowerCase();
const useRealLineClients = lineIntegrationMode === 'real';

const linePlatformClient = useRealLineClients
  ? new RealLinePlatformClient(lineCredentialStore, {
      apiBaseUrl: process.env.LINE_API_BASE_URL ?? 'https://api.line.me',
      webhookVerifyTokenPrefix: process.env.LINE_WEBHOOK_VERIFY_TOKEN_PREFIX ?? 'line-verify-'
    })
  : new StubLinePlatformClient();

const lineAuthClient = useRealLineClients
  ? new RealLineAuthClient(lineCredentialStore, {
      apiBaseUrl: process.env.LINE_API_BASE_URL ?? 'https://api.line.me'
    })
  : new StubLineAuthClient();

// Async job dispatcher
const asyncJobDispatcher: AsyncJobDispatcher = (() => {
  const invitationsQueueUrl = process.env.INVITATIONS_QUEUE_URL;
  const offboardingQueueUrl = process.env.OFFBOARDING_QUEUE_URL;

  if (invitationsQueueUrl && offboardingQueueUrl) {
    try {
      // Dynamic import at module level would require top-level await;
      // use SqsAsyncJobDispatcher with lazy client construction
      return new SqsAsyncJobDispatcher({
        invitationsQueueUrl,
        offboardingQueueUrl,
        sqsClient: createSqsClient(),
        SendMessageCommand: getSendMessageCommand()
      });
    } catch {
      return new InMemoryAsyncJobDispatcher();
    }
  }

  return new InMemoryAsyncJobDispatcher();
})();

function createSqsClient(): { send(command: unknown): Promise<unknown> } {
  // Lazy load SQS client to avoid import errors in test environments
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SQSClient } = require('@aws-sdk/client-sqs') as typeof import('@aws-sdk/client-sqs');
    return new SQSClient({ region: process.env.AWS_REGION ?? 'ap-northeast-1' });
  } catch {
    return { send: async () => ({}) };
  }
}

function getSendMessageCommand(): new (input: { QueueUrl: string; MessageBody: string }) => unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SendMessageCommand } = require('@aws-sdk/client-sqs') as typeof import('@aws-sdk/client-sqs');
    return SendMessageCommand;
  } catch {
    return class MockSendMessageCommand {
      constructor(public input: unknown) {}
    } as unknown as new (input: { QueueUrl: string; MessageBody: string }) => unknown;
  }
}

// CORS config
const corsConfig: CorsConfig = {
  allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean)
};

// Rate limiter
const rateLimiter: RateLimiter = process.env.RATE_LIMITER_DISABLED === 'true'
  ? new NoOpRateLimiter()
  : new InMemoryRateLimiter();

// Metrics
const metricEmitter: MetricEmitter = process.env.USE_DYNAMODB_REPOSITORIES === 'true'
  ? new CloudWatchEmfMetricEmitter()
  : new InMemoryMetricEmitter();

const onboardingService = new TenantOnboardingService(
  tenantRepository,
  lineCredentialStore,
  linePlatformClient,
  {
    publicApiBaseUrl: process.env.PUBLIC_API_BASE_URL ?? 'https://api.example.com',
    now: () => new Date()
  }
);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const invitationBindingService = new InvitationBindingService(
  tenantRepository,
  invitationRepository,
  batchInviteJobRepository,
  bindingSessionRepository,
  employeeEnrollmentRepository,
  employeeBindingRepository,
  lineAuthClient,
  linePlatformClient,
  {
    inviteBaseUrl: process.env.INVITE_BASE_URL ?? 'https://app.example.com/invite',
    sessionTtlMinutes: 10,
    maxBindingAttempts: 5,
    lockoutMinutes: 15,
    now: () => new Date(),
    asyncJobDispatcher
  }
);

const digitalIdService = new DigitalIdService(employeeBindingRepository, accessControlRepository, {
  signingSecret: process.env.DIGITAL_ID_SIGNING_SECRET ?? 'digital-id-dev-secret',
  windowSeconds: 30,
  toleranceWindows: 1,
  now: () => new Date()
});

const authSessionService = new AuthSessionService(
  refreshSessionRepository,
  revokedJtiRepository,
  employeeBindingRepository,
  {
    issuer: 'one-team-api',
    accessTokenTtlSeconds: 10 * 60,
    refreshSessionTtlSeconds: 7 * 24 * 60 * 60,
    accessTokenSecret: process.env.ACCESS_TOKEN_SECRET ?? 'dev-secret-change-me',
    now: () => new Date()
  }
);

const offboardingService = new OffboardingService(
  employeeBindingRepository,
  accessControlRepository,
  offboardingJobRepository,
  auditEventRepository,
  authSessionService,
  linePlatformClient,
  {
    now: () => new Date(),
    maxAttempts: 5,
    backoffBaseSeconds: 30,
    asyncJobDispatcher
  }
);

const employeeAccessGovernanceService = new EmployeeAccessGovernanceService(
  employeeBindingRepository,
  tenantRepository,
  linePlatformClient,
  {
    now: () => new Date()
  }
);

const adminAuthService = new AdminAuthService(adminAccountRepository, {
  issuer: 'one-team-api',
  tokenSecret: process.env.ADMIN_TOKEN_SECRET ?? 'admin-dev-secret-change-me',
  tokenTtlSeconds: 8 * 60 * 60,
  now: () => new Date()
});

const selfRegistrationService = new SelfRegistrationService(
  lineAuthClient,
  employeeBindingRepository,
  tenantRepository,
  linePlatformClient,
  { now: () => new Date() }
);

const webhookEventService = new WebhookEventService(
  webhookEventRepository,
  employeeBindingRepository,
  auditEventRepository,
  linePlatformClient,
  employeeAccessGovernanceService,
  tenantRepository,
  selfRegistrationService,
  { now: () => new Date() }
);

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const logger = createRequestLogger(event);
  const origin = getHeaderCaseInsensitive(event.headers, 'origin') ?? '';
  const responseOptions = { origin, corsConfig };

  try {
    const method = event.httpMethod.toUpperCase();
    const path = event.path;

    logger.info('request.start', { method, path });

    // OPTIONS preflight
    if (method === 'OPTIONS') {
      return preflightResponse(origin, corsConfig);
    }

    // Rate limiting
    const rateLimitResult = checkRateLimit(event, path);
    if (!rateLimitResult.allowed) {
      metricEmitter.emit('OneTeam', 'RateLimitExceeded', 1, 'Count');
      return jsonResponse(429, {
        error: 'Too many requests',
        retryAfterSeconds: rateLimitResult.retryAfterSeconds
      }, responseOptions);
    }

    if (method === 'GET' && path === '/health') {
      return jsonResponse(200, { ok: true }, responseOptions);
    }

    const lineWebhookMatch = path.match(/^\/v1\/line\/webhook\/([^/]+)$/);
    if (method === 'POST' && lineWebhookMatch) {
      return handleLineWebhookEvent(event, lineWebhookMatch[1], logger, responseOptions);
    }

    // Admin auth routes
    if (method === 'POST' && path === '/v1/admin/auth/login') {
      const payload = adminLoginSchema.parse(parseBody(event));
      const result = await adminAuthService.login(payload);
      return jsonResponse(200, result, responseOptions);
    }

    if (method === 'POST' && path === '/v1/admin/auth/setup') {
      const payload = adminSetupSchema.parse(parseBody(event));
      const result = await adminAuthService.setup(payload);
      return jsonResponse(201, result, responseOptions);
    }

    if (method === 'POST' && path === '/v1/admin/tenants') {
      assertAdminAuthorized(event);
      const payload = createTenantSchema.parse(parseBody(event));
      const snapshot = await onboardingService.createTenant(payload);
      return jsonResponse(201, snapshot, responseOptions);
    }

    const connectMatch = path.match(/^\/v1\/admin\/tenants\/([^/]+)\/line\/connect$/);
    if (method === 'POST' && connectMatch) {
      assertAdminAuthorized(event);
      const payload = connectLineSchema.parse(parseBody(event));
      const snapshot = await onboardingService.connectLineCredentials({
        tenantId: connectMatch[1],
        channelId: payload.channelId,
        channelSecret: payload.channelSecret,
        loginChannelId: payload.loginChannelId,
        loginChannelSecret: payload.loginChannelSecret
      });
      return jsonResponse(200, snapshot, responseOptions);
    }

    const provisionMatch = path.match(/^\/v1\/admin\/tenants\/([^/]+)\/line\/provision$/);
    if (method === 'POST' && provisionMatch) {
      assertAdminAuthorized(event);
      const result = await onboardingService.provisionLineResources(provisionMatch[1]);
      return jsonResponse(200, result, responseOptions);
    }

    const verifyMatch = path.match(/^\/v1\/admin\/tenants\/([^/]+)\/line\/webhook\/verify$/);
    if (method === 'POST' && verifyMatch) {
      assertAdminAuthorized(event);
      const payload = verifyWebhookSchema.parse(parseBody(event));
      const snapshot = await onboardingService.verifyWebhook({
        tenantId: verifyMatch[1],
        verificationToken: payload.verificationToken
      });
      return jsonResponse(200, snapshot, responseOptions);
    }

    const statusMatch = path.match(/^\/v1\/admin\/tenants\/([^/]+)\/line\/setup-status$/);
    if (method === 'GET' && statusMatch) {
      assertAdminAuthorized(event);
      const snapshot = await onboardingService.getSetupStatus(statusMatch[1]);
      return jsonResponse(200, snapshot, responseOptions);
    }

    const employeesListMatch = path.match(/^\/v1\/admin\/tenants\/([^/]+)\/employees$/);
    if (method === 'GET' && employeesListMatch) {
      assertAdminAuthorized(event);
      const tenantId = employeesListMatch[1];
      const statusFilter = event.queryStringParameters?.status;
      const limitParam = event.queryStringParameters?.limit;
      const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 200) : 50;

      const bindings = await employeeBindingRepository.listByTenant(tenantId);
      const activeBindings = bindings.filter(b => b.employmentStatus === 'ACTIVE');
      const filtered = statusFilter
        ? activeBindings.filter(b => (b.accessStatus ?? 'PENDING') === statusFilter)
        : activeBindings;

      const employees = filtered.slice(0, limit).map(b => ({
        employeeId: b.employeeId,
        nickname: b.nickname,
        accessStatus: b.accessStatus ?? 'PENDING',
        boundAt: b.boundAt,
        accessRequestedAt: b.accessRequestedAt,
        accessReviewedAt: b.accessReviewedAt,
        accessReviewedBy: b.accessReviewedBy
      }));

      return jsonResponse(200, { employees }, responseOptions);
    }

    if (method === 'POST' && path === '/v1/public/self-register') {
      const payload = selfRegisterSchema.parse(parseBody(event));
      const result = await selfRegistrationService.register(payload);
      return jsonResponse(200, result, responseOptions);
    }

    if (method === 'POST' && path === '/v1/public/auth/line-login') {
      const payload = lineLoginSchema.parse(parseBody(event));
      const { lineUserId } = await lineAuthClient.validateIdToken({
        tenantId: payload.tenantId,
        idToken: payload.lineIdToken
      });
      const binding = await employeeBindingRepository.findActiveByLineUserId(
        payload.tenantId,
        lineUserId
      );
      if (!binding) {
        throw new NotFoundError('No active employee binding found for this LINE account');
      }
      const tokens = await authSessionService.issueEmployeeSession({
        tenantId: binding.tenantId,
        lineUserId: binding.lineUserId,
        employeeId: binding.employeeId
      });
      return jsonResponse(200, tokens, responseOptions);
    }

    if (method === 'POST' && path === '/v1/public/auth/refresh') {
      const payload = refreshSessionSchema.parse(parseBody(event));
      const tokens = await authSessionService.refreshEmployeeSession(payload);
      return jsonResponse(200, tokens, responseOptions);
    }

    const meMatch = path.match(/^\/v1\/liff\/tenants\/([^/]+)\/me\/profile$/);
    if (method === 'GET' && meMatch) {
      const principal = await requireEmployeePrincipal({
        event,
        authSessionService,
        requiredTenantId: meMatch[1]
      });

      return jsonResponse(200, {
        tenantId: principal.tenantId,
        employeeId: principal.employeeId,
        lineUserId: principal.lineUserId,
        sessionId: principal.sessionId,
        tokenExpiresAtEpochSeconds: principal.exp
      }, responseOptions);
    }

    const accessRequestMatch = path.match(/^\/v1\/liff\/tenants\/([^/]+)\/me\/access-request$/);
    if (accessRequestMatch) {
      const principal = await requireEmployeePrincipal({
        event,
        authSessionService,
        requiredTenantId: accessRequestMatch[1]
      });

      if (method === 'GET') {
        const profile = await employeeAccessGovernanceService.getAccessProfileByLineUser({
          tenantId: principal.tenantId,
          lineUserId: principal.lineUserId
        });
        return jsonResponse(200, profile, responseOptions);
      }

      if (method === 'POST') {
        const profile = await employeeAccessGovernanceService.submitAccessRequestByLineUser({
          tenantId: principal.tenantId,
          lineUserId: principal.lineUserId
        });
        return jsonResponse(200, profile, responseOptions);
      }
    }

    const accessDecisionMatch = path.match(
      /^\/v1\/admin\/tenants\/([^/]+)\/employees\/([^/]+)\/access-decision$/
    );
    if (method === 'POST' && accessDecisionMatch) {
      assertAdminAuthorized(event);
      const payload = accessDecisionSchema.parse(parseBody(event));

      const profile = await employeeAccessGovernanceService.decideAccess({
        tenantId: accessDecisionMatch[1],
        employeeId: accessDecisionMatch[2],
        reviewerId: payload.reviewerId ?? getAdminActorId(event),
        decision: payload.decision,
        permissions: payload.permissions
      });

      return jsonResponse(200, profile, responseOptions);
    }

    const offboardMatch = path.match(
      /^\/v1\/admin\/tenants\/([^/]+)\/employees\/([^/]+)\/offboard$/
    );
    if (method === 'POST' && offboardMatch) {
      const payload = offboardEmployeeSchema.parse(parseBody(event));
      const actor = await authorizeAdminOrPermission({
        event,
        tenantId: offboardMatch[1],
        permission: 'canRemove'
      });
      const result = await offboardingService.offboardEmployee({
        tenantId: offboardMatch[1],
        employeeId: offboardMatch[2],
        actorId: actor.actorType === 'ADMIN' ? payload.actorId ?? actor.actorId : actor.actorId
      });
      metricEmitter.emit('OneTeam', 'OffboardingStarted', 1, 'Count');
      return jsonResponse(200, result, responseOptions);
    }

    const retryOffboardingMatch = path.match(/^\/v1\/admin\/offboarding\/jobs\/([^/]+)\/retry$/);
    if (method === 'POST' && retryOffboardingMatch) {
      assertAdminAuthorized(event);
      const payload = retryOffboardingJobSchema.parse(parseBody(event));
      const job = await offboardingService.processOffboardingJob({
        jobId: retryOffboardingMatch[1],
        actorId: payload.actorId ?? 'hr-admin'
      });
      return jsonResponse(200, job, responseOptions);
    }

    const auditMatch = path.match(/^\/v1\/admin\/tenants\/([^/]+)\/audit-events$/);
    if (method === 'GET' && auditMatch) {
      assertAdminAuthorized(event);
      const events = await offboardingService.listAuditEvents(auditMatch[1]);
      return jsonResponse(200, { events }, responseOptions);
    }

    const digitalIdMatch = path.match(/^\/v1\/liff\/tenants\/([^/]+)\/me\/digital-id$/);
    if (method === 'GET' && digitalIdMatch) {
      const principal = await requireEmployeePrincipal({
        event,
        authSessionService,
        requiredTenantId: digitalIdMatch[1]
      });

      const generated = await digitalIdService.generateDynamicPayload({
        tenantId: principal.tenantId,
        employeeId: principal.employeeId,
        lineUserId: principal.lineUserId
      });

      metricEmitter.emit('OneTeam', 'DigitalIdVerified', 1, 'Count');
      return jsonResponse(200, generated, responseOptions);
    }

    if (method === 'POST' && path === '/v1/scanner/verify') {
      if (!isScannerAuthorized(event)) {
        return jsonResponse(401, { error: 'Invalid scanner API key' }, responseOptions);
      }

      const payload = scannerVerifySchema.parse(parseBody(event));
      const result = await digitalIdService.verifyDynamicPayload(payload.payload);
      return jsonResponse(200, result, responseOptions);
    }

    return jsonResponse(404, { error: `Route not found: ${method} ${path}` }, responseOptions);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonResponse(400, {
        error: 'Validation failed',
        details: error.issues
      }, responseOptions);
    }

    if (error instanceof UnauthorizedError) {
      return jsonResponse(401, { error: error.message }, responseOptions);
    }

    if (error instanceof ForbiddenError) {
      return jsonResponse(403, { error: error.message }, responseOptions);
    }

    if (error instanceof ConflictError) {
      return jsonResponse(409, { error: error.message }, responseOptions);
    }

    if (error instanceof ValidationError) {
      return jsonResponse(400, { error: error.message }, responseOptions);
    }

    if (error instanceof NotFoundError) {
      return jsonResponse(404, { error: error.message }, responseOptions);
    }

    const latencyMs = Date.now() - startTime;
    logger.error('request.error', error, { latencyMs });
    metricEmitter.emit('OneTeam', 'ErrorCount', 1, 'Count');

    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Internal server error'
    }, responseOptions);
  } finally {
    const latencyMs = Date.now() - startTime;
    metricEmitter.emit('OneTeam', 'RequestCount', 1, 'Count');
    metricEmitter.emit('OneTeam', 'RequestLatency', latencyMs, 'Milliseconds');
  }
}

function checkRateLimit(
  event: APIGatewayProxyEvent,
  path: string
): { allowed: boolean; retryAfterSeconds?: number } {
  const category = classifyRoute(path);
  const limits = RATE_LIMITS[category];

  let identifier: string;
  if (category === 'webhook') {
    const tenantMatch = path.match(/^\/v1\/line\/webhook\/([^/]+)$/);
    identifier = tenantMatch?.[1] ?? 'unknown';
  } else if (category === 'admin') {
    // Use tenant from path or source IP
    const tenantMatch = path.match(/\/tenants\/([^/]+)/);
    identifier = tenantMatch?.[1] ?? event.requestContext?.identity?.sourceIp ?? 'unknown';
  } else {
    identifier = event.requestContext?.identity?.sourceIp ?? 'unknown';
  }

  const key = buildRateLimitKey(category, identifier);
  return rateLimiter.check(key, limits.limit, limits.windowSeconds);
}

function parseBody(event: APIGatewayProxyEvent): unknown {
  const raw = readRawBody(event);

  if (!raw) {
    return {};
  }

  return parseRawJson(raw);
}

function parseRawJson(raw: string): unknown {
  if (!raw) {
    return {};
  }

  const trimmed = raw.trim();

  if (!trimmed) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
}

function readRawBody(event: APIGatewayProxyEvent): string {
  if (!event.body) {
    return '';
  }

  return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
}

async function handleLineWebhookEvent(
  event: APIGatewayProxyEvent,
  tenantId: string,
  logger: Logger,
  responseOptions: { origin: string; corsConfig: CorsConfig }
): Promise<APIGatewayProxyResult> {
  const signature = getHeaderCaseInsensitive(event.headers, 'x-line-signature');

  if (!signature) {
    return jsonResponse(401, { error: 'Missing LINE webhook signature header' }, responseOptions);
  }

  const credentials = await lineCredentialStore.getTenantCredentials(tenantId);

  if (!credentials) {
    return jsonResponse(401, { error: 'Invalid LINE webhook signature' }, responseOptions);
  }

  const rawBody = readRawBody(event);
  const normalizedSignature = signature.trim();

  if (!isLineWebhookSignatureValid(rawBody, normalizedSignature, credentials.channelSecret)) {
    return jsonResponse(401, { error: 'Invalid LINE webhook signature' }, responseOptions);
  }

  const payload = lineWebhookPayloadSchema.parse(parseRawJson(rawBody));

  // Process webhook events with idempotency
  const webhookEvents = payload.events as LineWebhookEvent[];
  const result = await webhookEventService.processEvents(tenantId, webhookEvents);

  logger.info('webhook.processed', { tenantId, ...result });

  return jsonResponse(200, {
    ok: true,
    receivedEvents: payload.events.length,
    processed: result.processed,
    skipped: result.skipped
  }, responseOptions);
}

function isLineWebhookSignatureValid(rawBody: string, signature: string, channelSecret: string): boolean {
  const expected = createHmac('sha256', channelSecret).update(rawBody, 'utf8').digest('base64');
  const expectedBytes = Buffer.from(expected, 'utf8');
  const actualBytes = Buffer.from(signature, 'utf8');

  if (expectedBytes.length !== actualBytes.length) {
    return false;
  }

  return timingSafeEqual(expectedBytes, actualBytes);
}

function getHeaderCaseInsensitive(
  headers: APIGatewayProxyEvent['headers'],
  headerName: string
): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === headerName.toLowerCase()) {
      return value;
    }
  }

  return undefined;
}

function assertAdminAuthorized(event: APIGatewayProxyEvent): void {
  if (!isAdminAuthorized(event)) {
    throw new UnauthorizedError('Missing admin authorization token');
  }
}

function isAdminAuthorized(event: APIGatewayProxyEvent): boolean {
  const bearerToken = extractBearerTokenOptional(event);
  if (!bearerToken) {
    return false;
  }

  // Try admin JWT first
  try {
    adminAuthService.validateAdminToken(bearerToken);
    return true;
  } catch {
    // Fall through to static token check
  }

  // Fall back to static token (deprecated)
  const expectedAdminToken = process.env.ADMIN_TOKEN ?? 'admin-token';
  return bearerToken === expectedAdminToken;
}

function getAdminActorId(event: APIGatewayProxyEvent): string {
  const bearerToken = extractBearerTokenOptional(event);
  if (!bearerToken) return 'admin-token';

  try {
    const principal = adminAuthService.validateAdminToken(bearerToken);
    return principal.adminId;
  } catch {
    return 'admin-token';
  }
}

async function authorizeAdminOrPermission(input: {
  event: APIGatewayProxyEvent;
  tenantId: string;
  permission: 'canInvite' | 'canRemove';
}): Promise<{
  actorType: 'ADMIN' | 'EMPLOYEE';
  actorId: string;
}> {
  if (isAdminAuthorized(input.event)) {
    return {
      actorType: 'ADMIN',
      actorId: getAdminActorId(input.event)
    };
  }

  const principal = await requireEmployeePrincipal({
    event: input.event,
    authSessionService,
    requiredTenantId: input.tenantId
  });

  await employeeAccessGovernanceService.requireEmployeePermission({
    tenantId: principal.tenantId,
    lineUserId: principal.lineUserId,
    permission: input.permission
  });

  return {
    actorType: 'EMPLOYEE',
    actorId: principal.employeeId
  };
}

function extractBearerTokenOptional(event: APIGatewayProxyEvent): string | null {
  const authorization = event.headers.authorization ?? event.headers.Authorization;

  if (!authorization || !authorization.startsWith('Bearer ')) {
    return null;
  }

  const token = authorization.slice('Bearer '.length).trim();
  return token || null;
}

function isScannerAuthorized(event: APIGatewayProxyEvent): boolean {
  const scannerKey =
    event.headers['x-scanner-api-key'] ??
    event.headers['X-Scanner-Api-Key'] ??
    event.headers['x-api-key'] ??
    event.headers['X-Api-Key'];

  if (!scannerKey) {
    return false;
  }

  const expected = process.env.SCANNER_API_KEY ?? 'dev-scanner-key';
  return scannerKey === expected;
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.trim();
}
