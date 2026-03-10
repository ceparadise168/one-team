import { useState, useEffect } from 'react';
import { useAuth } from '../../auth-context';
import {
  useEmployees,
  decideEmployeeAccess,
  updateEmployeePermissions,
  offboardEmployee,
  ERROR_NO_PERMISSION,
} from './use-admin';

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

type Tab = 'pending' | 'all';

export function AdminPage() {
  const { apiBaseUrl, accessToken, tenantId, employeeId: myEmployeeId } = useAuth();
  const [tab, setTab] = useState<Tab>('pending');
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const [removeTarget, setRemoveTarget] = useState<{ employeeId: string; name: string } | null>(null);
  const [removeConfirmInput, setRemoveConfirmInput] = useState('');
  const [removing, setRemoving] = useState(false);

  const status = tab === 'pending' ? 'PENDING' as const : 'APPROVED' as const;
  const {
    employees,
    total,
    loading,
    error,
    refresh,
  } = useEmployees(apiBaseUrl, accessToken, tenantId, status, debouncedSearch || undefined);

  if (error === ERROR_NO_PERMISSION) {
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
      refresh();
    } catch (e) {
      setActionMessage((e as Error).message);
    }
  }

  async function handleOffboard() {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      setActionMessage(null);
      await offboardEmployee(apiBaseUrl, accessToken, tenantId, removeTarget.employeeId);
      setActionMessage(`已移除 ${removeTarget.name}`);
      setRemoveTarget(null);
      setRemoveConfirmInput('');
      refresh();
    } catch (e) {
      setActionMessage((e as Error).message);
    } finally {
      setRemoving(false);
    }
  }

  // Check if current user has canRemove permission from employee list
  const myRecord = employees.find(e => e.employeeId === myEmployeeId);
  const canRemove = myRecord?.permissions.canRemove ?? false;

  async function handleTogglePermission(
    empId: string,
    permission: 'canInvite' | 'canRemove' | 'canManageBooking',
    value: boolean
  ) {
    try {
      setActionMessage(null);
      await updateEmployeePermissions(apiBaseUrl, accessToken, tenantId, empId, {
        [permission]: value,
      });
      refresh();
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
          待審核
        </button>
        <button
          style={tab === 'all' ? styles.tabActive : styles.tab}
          onClick={() => setTab('all')}
        >
          全部員工
        </button>
      </div>

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
            ? `共 ${total} 筆符合`
            : `最近 ${employees.length} 筆（共 ${total} 筆）`}
        </p>
      )}

      {actionMessage && <p style={styles.message}>{actionMessage}</p>}

      {loading ? (
        <p style={styles.empty}>載入中...</p>
      ) : employees.length === 0 ? (
        <p style={styles.empty}>
          {tab === 'pending' ? '沒有待審核的申請' : '尚無已核准的員工'}
        </p>
      ) : tab === 'pending' ? (
        <div style={styles.list}>
          {employees.map((emp) => (
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
      ) : (
        <div style={styles.list}>
          {employees.map((emp) => {
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
                  <label style={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={emp.permissions.canManageBooking}
                      disabled={isSelf}
                      onChange={(e) =>
                        handleTogglePermission(emp.employeeId, 'canManageBooking', e.target.checked)
                      }
                    />
                    <span>可管理預約</span>
                  </label>
                </div>
                {isSelf && <p style={styles.selfNote}>無法修改自己的權限</p>}
                {canRemove && !isSelf && (
                  <button
                    style={styles.removeBtn}
                    onClick={() => setRemoveTarget({ employeeId: emp.employeeId, name: emp.nickname || emp.employeeId })}
                  >
                    移除員工
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {removeTarget && (
        <div style={styles.dialogOverlay}>
          <div style={styles.dialog}>
            <p style={styles.dialogTitle}>確定要移除 {removeTarget.name}？</p>
            <p style={styles.dialogWarning}>此操作不可逆。</p>
            <p style={styles.dialogLabel}>請輸入員工編號確認：</p>
            <input
              type="text"
              value={removeConfirmInput}
              onChange={(e) => setRemoveConfirmInput(e.target.value)}
              placeholder={removeTarget.employeeId}
              style={styles.dialogInput}
            />
            <div style={styles.dialogActions}>
              <button
                onClick={() => { setRemoveTarget(null); setRemoveConfirmInput(''); }}
                style={styles.dialogCancelBtn}
              >
                取消
              </button>
              <button
                onClick={handleOffboard}
                disabled={removeConfirmInput !== removeTarget.employeeId || removing}
                style={{
                  ...styles.dialogConfirmBtn,
                  opacity: removeConfirmInput !== removeTarget.employeeId || removing ? 0.4 : 1,
                }}
              >
                {removing ? '移除中...' : '確認移除'}
              </button>
            </div>
          </div>
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
  removeBtn: {
    marginTop: 10,
    padding: '6px 14px',
    backgroundColor: '#fff',
    color: '#e74c3c',
    border: '1px solid #e74c3c',
    borderRadius: 6,
    fontSize: 13,
    cursor: 'pointer',
  },
  dialogOverlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  dialog: {
    backgroundColor: '#fff', borderRadius: 12, padding: 24,
    maxWidth: 320, width: '90%',
  },
  dialogTitle: { fontSize: 16, fontWeight: 'bold', margin: '0 0 4px 0' },
  dialogWarning: { fontSize: 13, color: '#e74c3c', margin: '0 0 16px 0' },
  dialogLabel: { fontSize: 14, color: '#333', margin: '0 0 8px 0' },
  dialogInput: {
    width: '100%', padding: '8px 10px', border: '1px solid #ddd',
    borderRadius: 6, fontSize: 14, boxSizing: 'border-box' as const, marginBottom: 16,
  },
  dialogActions: { display: 'flex', gap: 12 },
  dialogCancelBtn: {
    flex: 1, padding: '10px 0', backgroundColor: '#f5f5f5', color: '#333',
    border: '1px solid #ddd', borderRadius: 8, fontSize: 14, cursor: 'pointer',
  },
  dialogConfirmBtn: {
    flex: 1, padding: '10px 0', backgroundColor: '#e74c3c', color: '#fff',
    border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 'bold', cursor: 'pointer',
  },
};
