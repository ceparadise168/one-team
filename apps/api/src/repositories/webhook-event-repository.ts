export interface WebhookEventRepository {
  isProcessed(webhookEventId: string): Promise<boolean>;
  markProcessed(webhookEventId: string, ttlEpochSeconds?: number): Promise<void>;
}

export class InMemoryWebhookEventRepository implements WebhookEventRepository {
  private readonly processed = new Set<string>();

  async isProcessed(webhookEventId: string): Promise<boolean> {
    return this.processed.has(webhookEventId);
  }

  async markProcessed(webhookEventId: string): Promise<void> {
    this.processed.add(webhookEventId);
  }
}
