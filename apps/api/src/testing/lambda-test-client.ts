import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../lambda.js';

export async function invokeLambda(input: {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}): Promise<{ statusCode: number; body: unknown }> {
  const [pathPart, queryPart] = input.path.split('?', 2);
  const queryStringParameters: Record<string, string> | null = queryPart
    ? Object.fromEntries(new URLSearchParams(queryPart).entries())
    : null;

  const event = {
    resource: pathPart,
    path: pathPart,
    httpMethod: input.method,
    headers: input.headers ?? {},
    multiValueHeaders: {},
    queryStringParameters,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
    body: input.body ? JSON.stringify(input.body) : null,
    isBase64Encoded: false
  } as APIGatewayProxyEvent;

  const response = await handler(event);

  return {
    statusCode: response.statusCode,
    body: response.body
      ? (() => {
          try {
            return JSON.parse(response.body!);
          } catch {
            return response.body;
          }
        })()
      : null
  };
}
