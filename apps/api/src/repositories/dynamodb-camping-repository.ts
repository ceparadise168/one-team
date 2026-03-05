import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import type {
  CampingTripRecord,
  TripParticipantRecord,
  CampSiteRecord,
  ExpenseRecord,
  SettlementRecord,
} from '../domain/camping.js';
import type { CampingRepository } from './camping-repository.js';

function stripMetadata<T>(item: Record<string, unknown> | undefined): T | null {
  if (!item) return null;
  const rest = Object.fromEntries(
    Object.entries(item).filter(
      ([key]) => !['pk', 'sk', 'entityType', 'gsi_employee', 'gsi_date'].includes(key),
    ),
  );
  return rest as T;
}

export class DynamoDbCampingRepository implements CampingRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  // --- Trips ---
  async createTrip(trip: CampingTripRecord): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: `CAMPING_TRIP#${trip.tripId}`,
        sk: 'RECORD',
        entityType: 'CAMPING_TRIP',
        ...trip,
      },
    }));
  }

  async findTripById(tripId: string): Promise<CampingTripRecord | null> {
    const result = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: `CAMPING_TRIP#${tripId}`, sk: 'RECORD' },
    }));
    return stripMetadata<CampingTripRecord>(result.Item as Record<string, unknown> | undefined);
  }

  async updateTrip(trip: CampingTripRecord): Promise<void> {
    await this.createTrip(trip);
  }

  async listTripsByParticipantEmployeeId(tenantId: string, employeeId: string): Promise<CampingTripRecord[]> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      IndexName: 'gsi-line-user',
      KeyConditionExpression: 'gsi_employee = :empId',
      FilterExpression: 'entityType = :type',
      ExpressionAttributeValues: {
        ':empId': employeeId,
        ':type': 'CAMPING_PARTICIPANT',
      },
    }));
    const tripIds = (result.Items ?? []).map(item => (item as Record<string, unknown>).tripId as string);
    const uniqueTripIds = [...new Set(tripIds)];

    const trips: CampingTripRecord[] = [];
    for (const tripId of uniqueTripIds) {
      const trip = await this.findTripById(tripId);
      if (trip && trip.tenantId === tenantId) trips.push(trip);
    }
    return trips;
  }

  // --- Participants ---
  async createParticipant(participant: TripParticipantRecord): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: `CAMPING_TRIP#${participant.tripId}`,
        sk: `PARTICIPANT#${participant.participantId}`,
        entityType: 'CAMPING_PARTICIPANT',
        gsi_employee: participant.employeeId ?? undefined,
        ...participant,
      },
    }));
  }

  async updateParticipant(participant: TripParticipantRecord): Promise<void> {
    await this.createParticipant(participant);
  }

  async deleteParticipant(tripId: string, participantId: string): Promise<void> {
    await this.client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { pk: `CAMPING_TRIP#${tripId}`, sk: `PARTICIPANT#${participantId}` },
    }));
  }

  async listParticipants(tripId: string): Promise<TripParticipantRecord[]> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `CAMPING_TRIP#${tripId}`,
        ':prefix': 'PARTICIPANT#',
      },
    }));
    return (result.Items ?? []).map(item => stripMetadata<TripParticipantRecord>(item as Record<string, unknown>)!);
  }

  async findParticipantByEmployeeId(tripId: string, employeeId: string): Promise<TripParticipantRecord | null> {
    const participants = await this.listParticipants(tripId);
    return participants.find(p => p.employeeId === employeeId) ?? null;
  }

  // --- CampSites ---
  async createCampSite(site: CampSiteRecord): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: `CAMPING_TRIP#${site.tripId}`,
        sk: `CAMP_SITE#${site.campSiteId}`,
        entityType: 'CAMPING_CAMP_SITE',
        ...site,
      },
    }));
  }

  async updateCampSite(site: CampSiteRecord): Promise<void> {
    await this.createCampSite(site);
  }

  async deleteCampSite(tripId: string, campSiteId: string): Promise<void> {
    await this.client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { pk: `CAMPING_TRIP#${tripId}`, sk: `CAMP_SITE#${campSiteId}` },
    }));
  }

  async listCampSites(tripId: string): Promise<CampSiteRecord[]> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `CAMPING_TRIP#${tripId}`,
        ':prefix': 'CAMP_SITE#',
      },
    }));
    return (result.Items ?? []).map(item => stripMetadata<CampSiteRecord>(item as Record<string, unknown>)!);
  }

  // --- Expenses ---
  async createExpense(expense: ExpenseRecord): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: `CAMPING_TRIP#${expense.tripId}`,
        sk: `EXPENSE#${expense.expenseId}`,
        entityType: 'CAMPING_EXPENSE',
        ...expense,
      },
    }));
  }

  async updateExpense(expense: ExpenseRecord): Promise<void> {
    await this.createExpense(expense);
  }

  async deleteExpense(tripId: string, expenseId: string): Promise<void> {
    await this.client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { pk: `CAMPING_TRIP#${tripId}`, sk: `EXPENSE#${expenseId}` },
    }));
  }

  async listExpenses(tripId: string): Promise<ExpenseRecord[]> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `CAMPING_TRIP#${tripId}`,
        ':prefix': 'EXPENSE#',
      },
    }));
    return (result.Items ?? []).map(item => stripMetadata<ExpenseRecord>(item as Record<string, unknown>)!);
  }

  // --- Settlement ---
  async saveSettlement(settlement: SettlementRecord): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: `CAMPING_TRIP#${settlement.tripId}`,
        sk: 'SETTLEMENT',
        entityType: 'CAMPING_SETTLEMENT',
        ...settlement,
      },
    }));
  }

  async findSettlement(tripId: string): Promise<SettlementRecord | null> {
    const result = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: `CAMPING_TRIP#${tripId}`, sk: 'SETTLEMENT' },
    }));
    return stripMetadata<SettlementRecord>(result.Item as Record<string, unknown> | undefined);
  }
}
