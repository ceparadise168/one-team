import { APIGatewayProxyEvent } from 'aws-lambda';
import { AuthPrincipal } from '../domain/auth.js';
import { UnauthorizedError } from '../errors.js';
import { AuthSessionService } from '../services/auth-session-service.js';

export async function requireEmployeePrincipal(input: {
  event: APIGatewayProxyEvent;
  authSessionService: AuthSessionService;
  requiredTenantId?: string;
}): Promise<AuthPrincipal> {
  const accessToken = extractBearerToken(input.event);

  return input.authSessionService.validateAccessToken(accessToken, input.requiredTenantId);
}

export function extractBearerToken(event: APIGatewayProxyEvent): string {
  const authorization = event.headers.authorization ?? event.headers.Authorization;

  if (!authorization) {
    throw new UnauthorizedError('Missing bearer access token');
  }

  if (!authorization.startsWith('Bearer ')) {
    throw new UnauthorizedError('Authorization header must use Bearer token');
  }

  const token = authorization.slice('Bearer '.length).trim();

  if (!token) {
    throw new UnauthorizedError('Bearer access token is empty');
  }

  return token;
}
