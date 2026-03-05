import { Link } from 'react-router-dom';
import { useAuth } from '../../auth-context';
import { useCampingTrips } from './use-camping';
import type { CampingTrip } from './use-camping';
import { campingStyles as cs } from './camping-shared';
import type React from 'react';

const STATUS_LABELS: Record<CampingTrip['status'], { label: string; bg: string; color: string }> = {
  OPEN: { label: '進行中', bg: '#e8f5e9', color: '#2e7d32' },
  SETTLED: { label: '已結算', bg: '#f5f5f5', color: '#757575' },
};

export function TripList() {
  const { apiBaseUrl, accessToken } = useAuth();
  const { trips, loading, error } = useCampingTrips(apiBaseUrl, accessToken);

  if (loading) return <div style={cs.container}><p style={cs.loading}>載入中...</p></div>;
  if (error) return <div style={cs.container}><p style={cs.error}>{error}</p></div>;

  return (
    <div style={cs.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>露營分帳</h1>
        <Link to="/camping/new" style={styles.createBtn}>+ 新增行程</Link>
      </div>

      {trips.length === 0 && (
        <div style={styles.empty}>
          <p style={styles.emptyText}>還沒有露營行程</p>
          <p style={styles.emptyHint}>點擊上方按鈕建立第一個行程</p>
        </div>
      )}

      {trips.map(trip => {
        const status = STATUS_LABELS[trip.status];
        return (
          <Link key={trip.tripId} to={`/camping/${trip.tripId}`} style={styles.card}>
            <div style={styles.cardHeader}>
              <span style={styles.cardTitle}>{trip.title}</span>
              <span style={{ ...styles.badge, backgroundColor: status.bg, color: status.color }}>
                {status.label}
              </span>
            </div>
            <div style={styles.cardDate}>
              {trip.startDate} ~ {trip.endDate}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 22, margin: 0, fontWeight: 700 },
  createBtn: {
    padding: '8px 16px',
    backgroundColor: '#1DB446',
    color: '#fff',
    borderRadius: 8,
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 600,
  },
  empty: { textAlign: 'center', padding: '48px 0' },
  emptyText: { fontSize: 16, color: '#666', margin: 0 },
  emptyHint: { fontSize: 13, color: '#999', marginTop: 8 },
  card: {
    display: 'block',
    padding: 16,
    border: '1px solid #e0e0e0',
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: '#fff',
    textDecoration: 'none',
    color: 'inherit',
  },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 16, fontWeight: 600 },
  badge: { padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 'bold' },
  cardDate: { fontSize: 13, color: '#888', marginTop: 6 },
};
