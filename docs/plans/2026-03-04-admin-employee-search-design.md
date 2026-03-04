# Admin Employee Search & Default Limit Design

**Goal:** Add employee ID prefix search and default to showing the 10 most recently added employees, to handle tenants with thousands of employees.

## API Changes

Both LIFF and Admin list endpoints gain two query parameters:
- `?search=xxx` — filter by employee ID prefix via DynamoDB `begins_with(sk, 'BINDING#{search}')`
- `?limit=10` — default 10, controls how many results returned

**Behavior:**
- No search: query all bindings → filter by status → sort by `boundAt` desc → return top `limit`
- With search: query with `begins_with` → filter by status → sort by `boundAt` desc → return all matches (no limit cap)

## Repository Changes

Add `listByTenantWithPrefix(tenantId, employeeIdPrefix)` to `EmployeeBindingRepository`:
- DynamoDB: `KeyConditionExpression: pk = :pk AND begins_with(sk, :skPrefix)`
- InMemory: `.filter(b => b.employeeId.startsWith(prefix))`

## Frontend Changes

- Search input below tab bar, placeholder `搜尋工號（前綴）`
- Debounce 300ms, calls API with `?search=xxx`
- No search: shows `最近 10 筆`
- With search: shows `共 N 筆符合`
- Clear input returns to default 10

## Cost

~$0.28/month for 3,000 employees with 6,000 queries/month. Negligible.
