import { useState } from 'react';
import { useEmployeeList } from './use-employee-list';
import type { EmployeeManagementApi } from './api-client';

const STATUS_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'PENDING', label: '待審核' },
  { value: 'APPROVED', label: '已核准' },
  { value: 'REJECTED', label: '已拒絕' },
] as const;

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#e67e22',
  APPROVED: '#27ae60',
  REJECTED: '#e74c3c',
};

interface EmployeeListProps {
  api: EmployeeManagementApi;
  tenantId: string;
}

export function EmployeeList({ api, tenantId }: EmployeeListProps) {
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const { employees, isLoading, error, approve, reject, refresh } = useEmployeeList({
    api,
    tenantId,
    status: statusFilter || undefined
  });

  const filtered = searchQuery
    ? employees.filter((emp) =>
        emp.employeeId.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : employees;

  return (
    <section>
      <h2>員工管理</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setStatusFilter(opt.value)}
            style={{
              padding: '6px 14px',
              border: statusFilter === opt.value ? '2px solid #1a73e8' : '1px solid #ccc',
              borderRadius: 4,
              background: statusFilter === opt.value ? '#e8f0fe' : '#fff',
              fontWeight: statusFilter === opt.value ? 'bold' : 'normal',
              cursor: 'pointer',
            }}
          >
            {opt.label}
          </button>
        ))}

        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜尋工號…"
          style={{ marginLeft: 'auto', padding: '6px 10px', width: 180, border: '1px solid #ccc', borderRadius: 4 }}
        />

        <button type="button" onClick={refresh} style={{ padding: '6px 14px' }}>
          重新整理
        </button>
      </div>

      {isLoading && <p>載入中…</p>}
      {error && <p style={{ color: 'red' }}>錯誤：{error}</p>}

      {!isLoading && filtered.length === 0 && (
        <p style={{ color: '#999' }}>
          {searchQuery ? `找不到工號包含「${searchQuery}」的員工。` : '目前沒有符合條件的員工。'}
        </p>
      )}

      {filtered.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
              <th style={{ padding: '8px 4px' }}>暱稱</th>
              <th style={{ padding: '8px 4px' }}>員工編號</th>
              <th style={{ padding: '8px 4px' }}>狀態</th>
              <th style={{ padding: '8px 4px' }}>申請時間</th>
              <th style={{ padding: '8px 4px' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((emp) => (
              <tr key={emp.employeeId} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '8px 4px' }}>{emp.nickname ?? '-'}</td>
                <td style={{ padding: '8px 4px', fontFamily: 'monospace' }}>{emp.employeeId}</td>
                <td style={{ padding: '8px 4px', color: STATUS_COLORS[emp.accessStatus] ?? '#333', fontWeight: 'bold' }}>
                  {emp.accessStatus}
                </td>
                <td style={{ padding: '8px 4px' }}>{new Date(emp.boundAt).toLocaleString('zh-TW')}</td>
                <td style={{ padding: '8px 4px' }}>
                  {emp.accessStatus !== 'APPROVED' && (
                    <button
                      type="button"
                      onClick={() => void approve(emp.employeeId)}
                      style={{ marginRight: 4 }}
                    >
                      核准
                    </button>
                  )}
                  {emp.accessStatus !== 'REJECTED' && (
                    <button
                      type="button"
                      onClick={() => void reject(emp.employeeId)}
                    >
                      拒絕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
