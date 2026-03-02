export interface RegistrationFormData {
  employeeId: string;
}

export interface SelfRegisterRequest {
  tenantId: string;
  employeeId: string;
  lineIdToken: string;
}

export interface SelfRegisterResponse {
  employeeId: string;
  accessStatus: string;
}
