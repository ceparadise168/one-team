import { useState } from 'react';
import type { Settlement, TripParticipant, CampingTrip } from './use-camping';
import { SettlementSummary } from './settlement-summary';
import type React from 'react';

interface Props {
  trip: CampingTrip;
  participants: TripParticipant[];
  settlement: Settlement | null;
  currentEmployeeId: string;
  tenantId: string;
  onSettle: () => Promise<void>;
}

export function SettlementTab({ trip, participants, settlement, currentEmployeeId, tenantId, onSettle }: Props) {
  const [settling, setSettling] = useState(false);
  const [copied, setCopied] = useState(false);
  const liffId = import.meta.env.VITE_LIFF_ID ?? '';

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
    const url = liffId
      ? `https://liff.line.me/${liffId}/camping/${trip.tripId}?tenantId=${tenantId}`
      : `${window.location.origin}/camping/${trip.tripId}?tenantId=${tenantId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

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

  return (
    <div>
      <SettlementSummary settlement={settlement} nameOf={nameOf} />
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
  shareBtn: {
    width: '100%', padding: '12px 0', border: '1px solid #1DB446', borderRadius: 8,
    backgroundColor: '#fff', color: '#1DB446', fontSize: 14, fontWeight: 600,
    cursor: 'pointer', marginTop: 20,
  },
};
