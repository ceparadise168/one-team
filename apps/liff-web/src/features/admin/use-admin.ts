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

export const ERROR_NO_PERMISSION = '您沒有管理權限';

export function useEmployees(
  apiBaseUrl: string,
  accessToken: string,
  tenantId: string,
  status?: 'PENDING' | 'APPROVED' | 'REJECTED',
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
