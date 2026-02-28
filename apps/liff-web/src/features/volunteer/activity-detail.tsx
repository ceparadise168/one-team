import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useActivityDetail } from './use-volunteer';

interface Props {
  apiBaseUrl: string;
  accessToken: string;
  employeeId?: string;
}

export function ActivityDetail({ apiBaseUrl, accessToken, employeeId }: Props) {
  const { activityId } = useParams<{ activityId: string }>();
  const { detail, loading, error, refresh } = useActivityDetail(
    apiBaseUrl,
    accessToken,
    activityId ?? ''
  );
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  if (loading) return <div style={styles.container}><p>載入中...</p></div>;
  if (error || !detail) {
    return <div style={styles.container}><p style={styles.error}>活動不存在</p></div>;
  }

  const { activity, registrationCount } = detail;

  async function handleRegister() {
    setActionLoading(true);
    setActionMessage(null);
    try {
      const res = await fetch(
        `${apiBaseUrl}/v1/volunteer/activities/${activityId}/register`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '報名失敗');
      }
      setActionMessage('報名成功！');
      refresh();
    } catch (e) {
      setActionMessage((e as Error).message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancelRegistration() {
    setActionLoading(true);
    try {
      await fetch(`${apiBaseUrl}/v1/volunteer/activities/${activityId}/register`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setActionMessage('已取消報名');
      refresh();
    } catch {
      setActionMessage('取消失敗');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancelActivity() {
    if (!confirm('確定要取消此活動？')) return;
    setActionLoading(true);
    try {
      await fetch(`${apiBaseUrl}/v1/volunteer/activities/${activityId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setActionMessage('活動已取消');
      refresh();
    } catch {
      setActionMessage('取消失敗');
    } finally {
      setActionLoading(false);
    }
  }

  const isCreator = employeeId && activity.createdBy === employeeId;

  return (
    <div style={styles.container}>
      <Link to="/volunteer" style={styles.backLink}>← 返回列表</Link>

      <h1 style={styles.title}>{activity.title}</h1>
      <div style={styles.statusBadge}>{activity.status}</div>

      {activity.description && <p style={styles.desc}>{activity.description}</p>}

      <div style={styles.infoGrid}>
        <div style={styles.infoItem}>
          <span style={styles.infoLabel}>日期</span>
          <span>{activity.activityDate}</span>
        </div>
        <div style={styles.infoItem}>
          <span style={styles.infoLabel}>時間</span>
          <span>{activity.startTime} – {activity.endTime}</span>
        </div>
        <div style={styles.infoItem}>
          <span style={styles.infoLabel}>地點</span>
          <span>{activity.location}</span>
        </div>
        <div style={styles.infoItem}>
          <span style={styles.infoLabel}>名額</span>
          <span>{activity.capacity ? `${registrationCount}/${activity.capacity}` : `${registrationCount} (無限制)`}</span>
        </div>
        <div style={styles.infoItem}>
          <span style={styles.infoLabel}>打卡方式</span>
          <span>{activity.checkInMode === 'organizer-scan' ? '主辦掃碼' : '自助掃碼'}</span>
        </div>
      </div>

      {actionMessage && <p style={styles.message}>{actionMessage}</p>}

      {activity.status === 'OPEN' && (
        <div style={styles.actions}>
          <button
            onClick={handleRegister}
            disabled={actionLoading}
            style={styles.primaryBtn}
          >
            報名參加
          </button>
          <button
            onClick={handleCancelRegistration}
            disabled={actionLoading}
            style={styles.secondaryBtn}
          >
            取消報名
          </button>
        </div>
      )}

      {isCreator && (
        <div style={styles.actions}>
          <Link
            to={`/volunteer/${activityId}/scan`}
            style={{ ...styles.primaryBtn, textAlign: 'center', textDecoration: 'none' }}
          >
            掃碼打卡
          </Link>
          {activity.status === 'OPEN' && (
            <button onClick={handleCancelActivity} disabled={actionLoading} style={styles.dangerBtn}>
              取消活動
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 16, fontFamily: 'sans-serif', maxWidth: 480, margin: '0 auto' },
  backLink: { color: '#1a73e8', textDecoration: 'none', fontSize: 14 },
  title: { fontSize: 22, margin: '12px 0 8px 0' },
  statusBadge: {
    display: 'inline-block', padding: '2px 10px', borderRadius: 4,
    backgroundColor: '#e8f5e9', color: '#2e7d32', fontSize: 12, fontWeight: 'bold',
  },
  desc: { color: '#555', lineHeight: 1.5 },
  infoGrid: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 },
  infoItem: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f0f0f0' },
  infoLabel: { color: '#999', fontSize: 14 },
  actions: { display: 'flex', gap: 8, marginTop: 16 },
  primaryBtn: {
    flex: 1, padding: '12px 0', backgroundColor: '#1DB446', color: 'white',
    border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 'bold', cursor: 'pointer',
  },
  secondaryBtn: {
    flex: 1, padding: '12px 0', backgroundColor: '#f5f5f5', color: '#333',
    border: '1px solid #ddd', borderRadius: 8, fontSize: 15, cursor: 'pointer',
  },
  dangerBtn: {
    flex: 1, padding: '12px 0', backgroundColor: '#fff', color: '#e74c3c',
    border: '1px solid #e74c3c', borderRadius: 8, fontSize: 15, cursor: 'pointer',
  },
  message: { textAlign: 'center', color: '#1a73e8', marginTop: 12 },
  error: { color: '#e74c3c' },
};
