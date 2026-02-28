import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockEmailAdapter } from './email-adapter.js';

describe('MockEmailAdapter', () => {
  it('accumulates sent emails', async () => {
    const adapter = new MockEmailAdapter();

    const result = await adapter.sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Hello</p>',
      text: 'Hello'
    });

    assert.ok(result.messageId.startsWith('mock-'));
    assert.equal(adapter.sentEmails.length, 1);
    assert.equal(adapter.sentEmails[0].to, 'user@example.com');
    assert.equal(adapter.sentEmails[0].subject, 'Test');
  });

  it('tracks multiple emails', async () => {
    const adapter = new MockEmailAdapter();

    await adapter.sendEmail({ to: 'a@example.com', subject: 'A', html: '', text: '' });
    await adapter.sendEmail({ to: 'b@example.com', subject: 'B', html: '', text: '' });

    assert.equal(adapter.sentEmails.length, 2);
  });
});
