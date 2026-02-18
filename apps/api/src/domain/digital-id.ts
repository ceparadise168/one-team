export type DigitalIdReasonCode =
  | 'VALID'
  | 'MALFORMED'
  | 'SIGNATURE_INVALID'
  | 'EXPIRED'
  | 'NOT_ACTIVE'
  | 'BLACKLISTED';

export interface DigitalIdPayload {
  v: 1;
  tenantId: string;
  employeeId: string;
  lineUserId: string;
  iat: number;
  windowStart: number;
  exp: number;
}

export interface GeneratedDigitalId {
  payload: string;
  expiresAtEpochSeconds: number;
  refreshInSeconds: number;
}

export interface DigitalIdVerificationResult {
  valid: boolean;
  reasonCode: DigitalIdReasonCode;
  tenantId?: string;
  employeeId?: string;
  lineUserId?: string;
  expiresAtEpochSeconds?: number;
}
