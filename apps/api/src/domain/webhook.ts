export type LineWebhookEventType = 'follow' | 'unfollow' | 'postback' | 'message' | 'join' | 'leave';

export interface LineWebhookEvent {
  type: LineWebhookEventType;
  webhookEventId: string;
  timestamp: number;
  source: {
    type: 'user' | 'group' | 'room';
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  replyToken?: string;
  postback?: {
    data: string;
  };
  message?: {
    type: string;
    id: string;
    text?: string;
  };
}

export interface LineWebhookPayload {
  destination: string;
  events: LineWebhookEvent[];
}

export type PostbackAction =
  | 'request_access'
  | 'contact_admin'
  | 'services_menu'
  | 'digital_id'
  | 'profile'
  | 'start_bind'
  | 'admin_dashboard'
  | 'admin_list'
  | 'admin_approve'
  | 'admin_reject';

const KNOWN_POSTBACK_ACTIONS = new Set<string>([
  'request_access',
  'contact_admin',
  'services_menu',
  'digital_id',
  'profile',
  'start_bind',
  'admin_dashboard',
  'admin_list',
  'admin_approve',
  'admin_reject'
]);

export function parsePostbackData(data: string): {
  action?: PostbackAction;
  employeeId?: string;
} {
  const params = new URLSearchParams(data);
  const rawAction = params.get('action');
  const employeeId = params.get('eid') ?? undefined;

  const action = rawAction && KNOWN_POSTBACK_ACTIONS.has(rawAction)
    ? (rawAction as PostbackAction)
    : undefined;

  return { action, employeeId };
}
