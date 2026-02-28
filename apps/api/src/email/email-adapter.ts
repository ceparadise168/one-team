export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
}

export interface SendEmailResult {
  messageId: string;
}

export interface EmailAdapter {
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
}

export class MockEmailAdapter implements EmailAdapter {
  readonly sentEmails: SendEmailInput[] = [];

  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    this.sentEmails.push(input);
    return { messageId: `mock-${Date.now()}-${this.sentEmails.length}` };
  }
}

export class ExternalEmailAdapter implements EmailAdapter {
  constructor(
    private readonly options: {
      apiUrl: string;
      apiKey: string;
      defaultFrom?: string;
      fetchFn?: typeof fetch;
    }
  ) {}

  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    const fetchFn = this.options.fetchFn ?? globalThis.fetch;
    const from = input.from ?? this.options.defaultFrom ?? 'noreply@one-team.app';

    const response = await fetchFn(this.options.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.apiKey}`
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text
      })
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => 'No response body');
      throw new Error(`Email send failed (HTTP ${response.status}): ${detail}`);
    }

    const result = (await response.json()) as { id?: string };
    return { messageId: result.id ?? `ext-${Date.now()}` };
  }
}

export function createEmailAdapter(): EmailAdapter {
  const mode = (process.env.EMAIL_ADAPTER_MODE ?? 'mock').toLowerCase();

  if (mode === 'external') {
    const apiUrl = process.env.EMAIL_API_URL;
    const apiKey = process.env.EMAIL_API_KEY;

    if (!apiUrl || !apiKey) {
      throw new Error('EMAIL_API_URL and EMAIL_API_KEY are required when EMAIL_ADAPTER_MODE=external');
    }

    return new ExternalEmailAdapter({
      apiUrl,
      apiKey,
      defaultFrom: process.env.EMAIL_DEFAULT_FROM
    });
  }

  return new MockEmailAdapter();
}
