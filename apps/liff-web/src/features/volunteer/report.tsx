import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../../auth-context';
import { useReport } from './use-volunteer';

export function Report() {
  const { apiBaseUrl, accessToken } = useAuth();
  const { activityId } = useParams<{ activityId: string }>();
  const { report, loading, error } = useReport(apiBaseUrl, accessToken, activityId ?? '');

  if (loading) return <div style={styles.container}><p>載入中...</p></div>;
  if (error || !report) {
    return (
      <div style={styles.container}>
        <p style={styles.error}>{error || '無法載入報名名單'}</p>
      </div>
    );
  }

  const checkedInMap = new Map(
    report.checkIns.map((c) => [c.employeeId, c])
  );

  async function handleExportCsv() {
    try {
      const res = await fetch(
        `${apiBaseUrl}/v1/volunteer/activities/${activityId}/report/export`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const csv = await res.text();
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report-${activityId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('匯出失敗');
    }
  }

  return (
    <div style={styles.container}>
      <Link to={`/volunteer/${activityId}`} style={styles.backLink}>
        ← 返回活動
      </Link>

      <h1 style={styles.title}>報名名單</h1>
      <p style={styles.subtitle}>{report.activity.title}</p>

      <div style={styles.summary}>
        <div style={styles.summaryItem}>
          <span style={styles.summaryNumber}>{report.registrations.length}</span>
          <span style={styles.summaryLabel}>已報名</span>
        </div>
        <div style={styles.summaryItem}>
          <span style={styles.summaryNumber}>{report.checkIns.length}</span>
          <span style={styles.summaryLabel}>已打卡</span>
        </div>
      </div>

      <button onClick={handleExportCsv} style={styles.exportBtn}>
        匯出 CSV
      </button>

      <div style={styles.table}>
        <div style={styles.tableHeader}>
          <span style={styles.colId}>員工 ID</span>
          <span style={styles.colDate}>報名時間</span>
          <span style={styles.colCheck}>打卡</span>
        </div>
        {report.registrations.map((reg) => {
          const checkIn = checkedInMap.get(reg.employeeId);
          return (
            <div key={reg.employeeId} style={styles.tableRow}>
              <span style={styles.colId}>{reg.employeeId}</span>
              <span style={styles.colDate}>
                {new Date(reg.registeredAt).toLocaleDateString('zh-TW', {
                  month: '2-digit',
                  day: '2-digit',
                })}
              </span>
              <span style={styles.colCheck}>
                {checkIn ? (
                  <span style={styles.checkMark}>
                    {new Date(checkIn.checkedInAt).toLocaleTimeString('zh-TW', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                ) : (
                  <span style={styles.checkDash}>—</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 16, fontFamily: 'sans-serif', maxWidth: 480, margin: '0 auto' },
  backLink: { color: '#1a73e8', textDecoration: 'none', fontSize: 14 },
  title: { fontSize: 22, margin: '12px 0 4px 0' },
  subtitle: { fontSize: 14, color: '#666', margin: '0 0 16px 0' },
  summary: {
    display: 'flex',
    gap: 16,
    marginBottom: 16,
    padding: 16,
    backgroundColor: '#f9f9f9',
    borderRadius: 12,
  },
  summaryItem: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  summaryNumber: { fontSize: 28, fontWeight: 'bold', color: '#333' },
  summaryLabel: { fontSize: 13, color: '#999', marginTop: 4 },
  exportBtn: {
    width: '100%',
    padding: '10px 0',
    backgroundColor: '#f5f5f5',
    color: '#333',
    border: '1px solid #ddd',
    borderRadius: 8,
    fontSize: 14,
    cursor: 'pointer',
    marginBottom: 16,
  },
  table: {
    border: '1px solid #e0e0e0',
    borderRadius: 8,
    overflow: 'hidden',
  },
  tableHeader: {
    display: 'flex',
    padding: '10px 12px',
    backgroundColor: '#f5f5f5',
    fontWeight: 'bold',
    fontSize: 13,
    color: '#555',
  },
  tableRow: {
    display: 'flex',
    padding: '10px 12px',
    borderTop: '1px solid #f0f0f0',
    fontSize: 13,
  },
  colId: { flex: 2 },
  colDate: { flex: 1, textAlign: 'center' },
  colCheck: { flex: 1, textAlign: 'center' },
  checkMark: { color: '#2e7d32' },
  checkDash: { color: '#ccc' },
  error: { color: '#e74c3c' },
};
