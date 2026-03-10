export type CampingTripStatus = 'OPEN' | 'SETTLED';
export type SplitWeight = 1 | 0.5 | 0;
export type ExpenseSplitType = 'ALL' | 'CUSTOM';

export interface CampingTripRecord {
  tenantId: string;
  tripId: string;
  title: string;
  startDate: string;       // YYYY-MM-DD
  endDate: string;         // YYYY-MM-DD
  creatorEmployeeId: string;
  status: CampingTripStatus;
  createdAt: string;
}

export interface TripParticipantRecord {
  tripId: string;
  participantId: string;
  name: string;
  employeeId: string | null;
  lineUserId: string | null;
  splitWeight: SplitWeight;
  householdId: string | null;
  isHouseholdHead: boolean;
  settleAsHousehold: boolean;
}

export interface CampSiteRecord {
  tripId: string;
  campSiteId: string;
  name: string;
  cost: number;
  paidByParticipantId: string;
  memberParticipantIds: string[];
}

export interface ExpenseRecord {
  tripId: string;
  expenseId: string;
  description: string;
  amount: number;
  paidByParticipantId: string;
  splitType: ExpenseSplitType;
  splitAmong: string[] | null;  // participantIds, required when CUSTOM
  createdAt: string;
  campSiteId?: string;
}

export interface TransferInstruction {
  fromParticipantId: string;
  toParticipantId: string;
  amount: number;
}

export interface ParticipantSummary {
  participantId: string;
  name: string;
  totalOwed: number;
  totalPaid: number;
  netAmount: number;         // positive = owes, negative = owed
  breakdown: string;         // formula text
}

export interface SettlementRecord {
  tripId: string;
  transfers: TransferInstruction[];
  participantSummaries: ParticipantSummary[];
  settledAt: string;
}

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE';
export type AuditEntityType = 'TRIP' | 'PARTICIPANT' | 'CAMPSITE' | 'EXPENSE' | 'SETTLEMENT';

export interface AuditLogRecord {
  tripId: string;
  logId: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  entityName: string;
  actorEmployeeId: string;
  actorName: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  createdAt: string;
}
