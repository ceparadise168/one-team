# Admin Permissions & LIFF Management Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable authorized employees to manage approvals and permissions from a LIFF admin page inside LINE.

**Architecture:** 3 new LIFF API endpoints (list employees, decide access, update permissions), a new LIFF admin page with tabs (pending/all employees), and a services menu update changing the admin button from postback to URI.

**Tech Stack:** React 19, React Router, node:test, DynamoDB single-table, inline styles.

---

### Task 1: Add `updatePermissions` method to governance service

**Files:**
- Modify: `apps/api/src/services/employee-access-governance-service.ts:111` (after `decideAccess`)
- Test: `apps/api/src/services/employee-access-governance-service.test.ts` (find existing test file or create)

**Step 1: Check if test file exists**

Run: `ls apps/api/src/services/employee-access-governance-service.test.ts 2>/dev/null || echo "NOT FOUND"`

If NOT FOUND, the tests live in the integration test or lambda test. In that case, add a unit test section. Check existing test patterns:

Run: `grep -r "EmployeeAccessGovernanceService" apps/api/src --include="*.test.ts" -l`

**Step 2: Add `updatePermissions` method**

In `apps/api/src/services/employee-access-governance-service.ts`, add after line 111 (after the `decideAccess` method closing brace):

```typescript
  async updatePermissions(input: {
    tenantId: string;
    targetEmployeeId: string;
    callerEmployeeId: string;
    permissions: Partial<EmployeePermissions>;
  }): Promise<AccessRequestProfile> {
    if (input.targetEmployeeId === input.callerEmployeeId) {
      throw new ValidationError('Cannot modify own permissions');
    }

    const binding = await this.requireActiveBindingByEmployee({
      tenantId: input.tenantId,
      employeeId: input.targetEmployeeId,
    });

    if (binding.accessStatus !== 'APPROVED') {
      throw new ValidationError('Can only set permissions on approved employees');
    }

    binding.permissions = {
      canInvite: input.permissions.canInvite ?? binding.permissions.canInvite,
      canRemove: input.permissions.canRemove ?? binding.permissions.canRemove,
    };

    await this.employeeBindingRepository.upsert(binding);
    return this.toProfile(binding);
  }
```

**Step 3: Run tests**

Run: `pnpm --filter @one-team/api test`
Expected: All existing tests pass (no new tests needed yet — the method will be tested via integration test in Task 4).

**Step 4: Commit**

```
feat: add updatePermissions method to governance service
```

---

### Task 2: Add LIFF employee management API endpoints

**Files:**
- Modify: `apps/api/src/lambda.ts:619` (after the access-request block, before access-decision)

**Step 1: Add 3 new LIFF endpoints**

In `apps/api/src/lambda.ts`, add after line 619 (after the `accessRequestMatch` block closing brace) and before line 622 (the `accessDecisionMatch`):

```typescript
    // LIFF: list employees (requires canInvite or canRemove)
    const liffEmployeesMatch = path.match(/^\/v1\/liff\/tenants\/([^/]+)\/employees$/);
    if (method === 'GET' && liffEmployeesMatch) {
      const principal = await requireEmployeePrincipal({
        event,
        authSessionService,
        requiredTenantId: liffEmployeesMatch[1],
      });

      await employeeAccessGovernanceService.requireEmployeePermission({
        tenantId: principal.tenantId,
        lineUserId: principal.lineUserId,
        permission: 'canInvite',
      });

      const tenantId = liffEmployeesMatch[1];
      const statusFilter = event.queryStringParameters?.status;
      const bindings = await employeeBindingRepository.listByTenant(tenantId);
      const activeBindings = bindings.filter((b) => b.employmentStatus === 'ACTIVE');
      const filtered = statusFilter
        ? activeBindings.filter((b) => (b.accessStatus ?? 'PENDING') === statusFilter)
        : activeBindings;

      const employees = filtered.map((b) => ({
        employeeId: b.employeeId,
        nickname: b.nickname,
        accessStatus: b.accessStatus ?? 'PENDING',
        boundAt: b.boundAt,
        accessRequestedAt: b.accessRequestedAt,
        accessReviewedAt: b.accessReviewedAt,
        permissions: b.permissions ?? { canInvite: false, canRemove: false },
      }));

      return jsonResponse(200, { employees }, responseOptions);
    }

    // LIFF: decide employee access (requires canInvite)
    const liffDecisionMatch = path.match(
      /^\/v1\/liff\/tenants\/([^/]+)\/employees\/([^/]+)\/access-decision$/
    );
    if (method === 'POST' && liffDecisionMatch) {
      const principal = await requireEmployeePrincipal({
        event,
        authSessionService,
        requiredTenantId: liffDecisionMatch[1],
      });

      await employeeAccessGovernanceService.requireEmployeePermission({
        tenantId: principal.tenantId,
        lineUserId: principal.lineUserId,
        permission: 'canInvite',
      });

      const payload = accessDecisionSchema.parse(parseBody(event));
      const profile = await employeeAccessGovernanceService.decideAccess({
        tenantId: liffDecisionMatch[1],
        employeeId: liffDecisionMatch[2],
        reviewerId: principal.employeeId,
        decision: payload.decision,
        permissions: payload.permissions,
      });

      return jsonResponse(200, profile, responseOptions);
    }

    // LIFF: update employee permissions (requires canInvite)
    const liffPermissionsMatch = path.match(
      /^\/v1\/liff\/tenants\/([^/]+)\/employees\/([^/]+)\/permissions$/
    );
    if (method === 'PUT' && liffPermissionsMatch) {
      const principal = await requireEmployeePrincipal({
        event,
        authSessionService,
        requiredTenantId: liffPermissionsMatch[1],
      });

      await employeeAccessGovernanceService.requireEmployeePermission({
        tenantId: principal.tenantId,
        lineUserId: principal.lineUserId,
        permission: 'canInvite',
      });

      const body = parseBody(event) as Record<string, unknown>;
      const profile = await employeeAccessGovernanceService.updatePermissions({
        tenantId: liffPermissionsMatch[1],
        targetEmployeeId: liffPermissionsMatch[2],
        callerEmployeeId: principal.employeeId,
        permissions: {
          canInvite: typeof body.canInvite === 'boolean' ? body.canInvite : undefined,
          canRemove: typeof body.canRemove === 'boolean' ? body.canRemove : undefined,
        },
      });

      return jsonResponse(200, { ok: true, permissions: profile.permissions }, responseOptions);
    }
```

**Step 2: Also add admin-token PUT permissions endpoint**

In `apps/api/src/lambda.ts`, add after the existing `accessDecisionMatch` block (after line 638):

```typescript
    // Admin: update employee permissions
    const adminPermissionsMatch = path.match(
      /^\/v1\/admin\/tenants\/([^/]+)\/employees\/([^/]+)\/permissions$/
    );
    if (method === 'PUT' && adminPermissionsMatch) {
      assertAdminAuthorized(event);
      const body = parseBody(event) as Record<string, unknown>;
      const profile = await employeeAccessGovernanceService.updatePermissions({
        tenantId: adminPermissionsMatch[1],
        targetEmployeeId: adminPermissionsMatch[2],
        callerEmployeeId: getAdminActorId(event),
        permissions: {
          canInvite: typeof body.canInvite === 'boolean' ? body.canInvite : undefined,
          canRemove: typeof body.canRemove === 'boolean' ? body.canRemove : undefined,
        },
      });

      return jsonResponse(200, { ok: true, permissions: profile.permissions }, responseOptions);
    }
```

**Step 3: Run typecheck**

Run: `pnpm --filter @one-team/api exec tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```
feat: add LIFF and admin API endpoints for employee management and permissions
```

---

### Task 3: Add employee list to response with permissions field

The existing admin employee list endpoint (line 520-544) doesn't return `permissions`. Update it:

**Files:**
- Modify: `apps/api/src/lambda.ts:534-542`

**Step 1: Add permissions to admin employee list response**

In `apps/api/src/lambda.ts`, change the employee mapping (line 534-542):

Replace:
```typescript
      const employees = filtered.slice(0, limit).map(b => ({
        employeeId: b.employeeId,
        nickname: b.nickname,
        accessStatus: b.accessStatus ?? 'PENDING',
        boundAt: b.boundAt,
        accessRequestedAt: b.accessRequestedAt,
        accessReviewedAt: b.accessReviewedAt,
        accessReviewedBy: b.accessReviewedBy
      }));
```

With:
```typescript
      const employees = filtered.slice(0, limit).map(b => ({
        employeeId: b.employeeId,
        nickname: b.nickname,
        accessStatus: b.accessStatus ?? 'PENDING',
        boundAt: b.boundAt,
        accessRequestedAt: b.accessRequestedAt,
        accessReviewedAt: b.accessReviewedAt,
        accessReviewedBy: b.accessReviewedBy,
        permissions: b.permissions ?? { canInvite: false, canRemove: false },
      }));
```

**Step 2: Run tests**

Run: `pnpm --filter @one-team/api test`
Expected: All tests pass.

**Step 3: Commit**

```
feat: include permissions in admin employee list response
```

---

### Task 4: Add integration test for LIFF admin endpoints

**Files:**
- Modify: `apps/api/src/lambda.integration.test.ts`

**Step 1: Add integration test**

Add a new test at the end of the file:

```typescript
test('integration: LIFF admin — list employees, decide access, update permissions', async () => {
  const suffix = `${Date.now()}-admin`;

  // Create tenant
  const created = await invokeLambda({
    method: 'POST',
    path: '/v1/admin/tenants',
    headers: adminHeaders,
    body: {
      tenantName: `Tenant-${suffix}`,
      adminEmail: `hr+${suffix}@acme.test`,
    },
  });
  assert.equal(created.statusCode, 201);
  const tenantId = (created.body as { tenantId: string }).tenantId;

  // Create admin employee with canInvite permission
  const adminEmp = await selfRegisterApproveAndLogin({
    tenantId,
    employeeId: `E-ADMIN-${suffix}`,
    lineIdToken: `line-id:U-ADMIN-${suffix}`,
  });

  // Grant canInvite via admin API
  const grantRes = await invokeLambda({
    method: 'PUT',
    path: `/v1/admin/tenants/${tenantId}/employees/${adminEmp.employeeId}/permissions`,
    headers: adminHeaders,
    body: { canInvite: true },
  });
  assert.equal(grantRes.statusCode, 200);

  // Create a pending employee
  await invokeLambda({
    method: 'POST',
    path: '/v1/public/self-register',
    body: {
      tenantId,
      lineIdToken: `line-id:U-PENDING-${suffix}`,
      employeeId: `E-PENDING-${suffix}`,
    },
  });

  const empAdminHeaders = { authorization: `Bearer ${adminEmp.accessToken}` };

  // LIFF: list employees
  const listRes = await invokeLambda({
    method: 'GET',
    path: `/v1/liff/tenants/${tenantId}/employees?status=PENDING`,
    headers: empAdminHeaders,
  });
  assert.equal(listRes.statusCode, 200);
  const employees = (listRes.body as { employees: Array<{ employeeId: string }> }).employees;
  assert.ok(employees.some((e) => e.employeeId === `E-PENDING-${suffix}`));

  // LIFF: approve pending employee
  const decideRes = await invokeLambda({
    method: 'POST',
    path: `/v1/liff/tenants/${tenantId}/employees/E-PENDING-${suffix}/access-decision`,
    headers: empAdminHeaders,
    body: { decision: 'APPROVE' },
  });
  assert.equal(decideRes.statusCode, 200);

  // LIFF: update permissions
  const permRes = await invokeLambda({
    method: 'PUT',
    path: `/v1/liff/tenants/${tenantId}/employees/E-PENDING-${suffix}/permissions`,
    headers: empAdminHeaders,
    body: { canInvite: true },
  });
  assert.equal(permRes.statusCode, 200);
  const permBody = permRes.body as { ok: boolean; permissions: { canInvite: boolean } };
  assert.equal(permBody.ok, true);
  assert.equal(permBody.permissions.canInvite, true);

  // Verify: cannot modify own permissions
  const selfRes = await invokeLambda({
    method: 'PUT',
    path: `/v1/liff/tenants/${tenantId}/employees/${adminEmp.employeeId}/permissions`,
    headers: empAdminHeaders,
    body: { canRemove: true },
  });
  assert.equal(selfRes.statusCode, 400);
});
```

Note: Check if `selfRegisterApproveAndLogin` helper exists in the file. If not, check `volunteer.integration.test.ts` for the pattern and copy it.

**Step 2: Run tests**

Run: `pnpm check`
Expected: All tests pass.

**Step 3: Commit**

```
test: add integration test for LIFF admin endpoints
```

---

### Task 5: Change services menu admin button from postback to URI

**Files:**
- Modify: `apps/api/src/line/flex-message-templates.ts:653-693`

**Step 1: Update admin dashboard button**

In `apps/api/src/line/flex-message-templates.ts`, replace lines 653-693 (the admin bubble):

```typescript
  if (options?.isAdmin) {
    const adminUrl = options.accessToken
      ? `${liffWebBase}/admin?accessToken=${encodeURIComponent(options.accessToken)}&tenantId=${encodeURIComponent(options?.tenantId ?? '')}&refreshToken=${encodeURIComponent(options?.refreshToken ?? '')}`
      : `${liffWebBase}/admin`;

    bubbles.push({
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '管理後台',
            weight: 'bold',
            size: 'lg',
          },
          {
            type: 'text',
            text: '審核員工申請、管理權限',
            margin: 'sm',
            color: '#666666',
            wrap: true,
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            action: {
              type: 'uri',
              label: '管理後台',
              uri: adminUrl,
            },
            style: 'primary',
            color: '#1a73e8',
          },
        ],
      },
    });
  }
```

**Step 2: Run tests**

Run: `pnpm check`
Expected: All tests pass.

**Step 3: Commit**

```
feat: change admin dashboard button from postback to URI action
```

---

### Task 6: Create LIFF admin page hooks

**Files:**
- Create: `apps/liff-web/src/features/admin/use-admin.ts`

**Step 1: Create the data hooks file**

```typescript
import { useState, useEffect, useCallback } from 'react';

interface Employee {
  employeeId: string;
  nickname: string | null;
  accessStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  boundAt: string;
  accessRequestedAt?: string;
  accessReviewedAt?: string;
  permissions: { canInvite: boolean; canRemove: boolean };
}

export type { Employee };

export function useEmployees(
  apiBaseUrl: string,
  accessToken: string,
  tenantId: string,
  status?: string
) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    const url = status
      ? `${apiBaseUrl}/v1/liff/tenants/${tenantId}/employees?status=${status}`
      : `${apiBaseUrl}/v1/liff/tenants/${tenantId}/employees`;
    fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 403 ? '您沒有管理權限' : '載入失敗');
        return r.json();
      })
      .then((data) => {
        setEmployees(data.employees);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiBaseUrl, accessToken, tenantId, status]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { employees, loading, error, refresh };
}

export async function decideEmployeeAccess(
  apiBaseUrl: string,
  accessToken: string,
  tenantId: string,
  employeeId: string,
  decision: 'APPROVE' | 'REJECT'
): Promise<void> {
  const res = await fetch(
    `${apiBaseUrl}/v1/liff/tenants/${tenantId}/employees/${employeeId}/access-decision`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ decision }),
    }
  );
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || '操作失敗');
  }
}

export async function updateEmployeePermissions(
  apiBaseUrl: string,
  accessToken: string,
  tenantId: string,
  employeeId: string,
  permissions: { canInvite?: boolean; canRemove?: boolean }
): Promise<void> {
  const res = await fetch(
    `${apiBaseUrl}/v1/liff/tenants/${tenantId}/employees/${employeeId}/permissions`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(permissions),
    }
  );
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || '操作失敗');
  }
}
```

**Step 2: Typecheck**

Run: `pnpm --filter @one-team/liff-web exec tsc --noEmit`

**Step 3: Commit**

```
feat: add admin page data hooks
```

---

### Task 7: Create LIFF admin page component

**Files:**
- Create: `apps/liff-web/src/features/admin/admin-page.tsx`
- Modify: `apps/liff-web/src/main.tsx:11` (add import and route)

**Step 1: Create the admin page**

```tsx
import { useState } from 'react';
import { useAuth } from '../../auth-context';
import {
  useEmployees,
  decideEmployeeAccess,
  updateEmployeePermissions,
} from './use-admin';

type Tab = 'pending' | 'all';

export function AdminPage() {
  const { apiBaseUrl, accessToken, tenantId, employeeId: myEmployeeId } = useAuth();
  const [tab, setTab] = useState<Tab>('pending');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const {
    employees: pendingEmployees,
    loading: pendingLoading,
    error: pendingError,
    refresh: refreshPending,
  } = useEmployees(apiBaseUrl, accessToken, tenantId, 'PENDING');

  const {
    employees: allEmployees,
    loading: allLoading,
    error: allError,
    refresh: refreshAll,
  } = useEmployees(apiBaseUrl, accessToken, tenantId, 'APPROVED');

  const loading = tab === 'pending' ? pendingLoading : allLoading;
  const error = tab === 'pending' ? pendingError : allError;

  if (error === '您沒有管理權限') {
    return (
      <div style={styles.container}>
        <div style={styles.errorCard}>
          <p style={styles.errorTitle}>無法存取</p>
          <p style={styles.errorDesc}>您沒有管理權限，請聯繫管理員。</p>
        </div>
      </div>
    );
  }

  async function handleDecision(empId: string, decision: 'APPROVE' | 'REJECT') {
    try {
      setActionMessage(null);
      await decideEmployeeAccess(apiBaseUrl, accessToken, tenantId, empId, decision);
      setActionMessage(decision === 'APPROVE' ? '已核准' : '已拒絕');
      refreshPending();
      refreshAll();
    } catch (e) {
      setActionMessage((e as Error).message);
    }
  }

  async function handleTogglePermission(
    empId: string,
    permission: 'canInvite' | 'canRemove',
    value: boolean
  ) {
    try {
      setActionMessage(null);
      await updateEmployeePermissions(apiBaseUrl, accessToken, tenantId, empId, {
        [permission]: value,
      });
      refreshAll();
    } catch (e) {
      setActionMessage((e as Error).message);
    }
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>管理後台</h1>

      {/* Tab bar */}
      <div style={styles.tabBar}>
        <button
          style={tab === 'pending' ? styles.tabActive : styles.tab}
          onClick={() => setTab('pending')}
        >
          待審核{pendingEmployees.length > 0 ? ` (${pendingEmployees.length})` : ''}
        </button>
        <button
          style={tab === 'all' ? styles.tabActive : styles.tab}
          onClick={() => setTab('all')}
        >
          全部員工
        </button>
      </div>

      {actionMessage && <p style={styles.message}>{actionMessage}</p>}

      {loading ? (
        <p style={styles.empty}>載入中...</p>
      ) : tab === 'pending' ? (
        /* Pending tab */
        pendingEmployees.length === 0 ? (
          <p style={styles.empty}>沒有待審核的申請</p>
        ) : (
          <div style={styles.list}>
            {pendingEmployees.map((emp) => (
              <div key={emp.employeeId} style={styles.card}>
                <div style={styles.cardHeader}>
                  <span style={styles.cardName}>{emp.nickname || emp.employeeId}</span>
                  <span style={styles.pendingBadge}>待審核</span>
                </div>
                <p style={styles.cardMeta}>
                  {emp.employeeId}
                  {emp.accessRequestedAt &&
                    ` · ${new Date(emp.accessRequestedAt).toLocaleDateString('zh-TW')}`}
                </p>
                <div style={styles.actionRow}>
                  <button
                    style={styles.approveBtn}
                    onClick={() => handleDecision(emp.employeeId, 'APPROVE')}
                  >
                    核准
                  </button>
                  <button
                    style={styles.rejectBtn}
                    onClick={() => handleDecision(emp.employeeId, 'REJECT')}
                  >
                    拒絕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : /* All employees tab */
      allEmployees.length === 0 ? (
        <p style={styles.empty}>尚無已核准的員工</p>
      ) : (
        <div style={styles.list}>
          {allEmployees.map((emp) => {
            const isSelf = emp.employeeId === myEmployeeId;
            return (
              <div key={emp.employeeId} style={styles.card}>
                <div style={styles.cardHeader}>
                  <span style={styles.cardName}>{emp.nickname || emp.employeeId}</span>
                  <span style={styles.approvedBadge}>已核准</span>
                </div>
                <p style={styles.cardMeta}>{emp.employeeId}</p>
                <div style={styles.permissionRow}>
                  <label style={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={emp.permissions.canInvite}
                      disabled={isSelf}
                      onChange={(e) =>
                        handleTogglePermission(emp.employeeId, 'canInvite', e.target.checked)
                      }
                    />
                    <span>可審核邀請</span>
                  </label>
                  <label style={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={emp.permissions.canRemove}
                      disabled={isSelf}
                      onChange={(e) =>
                        handleTogglePermission(emp.employeeId, 'canRemove', e.target.checked)
                      }
                    />
                    <span>可移除員工</span>
                  </label>
                </div>
                {isSelf && <p style={styles.selfNote}>無法修改自己的權限</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 16, fontFamily: 'sans-serif', maxWidth: 480, margin: '0 auto' },
  title: { fontSize: 22, margin: '0 0 16px 0' },
  tabBar: {
    display: 'flex',
    gap: 0,
    marginBottom: 16,
    borderBottom: '2px solid #e0e0e0',
  },
  tab: {
    flex: 1,
    padding: '10px 0',
    border: 'none',
    background: 'none',
    fontSize: 15,
    color: '#999',
    cursor: 'pointer',
    borderBottom: '2px solid transparent',
    marginBottom: -2,
  },
  tabActive: {
    flex: 1,
    padding: '10px 0',
    border: 'none',
    background: 'none',
    fontSize: 15,
    color: '#1DB446',
    fontWeight: 'bold',
    cursor: 'pointer',
    borderBottom: '2px solid #1DB446',
    marginBottom: -2,
  },
  message: { textAlign: 'center', color: '#1a73e8', marginTop: 8, marginBottom: 8, fontSize: 14 },
  empty: { color: '#999', textAlign: 'center', marginTop: 40 },
  list: { display: 'flex', flexDirection: 'column', gap: 12 },
  card: {
    padding: 16,
    border: '1px solid #e0e0e0',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardName: { fontSize: 16, fontWeight: 'bold' },
  cardMeta: { margin: '4px 0 12px 0', fontSize: 13, color: '#666' },
  pendingBadge: {
    padding: '2px 10px',
    borderRadius: 12,
    backgroundColor: '#fff3e0',
    color: '#e65100',
    fontSize: 12,
    fontWeight: 'bold',
  },
  approvedBadge: {
    padding: '2px 10px',
    borderRadius: 12,
    backgroundColor: '#e8f5e9',
    color: '#2e7d32',
    fontSize: 12,
    fontWeight: 'bold',
  },
  actionRow: { display: 'flex', gap: 8 },
  approveBtn: {
    flex: 1,
    padding: '10px 0',
    backgroundColor: '#1DB446',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  rejectBtn: {
    flex: 1,
    padding: '10px 0',
    backgroundColor: '#fff',
    color: '#e74c3c',
    border: '1px solid #e74c3c',
    borderRadius: 8,
    fontSize: 14,
    cursor: 'pointer',
  },
  permissionRow: { display: 'flex', gap: 16 },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 14,
    color: '#333',
    cursor: 'pointer',
  },
  selfNote: { marginTop: 6, fontSize: 12, color: '#999' },
  errorCard: {
    marginTop: 60,
    padding: 24,
    textAlign: 'center',
    border: '1px solid #e0e0e0',
    borderRadius: 12,
  },
  errorTitle: { fontSize: 18, fontWeight: 'bold', margin: '0 0 8px 0' },
  errorDesc: { fontSize: 14, color: '#666', margin: 0 },
};
```

**Step 2: Add route in main.tsx**

In `apps/liff-web/src/main.tsx`, add import after line 11:
```typescript
import { AdminPage } from './features/admin/admin-page';
```

Add route after line 34 (after the report route):
```tsx
          <Route path="/admin" element={<AdminPage />} />
```

**Step 3: Typecheck**

Run: `pnpm --filter @one-team/liff-web exec tsc --noEmit`

**Step 4: Commit**

```
feat: add LIFF admin page with approval and permission management
```

---

### Task 8: Final check and deploy

**Step 1: Run full check suite**

Run: `pnpm check`
Expected: All tests pass, lint clean, typecheck clean.

**Step 2: Build and deploy**

Follow the deploy skill:
1. `pnpm build`
2. CDK deploy
3. Rebuild liff-web with `VITE_API_BASE_URL`
4. Upload to S3 + invalidate CloudFront

**Step 3: Commit**

```
chore: admin permissions and LIFF management page complete
```
