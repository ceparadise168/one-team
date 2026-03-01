import { useMemo } from 'react';
import { useAuth } from '../../auth-context';
import { useDigitalId } from './use-digital-id.js';

export function DigitalIdCard() {
  const { apiBaseUrl, tenantId, accessToken, employeeId } = useAuth();
  const { state, refreshNow } = useDigitalId({
    apiBaseUrl,
    tenantId,
    accessToken,
  });

  const qrUrl = useMemo(() => {
    if (!state.payload) return null;
    return `https://quickchart.io/qr?text=${encodeURIComponent(state.payload)}&size=300`;
  }, [state.payload]);

  const expiresLabel = useMemo(() => {
    if (!state.expiresAtEpochSeconds) return '-';
    const d = new Date(state.expiresAtEpochSeconds * 1000);
    return d.toLocaleTimeString();
  }, [state.expiresAtEpochSeconds]);

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>數位員工證</h2>
      {employeeId && <p style={styles.employeeId}>{employeeId}</p>}

      {state.error && <p style={styles.error}>{state.error}</p>}

      {state.isLoading && !qrUrl && <p style={styles.loading}>載入中...</p>}

      {qrUrl && (
        <div style={styles.qrSection}>
          <img src={qrUrl} alt="Digital ID QR Code" style={styles.qrImage} />
          <p style={styles.expiry}>有效至 {expiresLabel}</p>
          <p style={styles.refreshHint}>
            {state.refreshInSeconds != null && state.refreshInSeconds > 0
              ? `${state.refreshInSeconds} 秒後自動更新`
              : '更新中...'}
          </p>
        </div>
      )}

      <button type="button" onClick={() => void refreshNow()} style={styles.refreshBtn}>
        立即重新整理
      </button>

      <p style={styles.hint}>請將此 QR Code 出示給主辦者掃描以完成打卡</p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 16, fontFamily: 'sans-serif', maxWidth: 480, margin: '0 auto', textAlign: 'center' },
  title: { fontSize: 22, margin: '12px 0 4px 0' },
  employeeId: { fontSize: 14, color: '#666', margin: '0 0 16px 0' },
  error: { color: '#e74c3c', fontSize: 14 },
  loading: { color: '#999', fontSize: 14 },
  qrSection: { marginTop: 16 },
  qrImage: { maxWidth: 250, width: '100%', borderRadius: 8 },
  expiry: { fontSize: 13, color: '#999', marginTop: 8 },
  refreshHint: { fontSize: 12, color: '#bbb' },
  refreshBtn: {
    marginTop: 16,
    padding: '10px 24px',
    backgroundColor: '#1a73e8',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    cursor: 'pointer',
  },
  hint: { fontSize: 13, color: '#888', marginTop: 20 },
};
