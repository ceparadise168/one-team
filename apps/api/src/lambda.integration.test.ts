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

test('integration: connect line stores optional login channel credentials', async () => {
  const suffix = `${Date.now()}-connect-login`;

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
      channelSecret: '1234567890abcdef',
      loginChannelId: '9876543210',
      loginChannelSecret: 'abcdef1234567890'
    }
  });

  assert.equal(connected.statusCode, 200);
  assert.equal(
    (connected.body as { line: { loginChannelId?: string } }).line.loginChannelId,
    '9876543210'
  );
});

test('integration: connect line rejects partial login credential payload', async () => {
  const suffix = `${Date.now()}-connect-login-invalid`;

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
      channelSecret: '1234567890abcdef',
      loginChannelId: '9876543210'
    }
  });

  assert.equal(connected.statusCode, 400);
});

test('integration: self-register + approve + digital id + offboard pipeline', async () => {
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

  // Self-register
  const registered = await invokeLambda({
    method: 'POST',
    path: '/v1/public/self-register',
    body: {
      tenantId,
      lineIdToken: `line-id:U-${suffix}`,
      employeeId: `E-${suffix}`,
      nickname: `Employee-${suffix}`
    }
  });

  assert.equal(registered.statusCode, 200);
  assert.equal((registered.body as { accessStatus: string }).accessStatus, 'PENDING');

  // Admin approves
  const approved = await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/employees/E-${suffix}/access-decision`,
    headers: adminHeaders,
    body: {
      decision: 'APPROVE',
      reviewerId: 'hr-admin'
    }
  });
  assert.equal(approved.statusCode, 200);
  assert.equal((approved.body as { accessStatus: string }).accessStatus, 'APPROVED');

  // Login via LINE ID token to get access token
  const login = await invokeLambda({
    method: 'POST',
    path: '/v1/public/auth/line-login',
    body: {
      tenantId,
      lineIdToken: `line-id:U-${suffix}`
    }
  });
  assert.equal(login.statusCode, 200);
  const accessToken = (login.body as { accessToken: string }).accessToken;
  assert.ok(accessToken);

  // Get digital ID
  const digitalId = await invokeLambda({
    method: 'GET',
    path: `/v1/liff/tenants/${tenantId}/me/digital-id`,
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  assert.equal(digitalId.statusCode, 200);
  const payload = (digitalId.body as { payload: string }).payload;

  // Verify digital ID
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

  // Offboard
  const offboard = await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/employees/E-${suffix}/offboard`,
    headers: adminHeaders,
    body: {
      actorId: 'hr-admin'
    }
  });

  assert.equal(offboard.statusCode, 200);

  // Verify digital ID is invalid after offboard
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

test('integration: access request approval enables delegated offboard permissions', async () => {
  const suffix = `${Date.now()}-delegated`;

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

  // Register manager via self-register
  const manager = await selfRegisterApproveAndLogin({
    tenantId,
    employeeId: `E-MGR-${suffix}`,
    lineIdToken: `line-id:U-MGR-${suffix}`,
    nickname: `Manager-${suffix}`
  });

  // Manager requests access
  const request = await invokeLambda({
    method: 'POST',
    path: `/v1/liff/tenants/${tenantId}/me/access-request`,
    headers: {
      authorization: `Bearer ${manager.accessToken}`
    },
    body: {}
  });
  assert.equal(request.statusCode, 200);

  // Approve manager without canRemove
  const approvedNoRemove = await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/employees/${manager.employeeId}/access-decision`,
    headers: adminHeaders,
    body: {
      decision: 'APPROVE',
      reviewerId: 'hr-admin',
      permissions: {
        canInvite: true,
        canRemove: false
      }
    }
  });
  assert.equal(approvedNoRemove.statusCode, 200);

  // Register a worker via self-register
  const worker = await selfRegisterApproveAndLogin({
    tenantId,
    employeeId: `E-WORK-${suffix}`,
    lineIdToken: `line-id:U-WORK-${suffix}`,
    nickname: `Worker-${suffix}`
  });

  // Manager tries to offboard worker (should be forbidden — no canRemove)
  const forbiddenOffboard = await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/employees/${worker.employeeId}/offboard`,
    headers: {
      authorization: `Bearer ${manager.accessToken}`
    },
    body: {}
  });
  assert.equal(forbiddenOffboard.statusCode, 403);

  // Approve manager with canRemove
  const approvedRemover = await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/employees/${manager.employeeId}/access-decision`,
    headers: adminHeaders,
    body: {
      decision: 'APPROVE',
      reviewerId: 'hr-admin',
      permissions: {
        canInvite: true,
        canRemove: true
      }
    }
  });
  assert.equal(approvedRemover.statusCode, 200);

  // Manager offboards worker (should succeed now)
  const delegatedOffboard = await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/employees/${worker.employeeId}/offboard`,
    headers: {
      authorization: `Bearer ${manager.accessToken}`
    },
    body: {}
  });
  assert.equal(delegatedOffboard.statusCode, 200);
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

test('integration: admin employees list with status filter', async () => {
  const suffix = `${Date.now()}-emplist`;

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

  // Register two employees
  await invokeLambda({
    method: 'POST',
    path: '/v1/public/self-register',
    body: {
      tenantId,
      lineIdToken: `line-id:U-A-${suffix}`,
      employeeId: `E-A-${suffix}`,
      nickname: '員工A'
    }
  });

  await invokeLambda({
    method: 'POST',
    path: '/v1/public/self-register',
    body: {
      tenantId,
      lineIdToken: `line-id:U-B-${suffix}`,
      employeeId: `E-B-${suffix}`,
      nickname: '員工B'
    }
  });

  // Approve one
  await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/employees/E-A-${suffix}/access-decision`,
    headers: adminHeaders,
    body: { decision: 'APPROVE', reviewerId: 'hr-admin' }
  });

  // List all
  const all = await invokeLambda({
    method: 'GET',
    path: `/v1/admin/tenants/${tenantId}/employees`,
    headers: adminHeaders
  });
  assert.equal(all.statusCode, 200);
  const allEmployees = (all.body as { employees: unknown[] }).employees;
  assert.equal(allEmployees.length, 2);

  // List pending only
  const pending = await invokeLambda({
    method: 'GET',
    path: `/v1/admin/tenants/${tenantId}/employees?status=PENDING`,
    headers: adminHeaders
  });
  assert.equal(pending.statusCode, 200);
  const pendingEmployees = (pending.body as { employees: Array<{ employeeId: string }> }).employees;
  assert.equal(pendingEmployees.length, 1);
  assert.ok(pendingEmployees[0].employeeId.includes('E-B'));
});

async function selfRegisterApproveAndLogin(input: {
  tenantId: string;
  employeeId: string;
  lineIdToken: string;
  nickname: string;
}): Promise<{
  employeeId: string;
  accessToken: string;
}> {
  const registered = await invokeLambda({
    method: 'POST',
    path: '/v1/public/self-register',
    body: {
      tenantId: input.tenantId,
      lineIdToken: input.lineIdToken,
      employeeId: input.employeeId,
      nickname: input.nickname
    }
  });
  assert.equal(registered.statusCode, 200);

  const approved = await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${input.tenantId}/employees/${input.employeeId}/access-decision`,
    headers: adminHeaders,
    body: {
      decision: 'APPROVE',
      reviewerId: 'hr-admin'
    }
  });
  assert.equal(approved.statusCode, 200);

  const login = await invokeLambda({
    method: 'POST',
    path: '/v1/public/auth/line-login',
    body: {
      tenantId: input.tenantId,
      lineIdToken: input.lineIdToken
    }
  });
  assert.equal(login.statusCode, 200);

  return {
    employeeId: input.employeeId,
    accessToken: (login.body as { accessToken: string }).accessToken
  };
}
