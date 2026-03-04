import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth-context';
import { useMassageSessions, useCancelMassageSession } from './use-massage';

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function AdminSessions() {
  const { apiBaseUrl, accessToken } = useAuth();
  const { sessions, loading, error, refresh } = useMassageSessions(apiBaseUrl, accessToken);
  const { cancel, loading: cancelling } = useCancelMassageSession(apiBaseUrl, accessToken);
  const navigate = useNavigate();
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function handleCancel(sessionId: string) {
    if (!confirm('確定要取消此場次嗎？取消後無法恢復。')) return;
    try {
      setActionMessage(null);
      await cancel(sessionId);
      setActionMessage('場次已取消');
      refresh();
    } catch (e) {
      setActionMessage((e as Error).message);
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>場次管理</h1>
        <Link to="/massage/admin/create" style={styles.createBtn}>
          新增場次
        </Link>
      </div>

      {actionMessage && <p style={styles.message}>{actionMessage}</p>}

      {loading ? (
        <p style={styles.empty}>載入中...</p>
      ) : error ? (
        <p style={styles.error}>錯誤: {error}</p>
      ) : sessions.length === 0 ? (
        <p style={styles.empty}>尚無場次</p>
      ) : (
        <div style={styles.list}>
          {sessions.map((session) => (
            <div key={session.sessionId} style={styles.card}>
              <div
                style={styles.cardClickable}
                onClick={() => navigate(`/massage/admin/sessions/${session.sessionId}`)}
              >
                <div style={styles.cardHeader}>
                  <span style={styles.cardDate}>{session.date}</span>
                  <div style={styles.badgeRow}>
                    <span style={session.mode === 'LOTTERY' ? styles.lotteryBadge : styles.fcfsBadge}>
                      {session.mode === 'LOTTERY' ? '抽籤' : '先到先得'}
                    </span>
                    <span
                      style={session.status === 'ACTIVE' ? styles.activeBadge : styles.cancelledBadge}
                    >
                      {session.status === 'ACTIVE' ? '進行中' : '已取消'}
                    </span>
                  </div>
                </div>
                <p style={styles.cardTime}>
                  {formatTime(session.startAt)} – {formatTime(session.endAt)}
                </p>
                <p style={styles.cardMeta}>{session.location}</p>
                <p style={styles.cardMeta}>名額: {session.quota}</p>
              </div>
              {session.status === 'ACTIVE' && (
                <button
                  style={styles.cancelBtn}
                  disabled={cancelling}
                  onClick={() => handleCancel(session.sessionId)}
                >
                  取消場次
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 16, fontFamily: 'sans-serif', maxWidth: 480, margin: '0 auto' },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 22, margin: 0 },
  createBtn: {
    padding: '8px 16px',
    backgroundColor: '#1DB446',
    color: 'white',
    borderRadius: 8,
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 'bold',
  },
  message: { textAlign: 'center', color: '#1a73e8', marginTop: 8, marginBottom: 8, fontSize: 14 },
  empty: { color: '#999', textAlign: 'center', marginTop: 40 },
  error: { color: '#e74c3c', textAlign: 'center', marginTop: 40 },
  list: { display: 'flex', flexDirection: 'column', gap: 12 },
  card: {
    padding: 16,
    border: '1px solid #e0e0e0',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  cardClickable: { cursor: 'pointer' },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardDate: { fontSize: 16, fontWeight: 'bold' },
  cardTime: { margin: '4px 0', fontSize: 14, color: '#333' },
  cardMeta: { margin: '4px 0', fontSize: 13, color: '#666' },
  badgeRow: { display: 'flex', gap: 6 },
  fcfsBadge: {
    padding: '2px 10px',
    borderRadius: 12,
    backgroundColor: '#e3f2fd',
    color: '#1565c0',
    fontSize: 12,
    fontWeight: 'bold',
  },
  lotteryBadge: {
    padding: '2px 10px',
    borderRadius: 12,
    backgroundColor: '#fff3e0',
    color: '#e65100',
    fontSize: 12,
    fontWeight: 'bold',
  },
  activeBadge: {
    padding: '2px 10px',
    borderRadius: 12,
    backgroundColor: '#e8f5e9',
    color: '#2e7d32',
    fontSize: 12,
    fontWeight: 'bold',
  },
  cancelledBadge: {
    padding: '2px 10px',
    borderRadius: 12,
    backgroundColor: '#ffebee',
    color: '#c62828',
    fontSize: 12,
    fontWeight: 'bold',
  },
  cancelBtn: {
    marginTop: 12,
    width: '100%',
    padding: '10px 0',
    backgroundColor: '#fff',
    color: '#e74c3c',
    border: '1px solid #e74c3c',
    borderRadius: 8,
    fontSize: 14,
    cursor: 'pointer',
  },
};
