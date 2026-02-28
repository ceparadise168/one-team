import type { Employee } from './types';

export interface EmployeeManagementApi {
  baseUrl: string;
  adminToken: string;
}

export async function listEmployees(
  api: EmployeeManagementApi,
  tenantId: string,
  status?: string
): Promise<Employee[]> {
  const url = new URL(`${api.baseUrl}/v1/admin/tenants/${tenantId}/employees`);
  if (status) {
    url.searchParams.set('status', status);
  }
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${api.adminToken}` }
  });
  if (!response.ok) {
    throw new Error(`listEmployees failed: ${response.status}`);
  }
  const data = (await response.json()) as { employees: Employee[] };
  return data.employees;
}

export async function decideAccess(
  api: EmployeeManagementApi,
  tenantId: string,
  employeeId: string,
  decision: 'APPROVE' | 'REJECT',
  reviewerId: string
): Promise<void> {
  const response = await fetch(
    `${api.baseUrl}/v1/admin/tenants/${tenantId}/employees/${employeeId}/access-decision`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${api.adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ decision, reviewerId })
    }
  );
  if (!response.ok) {
    throw new Error(`decideAccess failed: ${response.status}`);
  }
}
