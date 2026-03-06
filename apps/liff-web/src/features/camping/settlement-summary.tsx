import { useState } from 'react';
import type { Settlement } from './use-camping';
import type React from 'react';

interface Props {
  settlement: Settlement;
  nameOf: Map<string, string>;
  preview?: boolean;
}

export function SettlementSummary({ settlement, nameOf, preview }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <>
      <div style={preview ? styles.previewBanner : styles.settledBanner}>
        {preview ? '即時預覽（尚未結算）' : `已結算 (${new Date(settlement.settledAt).toLocaleDateString('zh-TW')})`}
      </div>

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
  );
}

const styles: Record<string, React.CSSProperties> = {
  settledBanner: {
    padding: '10px 16px', backgroundColor: '#e8f5e9', borderRadius: 8,
    textAlign: 'center', fontSize: 14, fontWeight: 600, color: '#2e7d32',
    marginBottom: 16,
  },
  previewBanner: {
    padding: '10px 16px', backgroundColor: '#fff3e0', borderRadius: 8,
    textAlign: 'center', fontSize: 14, fontWeight: 600, color: '#e65100',
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
};
