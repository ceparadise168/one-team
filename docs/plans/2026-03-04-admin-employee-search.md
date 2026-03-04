# Admin Employee Search & Default Limit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add employee ID prefix search and default to showing the 10 most recently added employees in the admin page.

**Architecture:** Add `listByTenantWithPrefix` to the repository layer, update both LIFF and admin list endpoints to accept `search` param and sort by `boundAt` desc with default limit 10, update the frontend `useEmployees` hook with a `search` param and add a search input to the admin page.

**Tech Stack:** React 19, node:test, DynamoDB single-table, inline styles.

---

### Task 1: Add `listByTenantWithPrefix` to repository

**Files:**
- Modify: `apps/api/src/repositories/invitation-binding-repository.ts:35-42` (interface + InMemory)
- Modify: `apps/api/src/repositories/dynamodb-repositories.ts:513-529` (DynamoDB impl)

**Step 1: Add method to interface**

In `apps/api/src/repositories/invitation-binding-repository.ts`, add after line 40 (`listByTenant`):

```typescript
  listByTenantWithPrefix(tenantId: string, employeeIdPrefix: string): Promise<EmployeeBindingRecord[]>;
```

**Step 2: Add InMemory implementation**

In the same file, add after the `listByTenant` method (after line 171):

```typescript
  async listByTenantWithPrefix(tenantId: string, employeeIdPrefix: string): Promise<EmployeeBindingRecord[]> {
    return [...this.byEmployee.values()]
      .filter(r => r.tenantId === tenantId && r.employeeId.startsWith(employeeIdPrefix))
      .map(normalizeEmployeeBindingRecord);
  }
```

**Step 3: Add DynamoDB implementation**

In `apps/api/src/repositories/dynamodb-repositories.ts`, add after the `listByTenant` method (after line 529):

```typescript
  async listByTenantWithPrefix(tenantId: string, employeeIdPrefix: string): Promise<EmployeeBindingRecord[]> {
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}`,
          ':skPrefix': `BINDING#${employeeIdPrefix}`
        }
      })
    );

    return (response.Items ?? [])
      .map(item => stripMetadata<EmployeeBindingRecord>(item as Record<string, unknown>))
      .filter((r): r is EmployeeBindingRecord => r !== null)
      .map(normalizeEmployeeBindingRecord);
  }
```

**Step 4: Run typecheck**

Run: `pnpm --filter @one-team/api exec tsc --noEmit`
Expected: No errors.

**Step 5: Commit**

```
feat: add listByTenantWithPrefix to employee binding repository
```

---

### Task 2: Update LIFF list endpoint with search and sort

**Files:**
- Modify: `apps/api/src/lambda.ts:644-661` (LIFF list employees endpoint)

**Step 1: Update the LIFF list endpoint**

Replace the body of the LIFF list employees handler (lines 644-661) with:

```typescript
      const tenantId = liffEmployeesMatch[1];
      const statusFilter = event.queryStringParameters?.status;
      const search = event.queryStringParameters?.search;
      const limitParam = event.queryStringParameters?.limit;
      const limit = search ? undefined : (limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 10, 1), 200) : 10);

      const bindings = search
        ? await employeeBindingRepository.listByTenantWithPrefix(tenantId, search)
        : await employeeBindingRepository.listByTenant(tenantId);
      const activeBindings = bindings.filter((b) => b.employmentStatus === 'ACTIVE');
      const filtered = statusFilter
        ? activeBindings.filter((b) => (b.accessStatus ?? 'PENDING') === statusFilter)
        : activeBindings;

      const sorted = filtered.sort((a, b) => {
        const aTime = a.boundAt ?? '';
        const bTime = b.boundAt ?? '';
        return bTime.localeCompare(aTime);
      });

      const result = limit ? sorted.slice(0, limit) : sorted;

      const employees = result.map((b) => ({
        employeeId: b.employeeId,
        nickname: b.nickname,
        accessStatus: b.accessStatus ?? 'PENDING',
        boundAt: b.boundAt,
        accessRequestedAt: b.accessRequestedAt,
        accessReviewedAt: b.accessReviewedAt,
        permissions: b.permissions ?? DEFAULT_EMPLOYEE_PERMISSIONS,
      }));

      return jsonResponse(200, { employees, total: filtered.length }, responseOptions);
```

Note: response now includes `total` so the frontend can show "顯示 10/150 筆".

**Step 2: Update admin list endpoint similarly**

In `apps/api/src/lambda.ts`, update the admin list endpoint (lines 529-550) the same way:

```typescript
      const tenantId = employeesListMatch[1];
      const statusFilter = event.queryStringParameters?.status;
      const search = event.queryStringParameters?.search;
      const limitParam = event.queryStringParameters?.limit;
      const limit = search ? undefined : (limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 10, 1), 200) : 10);

      const bindings = search
        ? await employeeBindingRepository.listByTenantWithPrefix(tenantId, search)
        : await employeeBindingRepository.listByTenant(tenantId);
      const activeBindings = bindings.filter(b => b.employmentStatus === 'ACTIVE');
      const filtered = statusFilter
        ? activeBindings.filter(b => (b.accessStatus ?? 'PENDING') === statusFilter)
        : activeBindings;

      const sorted = filtered.sort((a, b) => {
        const aTime = a.boundAt ?? '';
        const bTime = b.boundAt ?? '';
        return bTime.localeCompare(aTime);
      });

      const result = limit ? sorted.slice(0, limit) : sorted;

      const employees = result.map(b => ({
        employeeId: b.employeeId,
        nickname: b.nickname,
        accessStatus: b.accessStatus ?? 'PENDING',
        boundAt: b.boundAt,
        accessRequestedAt: b.accessRequestedAt,
        accessReviewedAt: b.accessReviewedAt,
        accessReviewedBy: b.accessReviewedBy,
        permissions: b.permissions ?? DEFAULT_EMPLOYEE_PERMISSIONS,
      }));

      return jsonResponse(200, { employees, total: filtered.length }, responseOptions);
```

**Step 3: Run typecheck and tests**

Run: `pnpm --filter @one-team/api test`
Expected: All tests pass.

**Step 4: Commit**

```
feat: add search and sort-by-recent to employee list endpoints
```

---

### Task 3: Add integration test for search

**Files:**
- Modify: `apps/api/src/lambda.integration.test.ts`

**Step 1: Add test at end of file (before the closing helper function)**

```typescript
test('integration: LIFF admin — search employees by ID prefix', async () => {
  const suffix = `${Date.now()}-search`;

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

  // Create admin with canInvite
  const adminEmp = await selfRegisterApproveAndLogin({
    tenantId,
    employeeId: `E-ADM-${suffix}`,
    lineIdToken: `line-id:U-ADM-${suffix}`,
  });
  await invokeLambda({
    method: 'PUT',
    path: `/v1/admin/tenants/${tenantId}/employees/${adminEmp.employeeId}/permissions`,
    headers: adminHeaders,
    body: { canInvite: true },
  });

  // Create employees with different prefixes
  for (const id of [`AAA-${suffix}`, `AAB-${suffix}`, `BBB-${suffix}`]) {
    await invokeLambda({
      method: 'POST',
      path: '/v1/public/self-register',
      body: { tenantId, lineIdToken: `line-id:${id}`, employeeId: id },
    });
  }

  const empAdminHeaders = { authorization: `Bearer ${adminEmp.accessToken}` };

  // Search with prefix "AA" — should match AAA and AAB
  const searchRes = await invokeLambda({
    method: 'GET',
    path: `/v1/liff/tenants/${tenantId}/employees?status=PENDING&search=AA`,
    headers: empAdminHeaders,
  });
  assert.equal(searchRes.statusCode, 200);
  const body = searchRes.body as { employees: Array<{ employeeId: string }>; total: number };
  assert.equal(body.total, 2);
  assert.equal(body.employees.length, 2);
  assert.ok(body.employees.every((e) => e.employeeId.startsWith('AA')));

  // Default (no search) — should return with total and limited results
  const defaultRes = await invokeLambda({
    method: 'GET',
    path: `/v1/liff/tenants/${tenantId}/employees?status=PENDING`,
    headers: empAdminHeaders,
  });
  assert.equal(defaultRes.statusCode, 200);
  const defaultBody = defaultRes.body as { employees: Array<{ employeeId: string }>; total: number };
  assert.ok(defaultBody.total >= 3);
  assert.ok(defaultBody.employees.length <= 10);
});
```

**Step 2: Run tests**

Run: `pnpm check`
Expected: All tests pass.

**Step 3: Commit**

```
test: add integration test for employee search by prefix
```

---

### Task 4: Update frontend useEmployees hook

**Files:**
- Modify: `apps/liff-web/src/features/admin/use-admin.ts:17-51`

**Step 1: Add `search` param and `total` to the hook**

Replace the `useEmployees` function with:

```typescript
export function useEmployees(
  apiBaseUrl: string,
  accessToken: string,
  tenantId: string,
  status?: string,
  search?: string
) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    const url = `${apiBaseUrl}/v1/liff/tenants/${tenantId}/employees?${params.toString()}`;
    fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 403 ? ERROR_NO_PERMISSION : '載入失敗');
        return r.json();
      })
      .then((data) => {
        setEmployees(data.employees);
        setTotal(data.total ?? data.employees.length);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiBaseUrl, accessToken, tenantId, status, search]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { employees, total, loading, error, refresh };
}
```

**Step 2: Typecheck**

Run: `pnpm --filter @one-team/liff-web exec tsc --noEmit`

**Step 3: Commit**

```
feat: add search param to useEmployees hook
```

---

### Task 5: Add search input to admin page

**Files:**
- Modify: `apps/liff-web/src/features/admin/admin-page.tsx`

**Step 1: Add search state and debounce**

Add imports and state at the top of the component (after existing state declarations):

```typescript
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);
```

**Step 2: Pass search to useEmployees**

Update both `useEmployees` calls to include `debouncedSearch || undefined`:

```typescript
  const {
    employees: pendingEmployees,
    total: pendingTotal,
    loading: pendingLoading,
    error: pendingError,
    refresh: refreshPending,
  } = useEmployees(apiBaseUrl, accessToken, tenantId, 'PENDING', debouncedSearch || undefined);

  const {
    employees: allEmployees,
    total: allTotal,
    loading: allLoading,
    error: allError,
    refresh: refreshAll,
  } = useEmployees(apiBaseUrl, accessToken, tenantId, 'APPROVED', debouncedSearch || undefined);
```

**Step 3: Add search input UI**

Add after the tab bar div (after line 90), before `{actionMessage && ...}`:

```tsx
      {/* Search */}
      <input
        type="text"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder="搜尋工號（前綴）"
        style={styles.searchInput}
      />

      {/* Result count */}
      {!loading && (
        <p style={styles.resultCount}>
          {debouncedSearch
            ? `共 ${tab === 'pending' ? pendingTotal : allTotal} 筆符合`
            : `最近 ${tab === 'pending' ? pendingEmployees.length : allEmployees.length} 筆（共 ${tab === 'pending' ? pendingTotal : allTotal} 筆）`}
        </p>
      )}
```

**Step 4: Add styles**

Add to the `styles` object:

```typescript
  searchInput: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #e0e0e0',
    borderRadius: 8,
    fontSize: 15,
    marginBottom: 8,
    boxSizing: 'border-box' as const,
    outline: 'none',
  },
  resultCount: {
    fontSize: 13,
    color: '#999',
    margin: '0 0 12px 0',
  },
```

**Step 5: Add useEffect import if not present**

Ensure `useEffect` is imported:

```typescript
import { useState, useEffect } from 'react';
```

**Step 6: Typecheck**

Run: `pnpm --filter @one-team/liff-web exec tsc --noEmit`

**Step 7: Commit**

```
feat: add employee search input to admin page
```

---

### Task 6: Final check and deploy

**Step 1: Run full check suite**

Run: `pnpm check`
Expected: All tests pass, lint clean, typecheck clean.

**Step 2: Deploy**

Follow the deploy skill.

**Step 3: Commit**

```
feat: admin employee search with prefix matching and default limit
```
