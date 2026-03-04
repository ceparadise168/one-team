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
