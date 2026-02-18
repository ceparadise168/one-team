import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { StubLinePlatformClient } from './line/line-platform-client.js';
import { InMemoryTenantRepository } from './repositories/tenant-repository.js';
import {
  AwsSecretsManagerLineCredentialStore,
  InMemoryLineCredentialStore
} from './security/line-credential-store.js';
import {
  NotFoundError,
  TenantOnboardingService,
  ValidationError
} from './services/tenant-onboarding-service.js';
import { jsonResponse } from './http/response.js';

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

    return jsonResponse(404, { error: `Route not found: ${method} ${path}` });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonResponse(400, {
        error: 'Validation failed',
        details: error.issues
      });
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

  return JSON.parse(raw);
}

function isAdminAuthorized(event: APIGatewayProxyEvent): boolean {
  const authorization = event.headers.authorization ?? event.headers.Authorization;

  if (!authorization) {
    return false;
  }

  return authorization.startsWith('Bearer ') && authorization.trim().length > 'Bearer '.length;
}
