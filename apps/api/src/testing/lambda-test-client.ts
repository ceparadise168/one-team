import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../lambda.js';

export async function invokeLambda(input: {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}): Promise<{ statusCode: number; body: unknown }> {
  const event = {
    resource: input.path,
    path: input.path,
    httpMethod: input.method,
    headers: input.headers ?? {},
    multiValueHeaders: {},
    queryStringParameters: null,
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
    body: response.body ? JSON.parse(response.body) : null
  };
}
