import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeLambda } from './testing/lambda-test-client.js';

test('e2e: hr setup to employee self-register, approve, digital id, and offboard', async () => {
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

  // Employee self-registers
  const selfRegister = await invokeLambda({
    method: 'POST',
    path: '/v1/public/self-register',
    body: {
      tenantId,
      lineIdToken: `line-id:EMP-U-${suffix}`,
      employeeId: `EMP-${suffix}`,
      nickname: `Employee-${suffix}`
    }
  });

  assert.equal(selfRegister.statusCode, 200);
  assert.equal((selfRegister.body as { accessStatus: string }).accessStatus, 'PENDING');

  // Admin approves the employee
  const approved = await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/employees/EMP-${suffix}/access-decision`,
    headers: adminHeaders,
    body: {
      decision: 'APPROVE',
      reviewerId: 'hr-admin'
    }
  });
  assert.equal(approved.statusCode, 200);
  assert.equal((approved.body as { accessStatus: string }).accessStatus, 'APPROVED');

  // Employee logs in via LINE ID token
  const login = await invokeLambda({
    method: 'POST',
    path: '/v1/public/auth/line-login',
    body: {
      tenantId,
      lineIdToken: `line-id:EMP-U-${suffix}`
    }
  });
  assert.equal(login.statusCode, 200);
  const accessToken = (login.body as { accessToken: string }).accessToken;

  // Employee gets digital ID
  const digitalId = await invokeLambda({
    method: 'GET',
    path: `/v1/liff/tenants/${tenantId}/me/digital-id`,
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  assert.equal(digitalId.statusCode, 200);

  // Scanner verifies digital ID
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

  // Admin offboards the employee
  await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${tenantId}/employees/EMP-${suffix}/offboard`,
    headers: adminHeaders,
    body: {
      actorId: 'hr-admin'
    }
  });

  // Scanner rejects digital ID after offboard
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
