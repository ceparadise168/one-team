export interface AdminTokenPayload {
  iss: string;
  typ: 'admin';
  adminId: string;
  email: string;
  iat: number;
  exp: number;
}

export interface AdminPrincipal {
  adminId: string;
  email: string;
}

export interface AdminAccountRecord {
  adminId: string;
  email: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
  updatedAt: string;
}
