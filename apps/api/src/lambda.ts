import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError
} from './errors.js';
import { requireEmployeePrincipal } from './http/auth-middleware.js';
import { jsonResponse } from './http/response.js';
import { StubLineAuthClient } from './line/line-auth-client.js';
import { StubLinePlatformClient } from './line/line-platform-client.js';
import { InMemoryAccessControlRepository } from './repositories/access-control-repository.js';
import {
  InMemoryBatchInviteJobRepository,
  InMemoryBindingSessionRepository,
  InMemoryEmployeeBindingRepository,
  InMemoryEmployeeEnrollmentRepository,
  InMemoryInvitationRepository
} from './repositories/invitation-binding-repository.js';
import {
  InMemoryRefreshSessionRepository,
  InMemoryRevokedJtiRepository
} from './repositories/auth-repository.js';
import { InMemoryTenantRepository } from './repositories/tenant-repository.js';
import {
  AwsSecretsManagerLineCredentialStore,
  InMemoryLineCredentialStore
} from './security/line-credential-store.js';
import { AuthSessionService } from './services/auth-session-service.js';
import { DigitalIdService } from './services/digital-id-service.js';
import { InvitationBindingService } from './services/invitation-binding-service.js';
import { TenantOnboardingService } from './services/tenant-onboarding-service.js';

const createTenantSchema = z.object({
  tenantName: z.string().min(1),
  adminEmail: z.string().email()
});

const connectLineSchema = z.object({
  channelId: z.string().min(1),
  channelSecret: z.string().min(1)
});

const verifyWebhookSchema = z.object({
  verificationToken: z.string().min(1)
});

const createInvitationSchema = z.object({
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

const scannerVerifySchema = z.object({
  payload: z.string().min(1)
});

const tenantRepository = new InMemoryTenantRepository();

const lineCredentialStore = process.env.USE_AWS_SECRETS_MANAGER === 'true'
  ? new AwsSecretsManagerLineCredentialStore({
      region: process.env.AWS_REGION ?? 'ap-northeast-1',
      secretPrefix: process.env.LINE_SECRET_PREFIX ?? 'one-team/dev/tenants'
    })
  : new InMemoryLineCredentialStore();

const onboardingService = new TenantOnboardingService(
  tenantRepository,
  lineCredentialStore,
  new StubLinePlatformClient(),
  {
    publicApiBaseUrl: process.env.PUBLIC_API_BASE_URL ?? 'https://api.example.com',
    now: () => new Date()
  }
);

const employeeBindingRepository = new InMemoryEmployeeBindingRepository();
const accessControlRepository = new InMemoryAccessControlRepository();

const invitationBindingService = new InvitationBindingService(
  tenantRepository,
  new InMemoryInvitationRepository(),
  new InMemoryBatchInviteJobRepository(),
  new InMemoryBindingSessionRepository(),
  new InMemoryEmployeeEnrollmentRepository(),
  employeeBindingRepository,
  new StubLineAuthClient(),
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
  new InMemoryRefreshSessionRepository(),
  new InMemoryRevokedJtiRepository(),
  employeeBindingRepository,
  {
    issuer: 'one-team-api',
    accessTokenTtlSeconds: 10 * 60,
    refreshSessionTtlSeconds: 7 * 24 * 60 * 60,
    accessTokenSecret: process.env.ACCESS_TOKEN_SECRET ?? 'dev-secret-change-me',
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

    if (path.startsWith('/v1/admin/') && !isAdminAuthorized(event)) {
      return jsonResponse(401, { error: 'Missing admin authorization token' });
    }

    if (method === 'POST' && path === '/v1/admin/tenants') {
      const payload = createTenantSchema.parse(parseBody(event));
      const snapshot = await onboardingService.createTenant(payload);
      return jsonResponse(201, snapshot);
    }

    const connectMatch = path.match(/^\/v1\/admin\/tenants\/([^/]+)\/line\/connect$/);
    if (method === 'POST' && connectMatch) {
      const payload = connectLineSchema.parse(parseBody(event));
      const snapshot = await onboardingService.connectLineCredentials({
        tenantId: connectMatch[1],
        channelId: payload.channelId,
        channelSecret: payload.channelSecret
      });
      return jsonResponse(200, snapshot);
    }

    const provisionMatch = path.match(/^\/v1\/admin\/tenants\/([^/]+)\/line\/provision$/);
    if (method === 'POST' && provisionMatch) {
      const result = await onboardingService.provisionLineResources(provisionMatch[1]);
      return jsonResponse(200, result);
    }

    const verifyMatch = path.match(/^\/v1\/admin\/tenants\/([^/]+)\/line\/webhook\/verify$/);
    if (method === 'POST' && verifyMatch) {
      const payload = verifyWebhookSchema.parse(parseBody(event));
      const snapshot = await onboardingService.verifyWebhook({
        tenantId: verifyMatch[1],
        verificationToken: payload.verificationToken
      });
      return jsonResponse(200, snapshot);
    }

    const statusMatch = path.match(/^\/v1\/admin\/tenants\/([^/]+)\/line\/setup-status$/);
    if (method === 'GET' && statusMatch) {
      const snapshot = await onboardingService.getSetupStatus(statusMatch[1]);
      return jsonResponse(200, snapshot);
    }

    const createInviteMatch = path.match(/^\/v1\/admin\/tenants\/([^/]+)\/invites$/);
    if (method === 'POST' && createInviteMatch) {
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
      const payload = batchInviteSchema.parse(parseBody(event));
      const job = await invitationBindingService.createBatchInvites({
        tenantId: batchInviteMatch[1],
        ttlMinutes: payload.ttlMinutes,
        recipients: payload.recipients
      });
      return jsonResponse(202, job);
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
  if (!event.body) {
    return {};
  }

  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;

  try {
    return JSON.parse(raw);
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
}

function isAdminAuthorized(event: APIGatewayProxyEvent): boolean {
  const authorization = event.headers.authorization ?? event.headers.Authorization;

  if (!authorization) {
    return false;
  }

  return authorization.startsWith('Bearer ') && authorization.trim().length > 'Bearer '.length;
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
