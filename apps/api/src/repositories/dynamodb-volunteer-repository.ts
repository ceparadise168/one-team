import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type {
  VolunteerActivity,
  VolunteerRegistration,
  VolunteerCheckIn,
} from '../domain/volunteer.js';
import type { VolunteerRepository } from './volunteer-repository.js';

const GSI_STATUS_DATE = 'gsi-status-date';
const GSI_EMPLOYEE = 'gsi-employee';

function stripMetadata<T>(item: Record<string, unknown> | undefined): T | null {
  if (!item) return null;
  const rest = Object.fromEntries(
    Object.entries(item).filter(
      ([key]) =>
        key !== 'pk' && key !== 'sk' && key !== 'entityType' && key !== 'gsi_status' &&
        key !== 'activity_date' && key !== 'employee_id' && key !== 'registered_at'
    )
  );
  return rest as T;
}

export class DynamoDbVolunteerRepository implements VolunteerRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string
  ) {}

  async createActivity(activity: VolunteerActivity): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `ACTIVITY#${activity.activityId}`,
          sk: 'DETAIL',
          entityType: 'ACTIVITY',
          gsi_status: activity.status,
          activity_date: activity.activityDate,
          ...activity,
        },
      })
    );
  }

  async findActivityById(activityId: string): Promise<VolunteerActivity | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `ACTIVITY#${activityId}`, sk: 'DETAIL' },
      })
    );
    return stripMetadata<VolunteerActivity>(result.Item as Record<string, unknown> | undefined);
  }

  async updateActivity(activity: VolunteerActivity): Promise<void> {
    await this.createActivity(activity);
  }

  async listActivitiesByStatus(
    status: string,
    fromDate?: string
  ): Promise<VolunteerActivity[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: GSI_STATUS_DATE,
        KeyConditionExpression: fromDate
          ? 'gsi_status = :status AND activity_date >= :fromDate'
          : 'gsi_status = :status',
        ExpressionAttributeValues: fromDate
          ? { ':status': status, ':fromDate': fromDate }
          : { ':status': status },
      })
    );
    return (result.Items ?? []).map(
      (item) => stripMetadata<VolunteerActivity>(item as Record<string, unknown>)!
    );
  }

  async createRegistration(registration: VolunteerRegistration): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `ACTIVITY#${registration.activityId}`,
          sk: `REG#${registration.employeeId}`,
          entityType: 'REGISTRATION',
          employee_id: registration.employeeId,
          registered_at: registration.registeredAt,
          ...registration,
        },
      })
    );
  }

  async findRegistration(
    activityId: string,
    employeeId: string
  ): Promise<VolunteerRegistration | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `ACTIVITY#${activityId}`, sk: `REG#${employeeId}` },
      })
    );
    return stripMetadata<VolunteerRegistration>(
      result.Item as Record<string, unknown> | undefined
    );
  }

  async updateRegistration(registration: VolunteerRegistration): Promise<void> {
    await this.createRegistration(registration);
  }

  async listRegistrationsByActivity(activityId: string): Promise<VolunteerRegistration[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `ACTIVITY#${activityId}`,
          ':prefix': 'REG#',
        },
      })
    );
    return (result.Items ?? []).map(
      (item) => stripMetadata<VolunteerRegistration>(item as Record<string, unknown>)!
    );
  }

  async listRegistrationsByEmployee(employeeId: string): Promise<VolunteerRegistration[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: GSI_EMPLOYEE,
        KeyConditionExpression: 'employee_id = :eid',
        ExpressionAttributeValues: { ':eid': employeeId },
      })
    );
    return (result.Items ?? []).map(
      (item) => stripMetadata<VolunteerRegistration>(item as Record<string, unknown>)!
    );
  }

  async countActiveRegistrations(activityId: string): Promise<number> {
    const registrations = await this.listRegistrationsByActivity(activityId);
    return registrations.filter((r) => r.status === 'REGISTERED').length;
  }

  async createCheckIn(checkIn: VolunteerCheckIn): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `ACTIVITY#${checkIn.activityId}`,
          sk: `CHECKIN#${checkIn.employeeId}`,
          entityType: 'CHECKIN',
          ...checkIn,
        },
      })
    );
  }

  async findCheckIn(activityId: string, employeeId: string): Promise<VolunteerCheckIn | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `ACTIVITY#${activityId}`, sk: `CHECKIN#${employeeId}` },
      })
    );
    return stripMetadata<VolunteerCheckIn>(result.Item as Record<string, unknown> | undefined);
  }

  async listCheckInsByActivity(activityId: string): Promise<VolunteerCheckIn[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `ACTIVITY#${activityId}`,
          ':prefix': 'CHECKIN#',
        },
      })
    );
    return (result.Items ?? []).map(
      (item) => stripMetadata<VolunteerCheckIn>(item as Record<string, unknown>)!
    );
  }
}
