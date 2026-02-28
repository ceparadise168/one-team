export interface RegistrationFormData {
  employeeId: string;
  nickname: string;
}

export interface SelfRegisterRequest {
  tenantId: string;
  employeeId: string;
  nickname: string;
  lineIdToken: string;
}

export interface SelfRegisterResponse {
  employeeId: string;
  accessStatus: string;
}
