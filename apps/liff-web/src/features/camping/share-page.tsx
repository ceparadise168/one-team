import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import type { Settlement } from './use-camping';
import { SettlementSummary } from './settlement-summary';
import { campingStyles } from './camping-shared';
import type React from 'react';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

interface PublicSummary {
  trip: { title: string; startDate: string; endDate: string; status: string };
  participantNames: Record<string, string>;
  settlement: Settlement | null;
}

export function SharePage() {
  const { tripId } = useParams<{ tripId: string }>();
  const [data, setData] = useState<PublicSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiBaseUrl}/v1/public/camping/trips/${tripId}/summary`)
      .then(r => { if (!r.ok) throw new Error('載入失敗'); return r.json(); })
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [tripId]);

  if (loading) return <div style={campingStyles.container}><p style={campingStyles.loading}>載入中...</p></div>;
  if (error) return <div style={campingStyles.container}><p style={campingStyles.error}>{error}</p></div>;
  if (!data) return <div style={campingStyles.container}><p style={campingStyles.error}>找不到行程</p></div>;

  const { trip, participantNames, settlement } = data;
  const nameOf = new Map(Object.entries(participantNames));

  return (
    <div style={campingStyles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>{trip.title}</h1>
        <div style={styles.dateRange}>{trip.startDate} ~ {trip.endDate}</div>
      </div>

      {!settlement && (
        <div style={styles.emptyState}>
          <p style={styles.emptyTitle}>尚未結算</p>
        </div>
      )}

      {settlement && <SettlementSummary settlement={settlement} nameOf={nameOf} />}

      <div style={styles.footer}>Powered by ONE TEAM</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { marginBottom: 20, textAlign: 'center' },
  title: { fontSize: 24, margin: '0 0 4px', fontWeight: 700 },
  dateRange: { fontSize: 13, color: '#888' },
  emptyState: { textAlign: 'center', padding: '48px 0' },
  emptyTitle: { fontSize: 16, fontWeight: 600, color: '#666' },
  footer: { textAlign: 'center', fontSize: 12, color: '#ccc', marginTop: 32, paddingBottom: 16 },
};
