import { Link } from 'react-router-dom';
import { useAuth } from '../../auth-context';
import { useActivities } from './use-volunteer';

export function ActivityList() {
  const { apiBaseUrl, accessToken } = useAuth();
  const { activities, loading, error } = useActivities(apiBaseUrl, accessToken);

  if (loading) return <div style={styles.container}><p>載入中...</p></div>;
  if (error) return <div style={styles.container}><p style={styles.error}>錯誤: {error}</p></div>;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>志工活動</h1>
        <Link to="/volunteer/create" style={styles.createBtn}>
          建立活動
        </Link>
      </div>

      {activities.length === 0 ? (
        <p style={styles.empty}>目前沒有開放中的活動</p>
      ) : (
        <div style={styles.list}>
          {activities.map((activity) => (
            <Link
              key={activity.activityId}
              to={`/volunteer/${activity.activityId}`}
              style={styles.card}
            >
              <h3 style={styles.cardTitle}>{activity.title}</h3>
              <p style={styles.cardMeta}>
                📅 {activity.activityDate} {activity.startTime}–{activity.endTime}
              </p>
              <p style={styles.cardMeta}>📍 {activity.location}</p>
              {activity.capacity && (
                <p style={styles.cardMeta}>👥 名額: {activity.capacity}</p>
              )}
              <span style={styles.badge}>
                {activity.checkInMode === 'organizer-scan' ? '主辦掃碼' : '自助掃碼'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 16, fontFamily: 'sans-serif', maxWidth: 480, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 22, margin: 0 },
  createBtn: {
    padding: '8px 16px', backgroundColor: '#1DB446', color: 'white',
    borderRadius: 8, textDecoration: 'none', fontSize: 14, fontWeight: 'bold',
  },
  empty: { color: '#999', textAlign: 'center', marginTop: 40 },
  list: { display: 'flex', flexDirection: 'column', gap: 12 },
  card: {
    padding: 16, border: '1px solid #e0e0e0', borderRadius: 12,
    textDecoration: 'none', color: '#333', backgroundColor: '#fff',
  },
  cardTitle: { margin: '0 0 8px 0', fontSize: 16 },
  cardMeta: { margin: '4px 0', fontSize: 13, color: '#666' },
  badge: {
    display: 'inline-block', marginTop: 8, padding: '2px 8px',
    backgroundColor: '#f0f0f0', borderRadius: 4, fontSize: 12, color: '#555',
  },
  error: { color: '#e74c3c' },
};
