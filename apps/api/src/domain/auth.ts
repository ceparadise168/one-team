export interface RefreshSessionRecord {
  sessionId: string;
  tenantId: string;
  lineUserId: string;
  employeeId: string;
  refreshTokenHash: string;
  createdAt: string;
  expiresAt: string;
  status: 'ACTIVE' | 'REVOKED';
  updatedAt: string;
}

export interface AccessTokenPayload {
  iss: string;
  typ: 'access';
  tenantId: string;
  lineUserId: string;
  employeeId: string;
  sessionId: string;
  jti: string;
  iat: number;
  exp: number;
}

export interface AuthPrincipal {
  tenantId: string;
  lineUserId: string;
  employeeId: string;
  sessionId: string;
  jti: string;
  exp: number;
}
