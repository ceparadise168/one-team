import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderInvitationEmailHtml,
  renderInvitationEmailText,
  renderInvitationEmailSubject
} from './invitation-email-template.js';

const sampleData = {
  tenantName: 'Acme Corp',
  employeeId: 'EMP-001',
  inviteUrl: 'https://app.example.com/invite?token=abc123',
  bindingCode: '12345678',
  expiresAt: '2025-06-01T12:00:00.000Z'
};

describe('renderInvitationEmailHtml', () => {
  it('renders HTML with all fields', () => {
    const html = renderInvitationEmailHtml(sampleData);

    assert.ok(html.includes('EMP-001'));
    assert.ok(html.includes('Acme Corp'));
    assert.ok(html.includes('https://app.example.com/invite?token=abc123'));
    assert.ok(html.includes('12345678'));
    assert.ok(html.includes('2025-06-01T12:00:00.000Z'));
    assert.ok(html.includes('lang="zh-TW"'));
  });

  it('escapes HTML in tenant name', () => {
    const html = renderInvitationEmailHtml({
      ...sampleData,
      tenantName: '<script>alert("xss")</script>'
    });

    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });
});

describe('renderInvitationEmailText', () => {
  it('renders plain text with all fields', () => {
    const text = renderInvitationEmailText(sampleData);

    assert.ok(text.includes('EMP-001'));
    assert.ok(text.includes('Acme Corp'));
    assert.ok(text.includes('https://app.example.com/invite?token=abc123'));
    assert.ok(text.includes('12345678'));
  });
});

describe('renderInvitationEmailSubject', () => {
  it('includes tenant name', () => {
    const subject = renderInvitationEmailSubject('Acme Corp');

    assert.ok(subject.includes('Acme Corp'));
    assert.ok(subject.includes('ONE TEAM'));
  });
});
