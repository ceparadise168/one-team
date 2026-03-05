import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { MassageSessionRecord, MassageBookingRecord, MassageScheduleRecord } from '../domain/massage-booking.js';
import type { MassageBookingRepository } from './massage-booking-repository.js';

function stripMetadata<T>(item: Record<string, unknown> | undefined): T | null {
  if (!item) return null;
  const rest = Object.fromEntries(
    Object.entries(item).filter(
      ([key]) => !['pk', 'sk', 'entityType', 'gsi_employee', 'gsi_date'].includes(key)
    )
  );
  return rest as T;
}

export class DynamoDbMassageBookingRepository implements MassageBookingRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string
  ) {}

  // --- Sessions ---

  async createSession(session: MassageSessionRecord): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: `TENANT#${session.tenantId}`,
        sk: `MASSAGE_SESSION#${session.sessionId}`,
        entityType: 'MASSAGE_SESSION',
        gsi_date: session.date,
        ...session,
      },
    }));
  }

  async findSessionById(tenantId: string, sessionId: string): Promise<MassageSessionRecord | null> {
    const result = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: `TENANT#${tenantId}`, sk: `MASSAGE_SESSION#${sessionId}` },
    }));
    return stripMetadata<MassageSessionRecord>(result.Item as Record<string, unknown> | undefined);
  }

  async updateSession(session: MassageSessionRecord): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: `TENANT#${session.tenantId}`,
        sk: `MASSAGE_SESSION#${session.sessionId}`,
        entityType: 'MASSAGE_SESSION',
        gsi_date: session.date,
        ...session,
      },
    }));
  }

  async listActiveSessions(tenantId: string, fromDate?: string): Promise<MassageSessionRecord[]> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      FilterExpression: 'attribute_exists(#s) AND #s = :active' + (fromDate ? ' AND #d >= :fromDate' : ''),
      ExpressionAttributeNames: { '#s': 'status', '#d': 'date' },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':prefix': 'MASSAGE_SESSION#',
        ':active': 'ACTIVE',
        ...(fromDate ? { ':fromDate': fromDate } : {}),
      },
    }));
    return (result.Items ?? []).map(item => stripMetadata<MassageSessionRecord>(item as Record<string, unknown>)!);
  }

  async listSessionsDueForDraw(now: string): Promise<MassageSessionRecord[]> {
    const result = await this.client.send(new ScanCommand({
      TableName: this.tableName,
      FilterExpression: 'entityType = :et AND #m = :lottery AND #s = :active AND drawAt <= :now AND (attribute_not_exists(drawnAt) OR attribute_type(drawnAt, :nullType))',
      ExpressionAttributeNames: { '#m': 'mode', '#s': 'status' },
      ExpressionAttributeValues: {
        ':et': 'MASSAGE_SESSION',
        ':lottery': 'LOTTERY',
        ':active': 'ACTIVE',
        ':now': now,
        ':nullType': 'NULL',
      },
    }));
    return (result.Items ?? []).map(item => stripMetadata<MassageSessionRecord>(item as Record<string, unknown>)!);
  }

  // --- Bookings ---

  async createBooking(booking: MassageBookingRecord): Promise<void> {
    // Write booking record (keyed by session+employee for uniqueness)
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: `TENANT#${booking.tenantId}`,
        sk: `MASSAGE_BOOKING#${booking.sessionId}#${booking.employeeId}`,
        entityType: 'MASSAGE_BOOKING',
        gsi_employee: booking.employeeId,
        ...booking,
      },
      ConditionExpression: 'attribute_not_exists(sk)',
    }));

    // Write reverse index for my-bookings query
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: `TENANT#${booking.tenantId}`,
        sk: `MASSAGE_MY_BOOKING#${booking.employeeId}#${booking.sessionId}`,
        entityType: 'MASSAGE_MY_BOOKING',
        ...booking,
      },
    }));
  }

  async findBooking(tenantId: string, sessionId: string, employeeId: string): Promise<MassageBookingRecord | null> {
    const result = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: `TENANT#${tenantId}`, sk: `MASSAGE_BOOKING#${sessionId}#${employeeId}` },
    }));
    return stripMetadata<MassageBookingRecord>(result.Item as Record<string, unknown> | undefined);
  }

  async findBookingById(tenantId: string, bookingId: string): Promise<MassageBookingRecord | null> {
    // Query with filter — acceptable for low volume
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      FilterExpression: 'bookingId = :bookingId',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':prefix': 'MASSAGE_BOOKING#',
        ':bookingId': bookingId,
      },
    }));
    const item = result.Items?.[0] as Record<string, unknown> | undefined;
    return stripMetadata<MassageBookingRecord>(item);
  }

  async updateBooking(booking: MassageBookingRecord): Promise<void> {
    // Update main booking record
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: `TENANT#${booking.tenantId}`,
        sk: `MASSAGE_BOOKING#${booking.sessionId}#${booking.employeeId}`,
        entityType: 'MASSAGE_BOOKING',
        gsi_employee: booking.employeeId,
        ...booking,
      },
    }));

    // Update my-booking index record
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: `TENANT#${booking.tenantId}`,
        sk: `MASSAGE_MY_BOOKING#${booking.employeeId}#${booking.sessionId}`,
        entityType: 'MASSAGE_MY_BOOKING',
        ...booking,
      },
    }));
  }

  async listBookingsBySession(tenantId: string, sessionId: string): Promise<MassageBookingRecord[]> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':prefix': `MASSAGE_BOOKING#${sessionId}#`,
      },
    }));
    return (result.Items ?? []).map(item => stripMetadata<MassageBookingRecord>(item as Record<string, unknown>)!);
  }

  async listBookingsByEmployee(tenantId: string, employeeId: string): Promise<MassageBookingRecord[]> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':prefix': `MASSAGE_MY_BOOKING#${employeeId}#`,
      },
    }));
    return (result.Items ?? []).map(item => stripMetadata<MassageBookingRecord>(item as Record<string, unknown>)!);
  }

  async countConfirmedBookings(tenantId: string, sessionId: string): Promise<number> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      FilterExpression: '#s = :confirmed',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':prefix': `MASSAGE_BOOKING#${sessionId}#`,
        ':confirmed': 'CONFIRMED',
      },
      Select: 'COUNT',
    }));
    return result.Count ?? 0;
  }

  async countConfirmedBySlot(tenantId: string, sessionId: string, slotStartAt: string): Promise<number> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      FilterExpression: '#s = :confirmed AND slotStartAt = :slot',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':prefix': `MASSAGE_BOOKING#${sessionId}#`,
        ':confirmed': 'CONFIRMED',
        ':slot': slotStartAt,
      },
      Select: 'COUNT',
    }));
    return result.Count ?? 0;
  }

  async listWaitlistedBySlot(tenantId: string, sessionId: string, slotStartAt: string): Promise<MassageBookingRecord[]> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      FilterExpression: '#s = :waitlisted AND slotStartAt = :slot',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':prefix': `MASSAGE_BOOKING#${sessionId}#`,
        ':waitlisted': 'WAITLISTED',
        ':slot': slotStartAt,
      },
    }));
    return (result.Items ?? [])
      .map(item => stripMetadata<MassageBookingRecord>(item as Record<string, unknown>)!)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // --- Schedules ---

  async createSchedule(schedule: MassageScheduleRecord): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: `TENANT#${schedule.tenantId}`,
        sk: `MASSAGE_SCHEDULE#${schedule.scheduleId}`,
        entityType: 'MASSAGE_SCHEDULE',
        ...schedule,
      },
    }));
  }

  async findScheduleById(tenantId: string, scheduleId: string): Promise<MassageScheduleRecord | null> {
    const result = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: `TENANT#${tenantId}`, sk: `MASSAGE_SCHEDULE#${scheduleId}` },
    }));
    return stripMetadata<MassageScheduleRecord>(result.Item as Record<string, unknown> | undefined);
  }

  async updateSchedule(schedule: MassageScheduleRecord): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: `TENANT#${schedule.tenantId}`,
        sk: `MASSAGE_SCHEDULE#${schedule.scheduleId}`,
        entityType: 'MASSAGE_SCHEDULE',
        ...schedule,
      },
    }));
  }

  async listSchedules(tenantId: string): Promise<MassageScheduleRecord[]> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':prefix': 'MASSAGE_SCHEDULE#',
      },
    }));
    return (result.Items ?? []).map(item => stripMetadata<MassageScheduleRecord>(item as Record<string, unknown>)!);
  }

  async listAllActiveSchedules(): Promise<MassageScheduleRecord[]> {
    const result = await this.client.send(new ScanCommand({
      TableName: this.tableName,
      FilterExpression: 'entityType = :et AND #s = :active',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':et': 'MASSAGE_SCHEDULE',
        ':active': 'ACTIVE',
      },
    }));
    return (result.Items ?? []).map(item => stripMetadata<MassageScheduleRecord>(item as Record<string, unknown>)!);
  }
}
