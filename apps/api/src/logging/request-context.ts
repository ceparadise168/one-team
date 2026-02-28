import { APIGatewayProxyEvent } from 'aws-lambda';
import { JsonLogger, Logger } from './logger.js';

export function createRequestLogger(event: APIGatewayProxyEvent): Logger {
  const requestId = event.requestContext?.requestId ?? undefined;

  return new JsonLogger({ requestId });
}
