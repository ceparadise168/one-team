import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWelcomeFlexMessage,
  buildBindingInstructionFlexMessage,
  buildAccessConfirmationFlexMessage,
  buildOffboardingNotificationFlexMessage,
  buildAdminDashboardFlexMessage,
  buildPendingEmployeesCarouselFlexMessage,
  buildAdminActionResultFlexMessage,
  buildServicesMenuFlexMessage
} from './flex-message-templates.js';

describe('buildWelcomeFlexMessage', () => {
  it('returns flex message with tenant name', () => {
    const msg = buildWelcomeFlexMessage('Acme Corp');
    assert.equal(msg.type, 'flex');
    assert.ok(msg.altText?.includes('Acme Corp'));
    assert.ok(msg.contents);
  });
});

describe('buildBindingInstructionFlexMessage', () => {
  it('returns flex message with binding code', () => {
    const msg = buildBindingInstructionFlexMessage('12345678');
    assert.equal(msg.type, 'flex');
    assert.ok(msg.altText?.includes('綁定'));
    assert.ok(JSON.stringify(msg.contents).includes('12345678'));
  });
});

describe('buildAccessConfirmationFlexMessage', () => {
  it('returns approved message', () => {
    const msg = buildAccessConfirmationFlexMessage('APPROVED', 'Acme Corp');
    assert.equal(msg.type, 'flex');
    assert.ok(msg.altText?.includes('通過'));
    assert.ok(JSON.stringify(msg.contents).includes('Acme Corp'));
  });

  it('returns rejected message', () => {
    const msg = buildAccessConfirmationFlexMessage('REJECTED', 'Acme Corp');
    assert.ok(msg.altText?.includes('未通過'));
  });
});

describe('buildOffboardingNotificationFlexMessage', () => {
  it('returns offboarding notification', () => {
    const msg = buildOffboardingNotificationFlexMessage('Acme Corp');
    assert.equal(msg.type, 'flex');
    assert.ok(msg.altText?.includes('Acme Corp'));
    assert.ok(JSON.stringify(msg.contents).includes('離職'));
  });
});

describe('buildAdminDashboardFlexMessage', () => {
  it('returns dashboard with stats', () => {
    const msg = buildAdminDashboardFlexMessage({ pending: 3, approved: 12, rejected: 1, total: 16 });
    assert.equal(msg.type, 'flex');
    assert.ok(msg.altText?.includes('待審核'));
    const json = JSON.stringify(msg.contents);
    assert.ok(json.includes('管理後台'));
    assert.ok(json.includes('查看待審核'));
    assert.ok(json.includes('action=admin_list'));
  });
});

describe('buildPendingEmployeesCarouselFlexMessage', () => {
  it('returns empty state when no employees', () => {
    const msg = buildPendingEmployeesCarouselFlexMessage([]);
    assert.equal(msg.type, 'flex');
    const json = JSON.stringify(msg.contents);
    assert.ok(json.includes('目前沒有待審核的員工'));
  });

  it('returns carousel with employee cards', () => {
    const msg = buildPendingEmployeesCarouselFlexMessage([
      { employeeId: 'E001', boundAt: '2026-02-28T00:00:00.000Z' },
      { employeeId: 'E002', boundAt: '2026-02-27T00:00:00.000Z' }
    ]);
    assert.equal(msg.type, 'flex');
    const json = JSON.stringify(msg.contents);
    assert.ok(json.includes('E001'));
    assert.ok(json.includes('E002'));
    assert.ok(json.includes('action=admin_approve&eid=E001'));
    assert.ok(json.includes('action=admin_reject&eid=E001'));
  });
});

describe('buildAdminActionResultFlexMessage', () => {
  it('returns approve confirmation', () => {
    const msg = buildAdminActionResultFlexMessage({ action: 'APPROVE', employeeId: 'E001' });
    assert.equal(msg.type, 'flex');
    const json = JSON.stringify(msg.contents);
    assert.ok(json.includes('已核准'));
    assert.ok(json.includes('E001'));
    assert.ok(json.includes('action=admin_dashboard'));
  });

  it('returns reject confirmation', () => {
    const msg = buildAdminActionResultFlexMessage({ action: 'REJECT', employeeId: 'E002' });
    const json = JSON.stringify(msg.contents);
    assert.ok(json.includes('已拒絕'));
    assert.ok(json.includes('E002'));
  });
});

describe('buildServicesMenuFlexMessage', () => {
  it('returns 2-bubble carousel for non-admin', () => {
    const msg = buildServicesMenuFlexMessage();
    assert.equal(msg.type, 'flex');
    const contents = msg.contents as { type: string; contents: unknown[] };
    assert.equal(contents.type, 'carousel');
    assert.equal(contents.contents.length, 2);
  });

  it('returns 3-bubble carousel for admin', () => {
    const msg = buildServicesMenuFlexMessage({ isAdmin: true });
    const contents = msg.contents as { type: string; contents: unknown[] };
    assert.equal(contents.type, 'carousel');
    assert.equal(contents.contents.length, 3);
    const json = JSON.stringify(contents.contents[2]);
    assert.ok(json.includes('管理後台'));
    assert.ok(json.includes('action=admin_dashboard'));
  });
});
