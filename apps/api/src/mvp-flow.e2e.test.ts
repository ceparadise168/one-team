import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeLambda } from './testing/lambda-test-client.js';

test('e2e: hr setup to employee access revocation journey', async () => {
  const suffix = `${Date.now()}-e2e`;
  const adminHeaders = {
    authorization: 'Bearer admin-token'
  };

  const tenantCreated = await invokeLambda({
    method: 'POST',
    path: '/v1/admin/tenants',
    headers: adminHeaders,
    body: {
      tenantName: `Tenant-${suffix}`,
      adminEmail: `hr+${suffix}@acme.test`
    }
  });

  assert.equal(tenantCreated.statusCode, 201);
  const tenantId = (tenantCreated.body as { tenantId: string }).tenantId;

  await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/line/connect`,
    headers: adminHeaders,
    body: {
      channelId: '1234567890',
      channelSecret: '1234567890abcdef'
    }
  });

  await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/line/provision`,
    headers: adminHeaders,
    body: {}
  });

  await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/line/webhook/verify`,
    headers: adminHeaders,
    body: {
      verificationToken: 'line-verify-1234567890'
    }
  });

  const batchInvite = await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/invites/batch-email`,
    headers: adminHeaders,
    body: {
      ttlMinutes: 60,
      recipients: [{ email: `staff+${suffix}@acme.test`, employeeId: `EMP-${suffix}` }]
    }
  });
  const batchJobId = (batchInvite.body as { jobId: string }).jobId;

  const dispatched = await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/invites/batch-jobs/${batchJobId}/dispatch`,
    headers: adminHeaders,
    body: {}
  });
  assert.equal(dispatched.statusCode, 200);

  const recipient = (batchInvite.body as {
    recipients: Array<{
      status: string;
      invitationToken: string;
      oneTimeBindingCode: string;
      employeeId: string;
    }>;
  }).recipients[0];
  assert.equal(recipient.status, 'QUEUED');
  assert.equal(
    (dispatched.body as { recipients: Array<{ status: string }> }).recipients[0].status,
    'SENT'
  );

  const bindStart = await invokeLambda({
    method: 'POST',
    path: '/v1/public/bind/start',
    body: {
      lineIdToken: `line-id:EMP-U-${suffix}`,
      invitationToken: recipient.invitationToken
    }
  });

  const bindComplete = await invokeLambda({
    method: 'POST',
    path: '/v1/public/bind/complete',
    body: {
      bindSessionToken: (bindStart.body as { bindSessionToken: string }).bindSessionToken,
      employeeId: recipient.employeeId,
      bindingCode: recipient.oneTimeBindingCode
    }
  });

  assert.equal(bindComplete.statusCode, 200);
  const accessToken = (bindComplete.body as { auth: { accessToken: string } }).auth.accessToken;

  const digitalId = await invokeLambda({
    method: 'GET',
    path: `/v1/liff/tenants/${tenantId}/me/digital-id`,
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  assert.equal(digitalId.statusCode, 200);

  const verifyBefore = await invokeLambda({
    method: 'POST',
    path: '/v1/scanner/verify',
    headers: {
      'x-scanner-api-key': 'dev-scanner-key'
    },
    body: {
      payload: (digitalId.body as { payload: string }).payload
    }
  });

  assert.equal((verifyBefore.body as { valid: boolean }).valid, true);

  await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/employees/${recipient.employeeId}/offboard`,
    headers: adminHeaders,
    body: {
      actorId: 'hr-admin'
    }
  });

  const verifyAfter = await invokeLambda({
    method: 'POST',
    path: '/v1/scanner/verify',
    headers: {
      'x-scanner-api-key': 'dev-scanner-key'
    },
    body: {
      payload: (digitalId.body as { payload: string }).payload
    }
  });

  assert.equal((verifyAfter.body as { valid: boolean }).valid, false);
});
