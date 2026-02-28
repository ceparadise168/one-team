import { useCallback, useEffect, useState } from 'react';
import { listEmployees, decideAccess, type EmployeeManagementApi } from './api-client';
import type { Employee } from './types';

interface UseEmployeeListOptions {
  api: EmployeeManagementApi;
  tenantId: string;
  status?: string;
}

interface UseEmployeeListResult {
  employees: Employee[];
  isLoading: boolean;
  error: string | null;
  actionInProgress: string | null;
  approve: (employeeId: string) => Promise<void>;
  reject: (employeeId: string) => Promise<void>;
  refresh: () => void;
}

export function useEmployeeList({
  api,
  tenantId,
  status
}: UseEmployeeListOptions): UseEmployeeListResult {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);

  const refresh = useCallback(() => setRefreshCounter((c) => c + 1), []);

  useEffect(() => {
    if (!tenantId) return;
    setIsLoading(true);
    setError(null);
    listEmployees(api, tenantId, status)
      .then(setEmployees)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Unknown error')
      )
      .finally(() => setIsLoading(false));
  }, [tenantId, status, refreshCounter]);

  const approve = useCallback(
    async (employeeId: string) => {
      setError(null);
      setActionInProgress(employeeId);
      try {
        await decideAccess(api, tenantId, employeeId, 'APPROVE', 'admin');
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : '核准失敗');
      } finally {
        setActionInProgress(null);
      }
    },
    [api, tenantId, refresh]
  );

  const reject = useCallback(
    async (employeeId: string) => {
      setError(null);
      setActionInProgress(employeeId);
      try {
        await decideAccess(api, tenantId, employeeId, 'REJECT', 'admin');
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : '拒絕失敗');
      } finally {
        setActionInProgress(null);
      }
    },
    [api, tenantId, refresh]
  );

  return { employees, isLoading, error, actionInProgress, approve, reject, refresh };
}
