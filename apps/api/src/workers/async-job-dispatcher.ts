export interface InvitationEmailMessage {
  tenantId: string;
  jobId: string;
  email: string;
  employeeId: string;
  invitationId: string;
  invitationToken: string;
  invitationUrl: string;
  oneTimeBindingCode: string;
}

export interface OffboardingJobMessage {
  jobId: string;
  tenantId: string;
  employeeId: string;
  lineUserId: string;
  actorId: string;
}

export interface AsyncJobDispatcher {
  sendInvitationEmail(message: InvitationEmailMessage): Promise<void>;
  sendOffboardingJob(message: OffboardingJobMessage): Promise<void>;
}

export class InMemoryAsyncJobDispatcher implements AsyncJobDispatcher {
  readonly invitationMessages: InvitationEmailMessage[] = [];
  readonly offboardingMessages: OffboardingJobMessage[] = [];

  async sendInvitationEmail(message: InvitationEmailMessage): Promise<void> {
    this.invitationMessages.push(message);
  }

  async sendOffboardingJob(message: OffboardingJobMessage): Promise<void> {
    this.offboardingMessages.push(message);
  }
}

export class SqsAsyncJobDispatcher implements AsyncJobDispatcher {
  private readonly sendMessage: (queueUrl: string, body: string) => Promise<void>;

  constructor(
    private readonly options: {
      invitationsQueueUrl: string;
      offboardingQueueUrl: string;
      sqsClient: { send(command: unknown): Promise<unknown> };
      SendMessageCommand: new (input: { QueueUrl: string; MessageBody: string }) => unknown;
    }
  ) {
    this.sendMessage = async (queueUrl: string, body: string) => {
      await this.options.sqsClient.send(
        new this.options.SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: body
        })
      );
    };
  }

  async sendInvitationEmail(message: InvitationEmailMessage): Promise<void> {
    await this.sendMessage(this.options.invitationsQueueUrl, JSON.stringify(message));
  }

  async sendOffboardingJob(message: OffboardingJobMessage): Promise<void> {
    await this.sendMessage(this.options.offboardingQueueUrl, JSON.stringify(message));
  }
}
