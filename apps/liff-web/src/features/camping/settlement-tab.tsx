import { useState } from 'react';
import type { Settlement, TripParticipant, CampingTrip } from './use-camping';
import type React from 'react';

interface Props {
  trip: CampingTrip;
  participants: TripParticipant[];
  settlement: Settlement | null;
  currentEmployeeId: string;
  onSettle: () => Promise<void>;
}

export function SettlementTab({ trip, participants, settlement, currentEmployeeId, onSettle }: Props) {
  const [settling, setSettling] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const nameOf = new Map(participants.map(p => [p.participantId, p.name]));
  const isCreator = trip.creatorEmployeeId === currentEmployeeId;

  const handleSettle = async () => {
    if (!confirm('確定要結算嗎？結算後將無法修改費用。')) return;
    setSettling(true);
    try {
      await onSettle();
    } finally { setSettling(false); }
  };

  const handleCopyLink = () => {
    const url = `${window.location.origin}/camping/${trip.tripId}/share`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Not settled yet
  if (!settlement) {
    return (
      <div>
        <div style={styles.emptyState}>
          <p style={styles.emptyTitle}>尚未結算</p>
          <p style={styles.emptyHint}>確認所有費用和營位都已新增後，由行程建立者進行結算。</p>
        </div>
        {isCreator && (
          <button onClick={handleSettle} disabled={settling} style={styles.settleBtn}>
            {settling ? '結算中...' : '結算'}
          </button>
        )}
        {!isCreator && (
          <p style={styles.notCreatorHint}>只有行程建立者可以結算</p>
        )}
      </div>
    );
  }

  // Settled
  return (
    <div>
      <div style={styles.settledBanner}>
        已結算 ({new Date(settlement.settledAt).toLocaleDateString('zh-TW')})
      </div>

      {/* Transfer instructions */}
      <div style={styles.sectionTitle}>轉帳指示</div>
      {settlement.transfers.length === 0 && (
        <p style={styles.noTransfers}>所有人已結清，無需轉帳</p>
      )}
      {settlement.transfers.map((t, i) => (
        <div key={i} style={styles.transferCard}>
          <div style={styles.transferFrom}>{nameOf.get(t.fromParticipantId) ?? '?'}</div>
          <div style={styles.transferArrow}>→</div>
          <div style={styles.transferTo}>{nameOf.get(t.toParticipantId) ?? '?'}</div>
          <div style={styles.transferAmount}>${t.amount.toLocaleString()}</div>
        </div>
      ))}

      {/* Per-person breakdown */}
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

      {/* Share link */}
      <button onClick={handleCopyLink} style={styles.shareBtn}>
        {copied ? '已複製!' : '複製分享連結'}
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  emptyState: { textAlign: 'center', padding: '32px 0' },
  emptyTitle: { fontSize: 16, fontWeight: 600, color: '#333', margin: 0 },
  emptyHint: { fontSize: 13, color: '#888', marginTop: 8 },
  settleBtn: {
    width: '100%', padding: '14px 0', border: 'none', borderRadius: 8,
    backgroundColor: '#e65100', color: '#fff', fontSize: 16, fontWeight: 700,
    cursor: 'pointer',
  },
  notCreatorHint: { textAlign: 'center', fontSize: 13, color: '#999' },
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
  shareBtn: {
    width: '100%', padding: '12px 0', border: '1px solid #1DB446', borderRadius: 8,
    backgroundColor: '#fff', color: '#1DB446', fontSize: 14, fontWeight: 600,
    cursor: 'pointer', marginTop: 20,
  },
};
