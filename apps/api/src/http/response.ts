import { APIGatewayProxyResult } from 'aws-lambda';

export interface CorsConfig {
  allowedOrigins: string[];
}

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'cache-control': 'no-store'
};

export function jsonResponse(
  statusCode: number,
  body: unknown,
  options?: { origin?: string; corsConfig?: CorsConfig }
): APIGatewayProxyResult {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    ...SECURITY_HEADERS
  };

  if (options?.origin && options?.corsConfig) {
    const corsHeaders = buildCorsHeaders(options.origin, options.corsConfig);
    Object.assign(headers, corsHeaders);
  }

  return {
    statusCode,
    headers,
    body: JSON.stringify(body)
  };
}

export function preflightResponse(origin: string, corsConfig: CorsConfig): APIGatewayProxyResult {
  const headers: Record<string, string> = {
    ...SECURITY_HEADERS
  };

  const corsHeaders = buildCorsHeaders(origin, corsConfig);
  Object.assign(headers, corsHeaders);

  if (corsHeaders['access-control-allow-origin']) {
    headers['access-control-allow-methods'] = 'GET,POST,PUT,DELETE,OPTIONS';
    headers['access-control-allow-headers'] = 'content-type,authorization,x-scanner-api-key';
    headers['access-control-max-age'] = '86400';
  }

  return {
    statusCode: 204,
    headers,
    body: ''
  };
}

function buildCorsHeaders(origin: string, corsConfig: CorsConfig): Record<string, string> {
  if (!origin) {
    return {};
  }

  const isAllowed = corsConfig.allowedOrigins.some(
    (allowed) => allowed === '*' || allowed.toLowerCase() === origin.toLowerCase()
  );

  if (!isAllowed) {
    return {};
  }

  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    vary: 'Origin'
  };
}
