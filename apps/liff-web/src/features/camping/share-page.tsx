import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import type { Settlement } from './use-camping';
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiBaseUrl}/v1/public/camping/trips/${tripId}/summary`)
      .then(r => { if (!r.ok) throw new Error('載入失敗'); return r.json(); })
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [tripId]);

  if (loading) return <div style={styles.container}><p style={styles.loading}>載入中...</p></div>;
  if (error) return <div style={styles.container}><p style={styles.error}>{error}</p></div>;
  if (!data) return <div style={styles.container}><p style={styles.error}>找不到行程</p></div>;

  const { trip, participantNames, settlement } = data;
  const nameOf = new Map(Object.entries(participantNames));

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>{trip.title}</h1>
        <div style={styles.dateRange}>{trip.startDate} ~ {trip.endDate}</div>
      </div>

      {!settlement && (
        <div style={styles.emptyState}>
          <p style={styles.emptyTitle}>尚未結算</p>
        </div>
      )}

      {settlement && (
        <>
          <div style={styles.settledBanner}>
            已結算 ({new Date(settlement.settledAt).toLocaleDateString('zh-TW')})
          </div>

          <div style={styles.sectionTitle}>轉帳指示</div>
          {settlement.transfers.length === 0 && (
            <p style={styles.noTransfers}>所有人已結清</p>
          )}
          {settlement.transfers.map((t, i) => (
            <div key={i} style={styles.transferCard}>
              <div style={styles.transferFrom}>{nameOf.get(t.fromParticipantId) ?? '?'}</div>
              <div style={styles.transferArrow}>→</div>
              <div style={styles.transferTo}>{nameOf.get(t.toParticipantId) ?? '?'}</div>
              <div style={styles.transferAmount}>${t.amount.toLocaleString()}</div>
            </div>
          ))}

          <div style={styles.sectionTitle}>個人明細</div>
          {settlement.participantSummaries.map(s => {
            const isExpanded = expandedId === s.participantId;
            return (
              <div key={s.participantId} style={styles.summaryCard}>
                <div
                  style={styles.summaryHeader}
                  onClick={() => setExpandedId(isExpanded ? null : s.participantId)}
                >
                  <span style={styles.summaryName}>{s.name}</span>
                  <span style={{
                    ...styles.summaryNet,
                    color: s.netAmount > 0 ? '#c62828' : s.netAmount < 0 ? '#2e7d32' : '#666',
                  }}>
                    {s.netAmount > 0 ? `應付 $${s.netAmount.toLocaleString()}` :
                     s.netAmount < 0 ? `應收 $${(-s.netAmount).toLocaleString()}` :
                     '已結清'}
                  </span>
                  <span style={styles.expandIcon}>{isExpanded ? '▲' : '▼'}</span>
                </div>
                {isExpanded && (
                  <div style={styles.breakdown}>
                    <div style={styles.breakdownLine}>應分攤: ${s.totalOwed.toLocaleString()}</div>
                    <div style={styles.breakdownLine}>已代墊: ${s.totalPaid.toLocaleString()}</div>
                    {s.breakdown && (
                      <pre style={styles.breakdownDetail}>{s.breakdown}</pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      <div style={styles.footer}>
        Powered by ONE TEAM
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 16, fontFamily: 'sans-serif', maxWidth: 480, margin: '0 auto' },
  loading: { color: '#999', textAlign: 'center' },
  error: { color: '#c62828', textAlign: 'center' },
  header: { marginBottom: 20, textAlign: 'center' },
  title: { fontSize: 24, margin: '0 0 4px', fontWeight: 700 },
  dateRange: { fontSize: 13, color: '#888' },
  emptyState: { textAlign: 'center', padding: '48px 0' },
  emptyTitle: { fontSize: 16, fontWeight: 600, color: '#666' },
  settledBanner: {
    padding: '10px 16px', backgroundColor: '#e8f5e9', borderRadius: 8,
    textAlign: 'center', fontSize: 14, fontWeight: 600, color: '#2e7d32',
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#333', marginBottom: 8, marginTop: 16 },
  noTransfers: { fontSize: 14, color: '#888', textAlign: 'center' },
  transferCard: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 12px', border: '1px solid #e0e0e0', borderRadius: 10,
    marginBottom: 8, backgroundColor: '#fff',
  },
  transferFrom: { fontSize: 14, fontWeight: 600, color: '#c62828' },
  transferArrow: { fontSize: 16, color: '#888' },
  transferTo: { fontSize: 14, fontWeight: 600, color: '#2e7d32', flex: 1 },
  transferAmount: { fontSize: 15, fontWeight: 700 },
  summaryCard: {
    border: '1px solid #e0e0e0', borderRadius: 10,
    marginBottom: 8, backgroundColor: '#fff', overflow: 'hidden',
  },
  summaryHeader: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 12px', cursor: 'pointer',
  },
  summaryName: { flex: 1, fontSize: 14, fontWeight: 600 },
  summaryNet: { fontSize: 13, fontWeight: 700 },
  expandIcon: { fontSize: 10, color: '#999' },
  breakdown: { padding: '0 12px 12px', borderTop: '1px solid #f0f0f0' },
  breakdownLine: { fontSize: 13, color: '#555', marginTop: 6 },
  breakdownDetail: {
    fontSize: 11, color: '#888', marginTop: 8, whiteSpace: 'pre-wrap',
    fontFamily: 'monospace', lineHeight: 1.4, background: '#f9f9f9',
    padding: 8, borderRadius: 6,
  },
  footer: { textAlign: 'center', fontSize: 12, color: '#ccc', marginTop: 32, paddingBottom: 16 },
};
