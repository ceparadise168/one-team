import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWelcomeFlexMessage,
  buildAccessConfirmationFlexMessage,
  buildOffboardingNotificationFlexMessage,
  buildAdminDashboardFlexMessage,
  buildPendingEmployeesCarouselFlexMessage,
  buildAdminActionResultFlexMessage,
  buildDigitalIdFlexMessage,
  buildServicesMenuFlexMessage
} from './flex-message-templates.js';

describe('buildWelcomeFlexMessage', () => {
  it('returns flex message with tenant name, no registration button by default', () => {
    const msg = buildWelcomeFlexMessage('Acme Corp');
    assert.equal(msg.type, 'flex');
    assert.ok(msg.altText?.includes('Acme Corp'));
    assert.ok(msg.contents);
    assert.ok(!JSON.stringify(msg.contents).includes('開始申請'));
  });

  it('includes postback registration button when showRegistration is true', () => {
    const msg = buildWelcomeFlexMessage('Acme Corp', { showRegistration: true });
    const json = JSON.stringify(msg.contents);
    assert.ok(json.includes('開始申請'));
    assert.ok(json.includes('action=request_access'));
    assert.ok(json.includes('postback'));
    assert.ok(!json.includes('liff.line.me'), 'Should not include LIFF URL');
    assert.ok(!json.includes('fillInText'), 'Should not pre-fill text');
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

describe('buildDigitalIdFlexMessage', () => {
  it('returns flex message with QR code and employee ID', () => {
    const msg = buildDigitalIdFlexMessage('E12345');
    assert.equal(msg.type, 'flex');
    assert.ok(msg.altText?.includes('E12345'));
    const json = JSON.stringify(msg.contents);
    assert.ok(json.includes('數位員工證'));
    assert.ok(json.includes('E12345'));
    assert.ok(json.includes('quickchart.io/qr'));
    assert.ok(json.includes('image'));
  });

  it('URL-encodes the employee ID in QR code URL', () => {
    const msg = buildDigitalIdFlexMessage('E 001');
    const json = JSON.stringify(msg.contents);
    assert.ok(json.includes('E%20001'), 'Should URL-encode employee ID');
  });
});

describe('buildServicesMenuFlexMessage', () => {
  it('returns carousel with digital-id + 5 services for non-admin', () => {
    const msg = buildServicesMenuFlexMessage();
    assert.equal(msg.type, 'flex');
    const contents = msg.contents as { type: string; contents: unknown[] };
    assert.equal(contents.type, 'carousel');
    // 1 (員工證) + 5 (services) = 6
    assert.equal(contents.contents.length, 6);
    const json = JSON.stringify(contents);
    assert.ok(json.includes('志工活動'));
    assert.ok(json.includes('uri'));
  });

  it('returns carousel with admin bubble for admin', () => {
    const msg = buildServicesMenuFlexMessage({ isAdmin: true });
    const contents = msg.contents as { type: string; contents: unknown[] };
    assert.equal(contents.type, 'carousel');
    // 1 (員工證) + 5 (services) + 1 (管理後台) = 7
    assert.equal(contents.contents.length, 7);
    const lastBubble = contents.contents[6];
    const json = JSON.stringify(lastBubble);
    assert.ok(json.includes('管理後台'));
    assert.ok(json.includes('"type":"uri"'));
    assert.ok(json.includes('/admin'));
  });
});
