import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeLambda } from './testing/lambda-test-client.js';

const adminHeaders = {
  authorization: 'Bearer admin-token'
};

async function selfRegisterApproveAndLogin(input: {
  tenantId: string;
  employeeId: string;
  lineIdToken: string;
}): Promise<{ employeeId: string; accessToken: string }> {
  await invokeLambda({
    method: 'POST',
    path: '/v1/public/self-register',
    body: {
      tenantId: input.tenantId,
      lineIdToken: input.lineIdToken,
      employeeId: input.employeeId
    }
  });

  await invokeLambda({
    method: 'POST',
    path: `/v1/admin/tenants/${input.tenantId}/employees/${input.employeeId}/access-decision`,
    headers: adminHeaders,
    body: { decision: 'APPROVE', reviewerId: 'hr-admin' }
  });

  const login = await invokeLambda({
    method: 'POST',
    path: '/v1/public/auth/line-login',
    body: { tenantId: input.tenantId, lineIdToken: input.lineIdToken }
  });
  assert.equal(login.statusCode, 200);

  return {
    employeeId: input.employeeId,
    accessToken: (login.body as { accessToken: string }).accessToken
  };
}

test('integration: volunteer full flow — create, register, check-in, report, CSV', async () => {
  const suffix = `${Date.now()}-vol`;

  // Create tenant
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

  // Register and approve organizer
  const organizer = await selfRegisterApproveAndLogin({
    tenantId,
    employeeId: `E-ORG-${suffix}`,
    lineIdToken: `line-id:U-ORG-${suffix}`
  });
  const orgHeaders = { authorization: `Bearer ${organizer.accessToken}` };

  // Register and approve participant
  const participant = await selfRegisterApproveAndLogin({
    tenantId,
    employeeId: `E-PART-${suffix}`,
    lineIdToken: `line-id:U-PART-${suffix}`
  });
  const partHeaders = { authorization: `Bearer ${participant.accessToken}` };

  // Step 1: Create activity (organizer-scan mode)
  const createRes = await invokeLambda({
    method: 'POST',
    path: '/v1/volunteer/activities',
    headers: orgHeaders,
    body: {
      title: `Cleanup-${suffix}`,
      description: 'Beach cleanup event',
      location: 'Taipei Beach',
      activityDate: '2026-06-01',
      startTime: '09:00',
      endTime: '17:00',
      capacity: 10,
      checkInMode: 'organizer-scan'
    }
  });
  assert.equal(createRes.statusCode, 201);
  const { activityId } = createRes.body as { activityId: string };
  assert.ok(activityId);

  // Step 2: List activities — should include the new one
  const listRes = await invokeLambda({
    method: 'GET',
    path: '/v1/volunteer/activities?status=OPEN'
  });
  assert.equal(listRes.statusCode, 200);
  const activities = (listRes.body as { activities: Array<{ activityId: string }> }).activities;
  assert.ok(activities.some((a) => a.activityId === activityId));

  // Step 3: Get activity detail
  const detailRes = await invokeLambda({
    method: 'GET',
    path: `/v1/volunteer/activities/${activityId}`
  });
  assert.equal(detailRes.statusCode, 200);
  const detail = detailRes.body as { activity: { title: string }; registrationCount: number };
  assert.equal(detail.activity.title, `Cleanup-${suffix}`);
  assert.equal(detail.registrationCount, 0);

  // Step 4: Participant registers
  const regRes = await invokeLambda({
    method: 'POST',
    path: `/v1/volunteer/activities/${activityId}/register`,
    headers: partHeaders
  });
  assert.equal(regRes.statusCode, 201);

  // Step 5: Participant's my-activities includes this
  const myRes = await invokeLambda({
    method: 'GET',
    path: '/v1/volunteer/my-activities',
    headers: partHeaders
  });
  assert.equal(myRes.statusCode, 200);
  const registrations = (
    myRes.body as { registrations: Array<{ activityId: string }> }
  ).registrations;
  assert.ok(registrations.some((r) => r.activityId === activityId));

  // Step 6: Organizer scans participant's badge to check in
  const checkInRes = await invokeLambda({
    method: 'POST',
    path: `/v1/volunteer/activities/${activityId}/scan-check-in`,
    headers: orgHeaders,
    body: { employeeId: participant.employeeId }
  });
  assert.equal(checkInRes.statusCode, 200);

  // Step 7: Get report
  const reportRes = await invokeLambda({
    method: 'GET',
    path: `/v1/volunteer/activities/${activityId}/report`,
    headers: orgHeaders
  });
  assert.equal(reportRes.statusCode, 200);
  const report = reportRes.body as {
    activity: { activityId: string };
    registrations: unknown[];
    checkIns: unknown[];
  };
  assert.equal(report.activity.activityId, activityId);
  assert.equal(report.registrations.length, 1);
  assert.equal(report.checkIns.length, 1);

  // Step 8: Export CSV
  const csvRes = await invokeLambda({
    method: 'GET',
    path: `/v1/volunteer/activities/${activityId}/report/export`,
    headers: orgHeaders
  });
  assert.equal(csvRes.statusCode, 200);
  // CSV response body is a raw string containing employeeId
  assert.ok(typeof csvRes.body === 'string');
  assert.ok((csvRes.body as string).includes(participant.employeeId));
});

test('integration: scan-check-in-qr — organizer scans digital ID QR payload', async () => {
  const suffix = `${Date.now()}-vol-qr`;

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

  const organizer = await selfRegisterApproveAndLogin({
    tenantId,
    employeeId: `E-ORG-${suffix}`,
    lineIdToken: `line-id:U-ORG-${suffix}`
  });
  const orgHeaders = { authorization: `Bearer ${organizer.accessToken}` };

  const participant = await selfRegisterApproveAndLogin({
    tenantId,
    employeeId: `E-PART-${suffix}`,
    lineIdToken: `line-id:U-PART-${suffix}`
  });
  const partHeaders = { authorization: `Bearer ${participant.accessToken}` };

  // Create organizer-scan activity
  const createRes = await invokeLambda({
    method: 'POST',
    path: '/v1/volunteer/activities',
    headers: orgHeaders,
    body: {
      title: `QR-Test-${suffix}`,
      description: '',
      location: '',
      activityDate: '2026-06-15',
      startTime: '09:00',
      endTime: '17:00',
      capacity: null,
      checkInMode: 'organizer-scan'
    }
  });
  assert.equal(createRes.statusCode, 201);
  const { activityId } = createRes.body as { activityId: string };

  // Participant registers
  const regRes = await invokeLambda({
    method: 'POST',
    path: `/v1/volunteer/activities/${activityId}/register`,
    headers: partHeaders
  });
  assert.equal(regRes.statusCode, 201);

  // Get participant's digital ID payload
  const digitalIdRes = await invokeLambda({
    method: 'GET',
    path: `/v1/liff/tenants/${tenantId}/me/digital-id`,
    headers: partHeaders
  });
  assert.equal(digitalIdRes.statusCode, 200);
  const { payload: digitalIdPayload } = digitalIdRes.body as { payload: string };
  assert.ok(digitalIdPayload);

  // Organizer scans the digital ID QR payload
  const scanRes = await invokeLambda({
    method: 'POST',
    path: `/v1/volunteer/activities/${activityId}/scan-check-in-qr`,
    headers: orgHeaders,
    body: { digitalIdPayload }
  });
  assert.equal(scanRes.statusCode, 200);
  const scanBody = scanRes.body as { ok: boolean; employeeId: string };
  assert.equal(scanBody.ok, true);
  assert.equal(scanBody.employeeId, participant.employeeId);

  // Verify check-in shows in report
  const reportRes = await invokeLambda({
    method: 'GET',
    path: `/v1/volunteer/activities/${activityId}/report`,
    headers: orgHeaders
  });
  assert.equal(reportRes.statusCode, 200);
  const report = reportRes.body as { checkIns: unknown[] };
  assert.equal(report.checkIns.length, 1);
});

test('integration: scan-check-in-qr — rejects invalid digital ID payload', async () => {
  const suffix = `${Date.now()}-vol-qr-bad`;

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

  const organizer = await selfRegisterApproveAndLogin({
    tenantId,
    employeeId: `E-ORG-${suffix}`,
    lineIdToken: `line-id:U-ORG-${suffix}`
  });
  const orgHeaders = { authorization: `Bearer ${organizer.accessToken}` };

  // Create activity
  const createRes = await invokeLambda({
    method: 'POST',
    path: '/v1/volunteer/activities',
    headers: orgHeaders,
    body: {
      title: `QR-Bad-${suffix}`,
      description: '',
      location: '',
      activityDate: '2026-06-15',
      startTime: '09:00',
      endTime: '17:00',
      capacity: null,
      checkInMode: 'organizer-scan'
    }
  });
  const { activityId } = createRes.body as { activityId: string };

  // Try with invalid payload
  const scanRes = await invokeLambda({
    method: 'POST',
    path: `/v1/volunteer/activities/${activityId}/scan-check-in-qr`,
    headers: orgHeaders,
    body: { digitalIdPayload: 'invalid.payload.data' }
  });
  assert.equal(scanRes.statusCode, 400);
  const body = scanRes.body as { error: string };
  assert.ok(body.error.includes('verification failed'));
});

test('integration: volunteer cancel registration and cancel activity', async () => {
  const suffix = `${Date.now()}-vol-cancel`;

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

  const organizer = await selfRegisterApproveAndLogin({
    tenantId,
    employeeId: `E-ORG-${suffix}`,
    lineIdToken: `line-id:U-ORG-${suffix}`
  });
  const orgHeaders = { authorization: `Bearer ${organizer.accessToken}` };

  const participant = await selfRegisterApproveAndLogin({
    tenantId,
    employeeId: `E-PART-${suffix}`,
    lineIdToken: `line-id:U-PART-${suffix}`
  });
  const partHeaders = { authorization: `Bearer ${participant.accessToken}` };

  // Create activity
  const createRes = await invokeLambda({
    method: 'POST',
    path: '/v1/volunteer/activities',
    headers: orgHeaders,
    body: {
      title: `Cancel-Test-${suffix}`,
      description: '',
      location: '',
      activityDate: '2026-07-01',
      startTime: '09:00',
      endTime: '17:00',
      capacity: null,
      checkInMode: 'organizer-scan'
    }
  });
  assert.equal(createRes.statusCode, 201);
  const { activityId } = createRes.body as { activityId: string };

  // Register
  const regRes = await invokeLambda({
    method: 'POST',
    path: `/v1/volunteer/activities/${activityId}/register`,
    headers: partHeaders
  });
  assert.equal(regRes.statusCode, 201);

  // Cancel registration
  const cancelRegRes = await invokeLambda({
    method: 'DELETE',
    path: `/v1/volunteer/activities/${activityId}/register`,
    headers: partHeaders
  });
  assert.equal(cancelRegRes.statusCode, 200);

  // Cancel activity
  const cancelActRes = await invokeLambda({
    method: 'DELETE',
    path: `/v1/volunteer/activities/${activityId}`,
    headers: orgHeaders
  });
  assert.equal(cancelActRes.statusCode, 200);

  // Verify cancelled
  const detailRes = await invokeLambda({
    method: 'GET',
    path: `/v1/volunteer/activities/${activityId}`
  });
  assert.equal(detailRes.statusCode, 200);
  const detail = detailRes.body as { activity: { status: string } };
  assert.equal(detail.activity.status, 'CANCELLED');
});
