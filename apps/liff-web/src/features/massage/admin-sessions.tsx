import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth-context';
import { useMassageSessions, useCancelMassageSession } from './use-massage';
import type { MassageSession } from './use-massage';
import { formatTime, sharedStyles } from './massage-shared';

function isSessionEnded(session: MassageSession): boolean {
  return new Date(session.endAt) < new Date();
}

function getStatusInfo(session: MassageSession): { label: string; style: React.CSSProperties } {
  if (session.status === 'CANCELLED') return { label: '已取消', style: sharedStyles.cancelledBadge };
  if (isSessionEnded(session)) return { label: '已結束', style: sharedStyles.endedBadge };
  return { label: '進行中', style: sharedStyles.activeBadge };
}

export function AdminSessions() {
  const { apiBaseUrl, accessToken } = useAuth();
  const { sessions, loading, error, refresh } = useMassageSessions(apiBaseUrl, accessToken);
  const { cancel, loading: cancelling } = useCancelMassageSession(apiBaseUrl, accessToken);
  const navigate = useNavigate();
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showEnded, setShowEnded] = useState(false);

  const { active: activeSessions, ended: endedSessions } = useMemo(() => {
    const active: MassageSession[] = [];
    const ended: MassageSession[] = [];
    for (const s of sessions) {
      if (s.status === 'CANCELLED' || isSessionEnded(s)) {
        ended.push(s);
      } else {
        active.push(s);
      }
    }
    return { active, ended };
  }, [sessions]);

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

  function renderSessionCard(session: MassageSession, ended: boolean) {
    const statusInfo = getStatusInfo(session);
    return (
      <div key={session.sessionId} style={ended ? styles.cardEnded : styles.card}>
        <div
          style={styles.cardClickable}
          onClick={() => navigate(`/massage/admin/sessions/${session.sessionId}`)}
        >
          <div style={styles.cardHeader}>
            <span style={ended ? styles.cardDateEnded : styles.cardDate}>{session.date}</span>
            <div style={styles.badgeRow}>
              <span style={session.mode === 'LOTTERY' ? sharedStyles.lotteryBadge : sharedStyles.fcfsBadge}>
                {session.mode === 'LOTTERY' ? '抽籤' : '先到先得'}
              </span>
              <span style={statusInfo.style}>{statusInfo.label}</span>
            </div>
          </div>
          <p style={ended ? styles.cardTimeEnded : styles.cardTime}>
            {formatTime(session.startAt)} – {formatTime(session.endAt)}
          </p>
          <p style={ended ? styles.cardMetaEnded : styles.cardMeta}>{session.location}</p>
          <p style={ended ? styles.cardMetaEnded : styles.cardMeta}>名額: {session.quota}</p>
        </div>
        {!ended && session.status === 'ACTIVE' && (
          <div style={styles.cardActions}>
            <button
              style={styles.bookLinkBtn}
              onClick={(e) => { e.stopPropagation(); navigate('/massage'); }}
            >
              前往預約
            </button>
            <button
              style={styles.cancelBtn}
              disabled={cancelling}
              onClick={() => handleCancel(session.sessionId)}
            >
              取消場次
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button style={sharedStyles.backBtn} onClick={() => navigate('/massage')}>← 預約</button>
          <h1 style={styles.title}>場次管理</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={styles.scheduleBtn} onClick={() => navigate('/massage/admin/schedules')}>
            排程管理
          </button>
          <Link to="/massage/admin/create" style={styles.createBtn}>
            新增場次
          </Link>
        </div>
      </div>

      {actionMessage && <p style={styles.message}>{actionMessage}</p>}

      {loading ? (
        <p style={styles.empty}>載入中...</p>
      ) : error ? (
        <p style={styles.error}>錯誤: {error}</p>
      ) : sessions.length === 0 ? (
        <p style={styles.empty}>尚無場次</p>
      ) : (
        <>
          {activeSessions.length === 0 ? (
            <p style={styles.empty}>目前沒有進行中的場次</p>
          ) : (
            <div style={styles.list}>
              {activeSessions.map((s) => renderSessionCard(s, false))}
            </div>
          )}

          {endedSessions.length > 0 && (
            <div style={styles.endedSection}>
              <button
                style={styles.endedToggle}
                onClick={() => setShowEnded(!showEnded)}
              >
                <span>已結束 / 已取消（{endedSessions.length}）</span>
                <span>{showEnded ? '▲' : '▼'}</span>
              </button>
              {showEnded && (
                <div style={styles.list}>
                  {endedSessions.map((s) => renderSessionCard(s, true))}
                </div>
              )}
            </div>
          )}
        </>
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
  scheduleBtn: {
    padding: '8px 16px',
    backgroundColor: '#fff',
    color: '#1DB446',
    border: '1px solid #1DB446',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 'bold',
    cursor: 'pointer',
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
  cardEnded: {
    padding: 16,
    border: '1px solid #e0e0e0',
    borderRadius: 12,
    backgroundColor: '#fafafa',
    opacity: 0.6,
  },
  cardClickable: { cursor: 'pointer' },
  cardActions: { display: 'flex', gap: 8, marginTop: 12 },
  bookLinkBtn: {
    flex: 1,
    padding: '10px 0',
    backgroundColor: '#fff',
    color: '#1DB446',
    border: '1px solid #1DB446',
    borderRadius: 8,
    fontSize: 14,
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardDate: { fontSize: 16, fontWeight: 'bold' },
  cardDateEnded: { fontSize: 16, fontWeight: 'bold', color: '#999' },
  cardTime: { margin: '4px 0', fontSize: 14, color: '#333' },
  cardTimeEnded: { margin: '4px 0', fontSize: 14, color: '#999' },
  cardMeta: { margin: '4px 0', fontSize: 13, color: '#666' },
  cardMetaEnded: { margin: '4px 0', fontSize: 13, color: '#999' },
  badgeRow: { display: 'flex', gap: 6 },
  cancelBtn: {
    flex: 1,
    padding: '10px 0',
    backgroundColor: '#fff',
    color: '#e74c3c',
    border: '1px solid #e74c3c',
    borderRadius: 8,
    fontSize: 14,
    cursor: 'pointer',
  },
  endedSection: {
    marginTop: 24,
  },
  endedToggle: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    backgroundColor: '#f5f5f5',
    border: '1px solid #e0e0e0',
    borderRadius: 8,
    fontSize: 14,
    color: '#666',
    cursor: 'pointer',
    marginBottom: 12,
  },
};
