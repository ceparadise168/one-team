export interface Employee {
  employeeId: string;
  nickname?: string;
  accessStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'OFFBOARDED';
  boundAt: string;
}
