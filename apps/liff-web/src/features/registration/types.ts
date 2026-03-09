export interface RegistrationFormData {
  employeeId: string;
  nickname?: string;
}

export interface SelfRegisterRequest {
  tenantId: string;
  employeeId: string;
  lineIdToken: string;
  nickname?: string;
}

export interface SelfRegisterResponse {
  employeeId: string;
  accessStatus: string;
}
