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
import { jsonResponse } from './http/response.js';
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

const createInvitationSchema = z.object({
  ttlMinutes: z.number().int().min(1).max(1440).default(60),
  usageLimit: z.number().int().min(1).max(50).default(1)
});

const createSelfInviteSchema = z.object({
  employeeId: z.string().min(1),
  email: z.string().email().optional(),
  ttlMinutes: z.number().int().min(1).max(1440).default(60),
  usageLimit: z.number().int().min(1).max(50).default(1)
});

const batchInviteSchema = z.object({
  ttlMinutes: z.number().int().min(1).max(1440).default(60),
  recipients: z
    .array(
      z.object({
        email: z.string().email(),
        employeeId: z.string().min(1)
      })
    )
    .min(1)
    .max(500)
});

const dispatchBatchInviteJobSchema = z.object({});

const bindStartSchema = z.object({
  lineIdToken: z.string().min(1),
  invitationToken: z.string().min(1)
});

const bindCompleteSchema = z.object({
  bindSessionToken: z.string().min(1),
  employeeId: z.string().min(1),
  bindingCode: z.string().min(1)
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

const onboardingService = new TenantOnboardingService(
  tenantRepository,
  lineCredentialStore,
  linePlatformClient,
  {
    publicApiBaseUrl: process.env.PUBLIC_API_BASE_URL ?? 'https://api.example.com',
    now: () => new Date()
  }
);

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
    now: () => new Date()
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
    backoffBaseSeconds: 30
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

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const method = event.httpMethod.toUpperCase();
    const path = event.path;

    if (method === 'GET' && path === '/health') {
      return jsonResponse(200, { ok: true });
    }

    const lineWebhookMatch = path.match(/^\/v1\/line\/webhook\/([^/]+)$/);
    if (method === 'POST' && lineWebhookMatch) {
      return handleLineWebhookEvent(event, lineWebhookMatch[1]);
    }

    if (method === 'POST' && path === '/v1/admin/tenants') {
      assertAdminAuthorized(event);
      const payload = createTenantSchema.parse(parseBody(event));
      const snapshot = await onboardingService.createTenant(payload);
      return jsonResponse(201, snapshot);
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
      return jsonResponse(200, snapshot);
    }

    const provisionMatch = path.match(/^\/v1\/admin\/tenants\/([^/]+)\/line\/provision$/);
    if (method === 'POST' && provisionMatch) {
      assertAdminAuthorized(event);
      const result = await onboardingService.provisionLineResources(provisionMatch[1]);
      return jsonResponse(200, result);
    }

    const verifyMatch = path.match(/^\/v1\/admin\/tenants\/([^/]+)\/line\/webhook\/verify$/);
    if (method === 'POST' && verifyMatch) {
      assertAdminAuthorized(event);
      const payload = verifyWebhookSchema.parse(parseBody(event));
      const snapshot = await onboardingService.verifyWebhook({
        tenantId: verifyMatch[1],
        verificationToken: payload.verificationToken
      });
      return jsonResponse(200, snapshot);
    }

    const statusMatch = path.match(/^\/v1\/admin\/tenants\/([^/]+)\/line\/setup-status$/);
    if (method === 'GET' && statusMatch) {
      assertAdminAuthorized(event);
      const snapshot = await onboardingService.getSetupStatus(statusMatch[1]);
      return jsonResponse(200, snapshot);
    }

    const createInviteMatch = path.match(/^\/v1\/admin\/tenants\/([^/]+)\/invites$/);
    if (method === 'POST' && createInviteMatch) {
      await authorizeAdminOrPermission({
        event,
        tenantId: createInviteMatch[1],
        permission: 'canInvite'
      });
      const payload = createInvitationSchema.parse(parseBody(event));
      const invitation = await invitationBindingService.createInvitation({
        tenantId: createInviteMatch[1],
        ttlMinutes: payload.ttlMinutes,
        usageLimit: payload.usageLimit
      });
      return jsonResponse(201, invitation);
    }

    const batchInviteMatch = path.match(/^\/v1\/admin\/tenants\/([^/]+)\/invites\/batch-email$/);
    if (method === 'POST' && batchInviteMatch) {
      await authorizeAdminOrPermission({
        event,
        tenantId: batchInviteMatch[1],
        permission: 'canInvite'
      });
      const payload = batchInviteSchema.parse(parseBody(event));
      const job = await invitationBindingService.createBatchInvites({
        tenantId: batchInviteMatch[1],
        ttlMinutes: payload.ttlMinutes,
        recipients: payload.recipients
      });
      return jsonResponse(202, job);
    }

    const dispatchBatchInviteMatch = path.match(
      /^\/v1\/admin\/tenants\/([^/]+)\/invites\/batch-jobs\/([^/]+)\/dispatch$/
    );
    if (method === 'POST' && dispatchBatchInviteMatch) {
      assertAdminAuthorized(event);
      dispatchBatchInviteJobSchema.parse(parseBody(event));
      const job = await invitationBindingService.dispatchBatchInviteJob({
        tenantId: dispatchBatchInviteMatch[1],
        jobId: dispatchBatchInviteMatch[2]
      });
      return jsonResponse(200, job);
    }

    if (method === 'POST' && path === '/v1/public/bind/start') {
      const payload = bindStartSchema.parse(parseBody(event));
      const result = await invitationBindingService.startBinding(payload);
      return jsonResponse(200, result);
    }

    if (method === 'POST' && path === '/v1/public/bind/complete') {
      const payload = bindCompleteSchema.parse(parseBody(event));
      const bindingResult = await invitationBindingService.completeBinding(payload);

      const tokens = await authSessionService.issueEmployeeSession({
        tenantId: bindingResult.tenantId,
        lineUserId: bindingResult.lineUserId,
        employeeId: bindingResult.employeeId
      });

      return jsonResponse(200, {
        ...bindingResult,
        auth: tokens
      });
    }

    if (method === 'POST' && path === '/v1/public/auth/refresh') {
      const payload = refreshSessionSchema.parse(parseBody(event));
      const tokens = await authSessionService.refreshEmployeeSession(payload);
      return jsonResponse(200, tokens);
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
      });
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
        return jsonResponse(200, profile);
      }

      if (method === 'POST') {
        const profile = await employeeAccessGovernanceService.submitAccessRequestByLineUser({
          tenantId: principal.tenantId,
          lineUserId: principal.lineUserId
        });
        return jsonResponse(200, profile);
      }
    }

    const createSelfInviteMatch = path.match(/^\/v1\/liff\/tenants\/([^/]+)\/me\/invites$/);
    if (method === 'POST' && createSelfInviteMatch) {
      const principal = await requireEmployeePrincipal({
        event,
        authSessionService,
        requiredTenantId: createSelfInviteMatch[1]
      });
      await employeeAccessGovernanceService.requireEmployeePermission({
        tenantId: principal.tenantId,
        lineUserId: principal.lineUserId,
        permission: 'canInvite'
      });

      const payload = createSelfInviteSchema.parse(parseBody(event));
      const invitation = await invitationBindingService.createInviteSharePayload({
        tenantId: principal.tenantId,
        employeeId: payload.employeeId,
        email: payload.email,
        ttlMinutes: payload.ttlMinutes,
        usageLimit: payload.usageLimit
      });

      return jsonResponse(201, invitation);
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
        reviewerId: payload.reviewerId ?? 'admin-token',
        decision: payload.decision,
        permissions: payload.permissions
      });

      return jsonResponse(200, profile);
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
      return jsonResponse(200, result);
    }

    const retryOffboardingMatch = path.match(/^\/v1\/admin\/offboarding\/jobs\/([^/]+)\/retry$/);
    if (method === 'POST' && retryOffboardingMatch) {
      assertAdminAuthorized(event);
      const payload = retryOffboardingJobSchema.parse(parseBody(event));
      const job = await offboardingService.processOffboardingJob({
        jobId: retryOffboardingMatch[1],
        actorId: payload.actorId ?? 'hr-admin'
      });
      return jsonResponse(200, job);
    }

    const auditMatch = path.match(/^\/v1\/admin\/tenants\/([^/]+)\/audit-events$/);
    if (method === 'GET' && auditMatch) {
      assertAdminAuthorized(event);
      const events = await offboardingService.listAuditEvents(auditMatch[1]);
      return jsonResponse(200, { events });
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

      return jsonResponse(200, generated);
    }

    if (method === 'POST' && path === '/v1/scanner/verify') {
      if (!isScannerAuthorized(event)) {
        return jsonResponse(401, { error: 'Invalid scanner API key' });
      }

      const payload = scannerVerifySchema.parse(parseBody(event));
      const result = await digitalIdService.verifyDynamicPayload(payload.payload);
      return jsonResponse(200, result);
    }

    return jsonResponse(404, { error: `Route not found: ${method} ${path}` });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonResponse(400, {
        error: 'Validation failed',
        details: error.issues
      });
    }

    if (error instanceof UnauthorizedError) {
      return jsonResponse(401, { error: error.message });
    }

    if (error instanceof ForbiddenError) {
      return jsonResponse(403, { error: error.message });
    }

    if (error instanceof ConflictError) {
      return jsonResponse(409, { error: error.message });
    }

    if (error instanceof ValidationError) {
      return jsonResponse(400, { error: error.message });
    }

    if (error instanceof NotFoundError) {
      return jsonResponse(404, { error: error.message });
    }

    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
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
  tenantId: string
): Promise<APIGatewayProxyResult> {
  const signature = getHeaderCaseInsensitive(event.headers, 'x-line-signature');

  if (!signature) {
    return jsonResponse(401, { error: 'Missing LINE webhook signature header' });
  }

  const credentials = await lineCredentialStore.getTenantCredentials(tenantId);

  if (!credentials) {
    return jsonResponse(401, { error: 'Invalid LINE webhook signature' });
  }

  const rawBody = readRawBody(event);
  const normalizedSignature = signature.trim();

  if (!isLineWebhookSignatureValid(rawBody, normalizedSignature, credentials.channelSecret)) {
    return jsonResponse(401, { error: 'Invalid LINE webhook signature' });
  }

  const payload = lineWebhookPayloadSchema.parse(parseRawJson(rawBody));

  return jsonResponse(200, {
    ok: true,
    receivedEvents: payload.events.length
  });
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

  const expectedAdminToken = process.env.ADMIN_TOKEN ?? 'admin-token';
  return bearerToken === expectedAdminToken;
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
      actorId: 'admin-token'
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
