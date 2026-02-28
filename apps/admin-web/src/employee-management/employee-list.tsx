import { useEmployeeList } from './use-employee-list';
import type { EmployeeManagementApi } from './api-client';

interface EmployeeListProps {
  api: EmployeeManagementApi;
  tenantId: string;
}

export function EmployeeList({ api, tenantId }: EmployeeListProps) {
  const { employees, isLoading, error, approve, reject, refresh } = useEmployeeList({
    api,
    tenantId,
    status: 'PENDING'
  });

  return (
    <section>
      <h2>員工管理</h2>
      <button type="button" onClick={refresh}>
        重新整理
      </button>

      {isLoading && <p>載入中…</p>}
      {error && <p style={{ color: 'red' }}>錯誤：{error}</p>}

      {!isLoading && employees.length === 0 && <p>目前沒有待審核的員工申請。</p>}

      {employees.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>暱稱</th>
              <th>員工編號</th>
              <th>狀態</th>
              <th>申請時間</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr key={emp.employeeId}>
                <td>{emp.nickname ?? '-'}</td>
                <td>{emp.employeeId}</td>
                <td>{emp.accessStatus}</td>
                <td>{new Date(emp.boundAt).toLocaleString('zh-TW')}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => void approve(emp.employeeId)}
                  >
                    核准
                  </button>{' '}
                  <button
                    type="button"
                    onClick={() => void reject(emp.employeeId)}
                  >
                    拒絕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
