import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { invokeLambda } from './testing/lambda-test-client.js';

const adminHeaders = {
  authorization: 'Bearer admin-token'
};

test('integration: setup wizard APIs complete connection/provision/webhook flow', async () => {
  const suffix = `${Date.now()}-setup`;

  const created = await invokeLambda({
    method: 'POST',
    path: '/v1/admin/tenants',
    headers: adminHeaders,
    body: {
      tenantName: `Tenant-${suffix}`,
      adminEmail: `hr+${suffix}@acme.test`
    }
  });

  assert.equal(created.statusCode, 201);
  const tenantId = (created.body as { tenantId: string }).tenantId;

  const connected = await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/line/connect`,
    headers: adminHeaders,
    body: {
      channelId: '1234567890',
      channelSecret: '1234567890abcdef'
    }
  });

  assert.equal(connected.statusCode, 200);

  const provisioned = await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/line/provision`,
    headers: adminHeaders,
    body: {}
  });

  assert.equal(provisioned.statusCode, 200);

  const verified = await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/line/webhook/verify`,
    headers: adminHeaders,
    body: {
      verificationToken: 'line-verify-1234567890'
    }
  });

  assert.equal(verified.statusCode, 200);
  const verifiedBody = verified.body as {
    setup: {
      completedAt?: string;
    };
  };
  assert.ok(verifiedBody.setup.completedAt);
});

test('integration: bind + digital id + offboard pipeline', async () => {
  const suffix = `${Date.now()}-pipeline`;

  const created = await invokeLambda({
    method: 'POST',
    path: '/v1/admin/tenants',
    headers: adminHeaders,
    body: {
      tenantName: `Tenant-${suffix}`,
      adminEmail: `hr+${suffix}@acme.test`
    }
  });

  const tenantId = (created.body as { tenantId: string }).tenantId;

  const batch = await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/invites/batch-email`,
    headers: adminHeaders,
    body: {
      ttlMinutes: 60,
      recipients: [{ email: `user+${suffix}@acme.test`, employeeId: `E-${suffix}` }]
    }
  });

  assert.equal(batch.statusCode, 202);
  const batchJobId = (batch.body as { jobId: string }).jobId;

  const firstRecipient = (batch.body as {
    recipients: Array<{
      status: string;
      invitationToken: string;
      oneTimeBindingCode: string;
      employeeId: string;
    }>;
  }).recipients[0];
  assert.equal(firstRecipient.status, 'QUEUED');

  const dispatched = await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/invites/batch-jobs/${batchJobId}/dispatch`,
    headers: adminHeaders,
    body: {}
  });
  assert.equal(dispatched.statusCode, 200);
  assert.equal(
    (dispatched.body as { recipients: Array<{ status: string }> }).recipients[0].status,
    'SENT'
  );

  const start = await invokeLambda({
    method: 'POST',
    path: '/v1/public/bind/start',
    body: {
      lineIdToken: `line-id:U-${suffix}`,
      invitationToken: firstRecipient.invitationToken
    }
  });

  assert.equal(start.statusCode, 200);
  const bindSessionToken = (start.body as { bindSessionToken: string }).bindSessionToken;

  const complete = await invokeLambda({
    method: 'POST',
    path: '/v1/public/bind/complete',
    body: {
      bindSessionToken,
      employeeId: firstRecipient.employeeId,
      bindingCode: firstRecipient.oneTimeBindingCode
    }
  });

  assert.equal(complete.statusCode, 200);

  const accessToken = (complete.body as { auth: { accessToken: string } }).auth.accessToken;

  const digitalId = await invokeLambda({
    method: 'GET',
    path: `/v1/liff/tenants/${tenantId}/me/digital-id`,
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  assert.equal(digitalId.statusCode, 200);
  const payload = (digitalId.body as { payload: string }).payload;

  const verifiedBeforeOffboard = await invokeLambda({
    method: 'POST',
    path: '/v1/scanner/verify',
    headers: {
      'x-scanner-api-key': 'dev-scanner-key'
    },
    body: {
      payload
    }
  });

  assert.equal(verifiedBeforeOffboard.statusCode, 200);
  assert.equal((verifiedBeforeOffboard.body as { valid: boolean }).valid, true);

  const offboard = await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/employees/${firstRecipient.employeeId}/offboard`,
    headers: adminHeaders,
    body: {
      actorId: 'hr-admin'
    }
  });

  assert.equal(offboard.statusCode, 200);

  const verifiedAfterOffboard = await invokeLambda({
    method: 'POST',
    path: '/v1/scanner/verify',
    headers: {
      'x-scanner-api-key': 'dev-scanner-key'
    },
    body: {
      payload
    }
  });

  assert.equal(verifiedAfterOffboard.statusCode, 200);
  assert.equal((verifiedAfterOffboard.body as { valid: boolean }).valid, false);
});

test('integration: line webhook rejects request without signature header', async () => {
  const suffix = `${Date.now()}-webhook-missing-signature`;

  const created = await invokeLambda({
    method: 'POST',
    path: '/v1/admin/tenants',
    headers: adminHeaders,
    body: {
      tenantName: `Tenant-${suffix}`,
      adminEmail: `hr+${suffix}@acme.test`
    }
  });
  assert.equal(created.statusCode, 201);
  const tenantId = (created.body as { tenantId: string }).tenantId;

  const connected = await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/line/connect`,
    headers: adminHeaders,
    body: {
      channelId: '1234567890',
      channelSecret: '1234567890abcdef'
    }
  });
  assert.equal(connected.statusCode, 200);

  const webhook = await invokeLambda({
    method: 'POST',
    path: `/v1/line/webhook/${tenantId}`,
    body: {
      destination: 'line-destination',
      events: []
    }
  });

  assert.equal(webhook.statusCode, 401);
  assert.equal(
    (webhook.body as { error: string }).error,
    'Missing LINE webhook signature header'
  );
});

test('integration: line webhook rejects invalid signature', async () => {
  const suffix = `${Date.now()}-webhook-invalid-signature`;

  const created = await invokeLambda({
    method: 'POST',
    path: '/v1/admin/tenants',
    headers: adminHeaders,
    body: {
      tenantName: `Tenant-${suffix}`,
      adminEmail: `hr+${suffix}@acme.test`
    }
  });
  assert.equal(created.statusCode, 201);
  const tenantId = (created.body as { tenantId: string }).tenantId;

  const connected = await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/line/connect`,
    headers: adminHeaders,
    body: {
      channelId: '1234567890',
      channelSecret: '1234567890abcdef'
    }
  });
  assert.equal(connected.statusCode, 200);

  const webhook = await invokeLambda({
    method: 'POST',
    path: `/v1/line/webhook/${tenantId}`,
    headers: {
      'x-line-signature': 'invalid-signature'
    },
    body: {
      destination: 'line-destination',
      events: [{ type: 'message' }]
    }
  });

  assert.equal(webhook.statusCode, 401);
  assert.equal((webhook.body as { error: string }).error, 'Invalid LINE webhook signature');
});

test('integration: line webhook accepts valid signature and returns event count', async () => {
  const suffix = `${Date.now()}-webhook-valid-signature`;
  const channelSecret = '1234567890abcdef';

  const created = await invokeLambda({
    method: 'POST',
    path: '/v1/admin/tenants',
    headers: adminHeaders,
    body: {
      tenantName: `Tenant-${suffix}`,
      adminEmail: `hr+${suffix}@acme.test`
    }
  });
  assert.equal(created.statusCode, 201);
  const tenantId = (created.body as { tenantId: string }).tenantId;

  const connected = await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/line/connect`,
    headers: adminHeaders,
    body: {
      channelId: '1234567890',
      channelSecret
    }
  });
  assert.equal(connected.statusCode, 200);

  const payload = {
    destination: 'line-destination',
    events: [{ type: 'message' }, { type: 'follow' }]
  };
  const rawBody = JSON.stringify(payload);
  const signature = createHmac('sha256', channelSecret).update(rawBody, 'utf8').digest('base64');

  const webhook = await invokeLambda({
    method: 'POST',
    path: `/v1/line/webhook/${tenantId}`,
    headers: {
      'x-line-signature': signature
    },
    body: payload
  });

  assert.equal(webhook.statusCode, 200);
  assert.equal((webhook.body as { ok: boolean }).ok, true);
  assert.equal((webhook.body as { receivedEvents: number }).receivedEvents, 2);
});
