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
