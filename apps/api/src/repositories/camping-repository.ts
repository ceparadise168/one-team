import type {
  CampingTripRecord,
  TripParticipantRecord,
  CampSiteRecord,
  ExpenseRecord,
  SettlementRecord,
  AuditLogRecord,
} from '../domain/camping.js';

export interface CampingRepository {
  createTrip(trip: CampingTripRecord): Promise<void>;
  findTripById(tripId: string): Promise<CampingTripRecord | null>;
  updateTrip(trip: CampingTripRecord): Promise<void>;
  listTripsByParticipantEmployeeId(tenantId: string, employeeId: string): Promise<CampingTripRecord[]>;

  createParticipant(participant: TripParticipantRecord): Promise<void>;
  updateParticipant(participant: TripParticipantRecord): Promise<void>;
  deleteParticipant(tripId: string, participantId: string): Promise<void>;
  listParticipants(tripId: string): Promise<TripParticipantRecord[]>;
  findParticipantByEmployeeId(tripId: string, employeeId: string): Promise<TripParticipantRecord | null>;

  createCampSite(site: CampSiteRecord): Promise<void>;
  updateCampSite(site: CampSiteRecord): Promise<void>;
  deleteCampSite(tripId: string, campSiteId: string): Promise<void>;
  listCampSites(tripId: string): Promise<CampSiteRecord[]>;

  createExpense(expense: ExpenseRecord): Promise<void>;
  updateExpense(expense: ExpenseRecord): Promise<void>;
  deleteExpense(tripId: string, expenseId: string): Promise<void>;
  listExpenses(tripId: string): Promise<ExpenseRecord[]>;

  saveSettlement(settlement: SettlementRecord): Promise<void>;
  findSettlement(tripId: string): Promise<SettlementRecord | null>;

  // Audit logs
  createAuditLog(log: AuditLogRecord): Promise<void>;
  listAuditLogs(tripId: string): Promise<AuditLogRecord[]>;
  // Settlement deletion (for unsettle)
  deleteSettlement(tripId: string): Promise<void>;
}

export class InMemoryCampingRepository implements CampingRepository {
  private trips: CampingTripRecord[] = [];
  private participants: TripParticipantRecord[] = [];
  private campSites: CampSiteRecord[] = [];
  private expenses: ExpenseRecord[] = [];
  private settlements: SettlementRecord[] = [];
  private auditLogs: AuditLogRecord[] = [];

  async createTrip(trip: CampingTripRecord): Promise<void> {
    this.trips.push({ ...trip });
  }

  async findTripById(tripId: string): Promise<CampingTripRecord | null> {
    return this.trips.find(t => t.tripId === tripId) ?? null;
  }

  async updateTrip(trip: CampingTripRecord): Promise<void> {
    const i = this.trips.findIndex(t => t.tripId === trip.tripId);
    if (i >= 0) this.trips[i] = { ...trip };
  }

  async listTripsByParticipantEmployeeId(tenantId: string, employeeId: string): Promise<CampingTripRecord[]> {
    const participantTripIds = this.participants
      .filter(p => p.employeeId === employeeId)
      .map(p => p.tripId);
    return this.trips.filter(t => t.tenantId === tenantId && participantTripIds.includes(t.tripId));
  }

  async createParticipant(participant: TripParticipantRecord): Promise<void> {
    this.participants.push({ ...participant });
  }

  async updateParticipant(participant: TripParticipantRecord): Promise<void> {
    const i = this.participants.findIndex(
      p => p.tripId === participant.tripId && p.participantId === participant.participantId,
    );
    if (i >= 0) this.participants[i] = { ...participant };
  }

  async deleteParticipant(tripId: string, participantId: string): Promise<void> {
    this.participants = this.participants.filter(
      p => !(p.tripId === tripId && p.participantId === participantId),
    );
  }

  async listParticipants(tripId: string): Promise<TripParticipantRecord[]> {
    return this.participants.filter(p => p.tripId === tripId).map(p => ({ ...p }));
  }

  async findParticipantByEmployeeId(tripId: string, employeeId: string): Promise<TripParticipantRecord | null> {
    return this.participants.find(p => p.tripId === tripId && p.employeeId === employeeId) ?? null;
  }

  async createCampSite(site: CampSiteRecord): Promise<void> {
    this.campSites.push({ ...site });
  }

  async updateCampSite(site: CampSiteRecord): Promise<void> {
    const i = this.campSites.findIndex(s => s.tripId === site.tripId && s.campSiteId === site.campSiteId);
    if (i >= 0) this.campSites[i] = { ...site };
  }

  async deleteCampSite(tripId: string, campSiteId: string): Promise<void> {
    this.campSites = this.campSites.filter(s => !(s.tripId === tripId && s.campSiteId === campSiteId));
  }

  async listCampSites(tripId: string): Promise<CampSiteRecord[]> {
    return this.campSites.filter(s => s.tripId === tripId).map(s => ({ ...s }));
  }

  async createExpense(expense: ExpenseRecord): Promise<void> {
    this.expenses.push({ ...expense });
  }

  async updateExpense(expense: ExpenseRecord): Promise<void> {
    const i = this.expenses.findIndex(e => e.tripId === expense.tripId && e.expenseId === expense.expenseId);
    if (i >= 0) this.expenses[i] = { ...expense };
  }

  async deleteExpense(tripId: string, expenseId: string): Promise<void> {
    this.expenses = this.expenses.filter(e => !(e.tripId === tripId && e.expenseId === expenseId));
  }

  async listExpenses(tripId: string): Promise<ExpenseRecord[]> {
    return this.expenses.filter(e => e.tripId === tripId).map(e => ({ ...e }));
  }

  async saveSettlement(settlement: SettlementRecord): Promise<void> {
    const i = this.settlements.findIndex(s => s.tripId === settlement.tripId);
    if (i >= 0) this.settlements[i] = { ...settlement };
    else this.settlements.push({ ...settlement });
  }

  async findSettlement(tripId: string): Promise<SettlementRecord | null> {
    return this.settlements.find(s => s.tripId === tripId) ?? null;
  }

  async createAuditLog(log: AuditLogRecord): Promise<void> {
    this.auditLogs.push(log);
  }

  async listAuditLogs(tripId: string): Promise<AuditLogRecord[]> {
    return this.auditLogs
      .filter(l => l.tripId === tripId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async deleteSettlement(tripId: string): Promise<void> {
    this.settlements = this.settlements.filter(s => s.tripId !== tripId);
  }
}
