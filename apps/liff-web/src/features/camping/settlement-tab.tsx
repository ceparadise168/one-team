import { useState, useEffect } from 'react';
import type { Settlement, TripParticipant, CampingTrip } from './use-camping';
import { SettlementSummary } from './settlement-summary';
import type React from 'react';

interface Props {
  trip: CampingTrip;
  participants: TripParticipant[];
  settlement: Settlement | null;
  currentEmployeeId: string;
  apiBaseUrl: string;
  accessToken: string;
  onSettle: () => Promise<void>;
}

export function SettlementTab({ trip, participants, settlement, currentEmployeeId, apiBaseUrl, accessToken, onSettle }: Props) {
  const [settling, setSettling] = useState(false);
  const [preview, setPreview] = useState<Settlement | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const nameOf = new Map(participants.map(p => [p.participantId, p.name]));
  const isCreator = trip.creatorEmployeeId === currentEmployeeId;
  const isOpen = trip.status === 'OPEN';

  useEffect(() => {
    if (!isOpen || settlement) return;
    let cancelled = false;
    setPreviewLoading(true);
    fetch(`${apiBaseUrl}/v1/liff/camping/trips/${trip.tripId}/settlement/preview`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (!cancelled && data) setPreview(data as Settlement); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [apiBaseUrl, accessToken, trip.tripId, isOpen, settlement, participants.length]);

  const handleSettle = async () => {
    if (!confirm('確定要結算嗎？結算後將無法修改費用。')) return;
    setSettling(true);
    try {
      await onSettle();
    } finally { setSettling(false); }
  };

  if (settlement) {
    return (
      <div>
        <SettlementSummary settlement={settlement} nameOf={nameOf} />
      </div>
    );
  }

  const hasPreviewData = preview && (preview.transfers.length > 0 || preview.participantSummaries.length > 0);

  return (
    <div>
      {previewLoading && (
        <div style={styles.emptyState}>
          <p style={styles.emptyHint}>載入預覽中...</p>
        </div>
      )}

      {!previewLoading && hasPreviewData && (
        <SettlementSummary settlement={preview} nameOf={nameOf} preview />
      )}

      {!previewLoading && !hasPreviewData && (
        <div style={styles.emptyState}>
          <p style={styles.emptyTitle}>尚未結算</p>
          <p style={styles.emptyHint}>新增費用或營位後，這裡會顯示即時預覽。</p>
        </div>
      )}

      {isCreator && (
        <button onClick={handleSettle} disabled={settling} style={styles.settleBtn}>
          {settling ? '結算中...' : '確認結算'}
        </button>
      )}
      {!isCreator && (
        <p style={styles.notCreatorHint}>只有行程建立者可以結算</p>
      )}
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
    cursor: 'pointer', marginTop: 16,
  },
  notCreatorHint: { textAlign: 'center', fontSize: 13, color: '#999', marginTop: 16 },
};
