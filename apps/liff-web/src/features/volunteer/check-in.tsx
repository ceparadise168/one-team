import { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../../auth-context';
import { QrScanner } from '../../components/qr-scanner';

interface Props {
  mode: 'organizer' | 'self';
}

export function CheckIn({ mode }: Props) {
  const { apiBaseUrl, accessToken } = useAuth();
  const { activityId } = useParams<{ activityId: string }>();
  const [status, setStatus] = useState<'scanning' | 'success' | 'error'>('scanning');
  const [message, setMessage] = useState('');
  const [scannerActive, setScannerActive] = useState(true);

  const handleOrganizerScan = useCallback(
    async (decodedText: string) => {
      setScannerActive(false);

      try {
        const res = await fetch(
          `${apiBaseUrl}/v1/volunteer/activities/${activityId}/scan-check-in-qr`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ digitalIdPayload: decodedText }),
          }
        );

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || '打卡失敗');
        }

        const data = await res.json();
        setStatus('success');
        setMessage(`員工 ${data.employeeId} 打卡成功！`);
      } catch (e) {
        setStatus('error');
        setMessage((e as Error).message);
      }
    },
    [apiBaseUrl, accessToken, activityId]
  );

  const handleSelfScan = useCallback(
    async (decodedText: string) => {
      setScannerActive(false);

      try {
        const res = await fetch(
          `${apiBaseUrl}/v1/volunteer/activities/${activityId}/check-in`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ activityQrPayload: decodedText }),
          }
        );

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || '打卡失敗');
        }

        setStatus('success');
        setMessage('打卡成功！');
      } catch (e) {
        setStatus('error');
        setMessage((e as Error).message);
      }
    },
    [apiBaseUrl, accessToken, activityId]
  );

  function handleScanAgain() {
    setStatus('scanning');
    setMessage('');
    setScannerActive(true);
  }

  return (
    <div style={styles.container}>
      <Link to={`/volunteer/${activityId}`} style={styles.backLink}>
        ← 返回活動
      </Link>

      <h1 style={styles.title}>
        {mode === 'organizer' ? '主辦掃碼打卡' : '自助掃碼打卡'}
      </h1>

      <p style={styles.desc}>
        {mode === 'organizer'
          ? '掃描參加者的數位員工證 QR Code 以完成打卡'
          : '掃描活動的 QR Code 以完成打卡'}
      </p>

      {status === 'scanning' && (
        <QrScanner
          onScan={mode === 'organizer' ? handleOrganizerScan : handleSelfScan}
          active={scannerActive}
        />
      )}

      {status === 'success' && (
        <div style={styles.successBox}>
          <p style={styles.successText}>{message}</p>
        </div>
      )}

      {status === 'error' && (
        <div style={styles.errorBox}>
          <p style={styles.errorText}>{message}</p>
        </div>
      )}

      {status !== 'scanning' && mode === 'organizer' && (
        <button onClick={handleScanAgain} style={styles.scanAgainBtn}>
          掃碼下一位
        </button>
      )}

      {status === 'error' && (
        <button onClick={handleScanAgain} style={styles.retryBtn}>
          重新掃碼
        </button>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 16, fontFamily: 'sans-serif', maxWidth: 480, margin: '0 auto' },
  backLink: { color: '#1a73e8', textDecoration: 'none', fontSize: 14 },
  title: { fontSize: 22, margin: '12px 0 8px 0' },
  desc: { color: '#666', fontSize: 14, marginBottom: 24 },
  successBox: {
    padding: 16,
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
    marginBottom: 16,
  },
  successText: { color: '#2e7d32', margin: 0, textAlign: 'center', fontWeight: 'bold' },
  errorBox: {
    padding: 16,
    backgroundColor: '#fbe9e7',
    borderRadius: 8,
    marginBottom: 16,
  },
  errorText: { color: '#c62828', margin: 0, textAlign: 'center' },
  scanAgainBtn: {
    width: '100%',
    padding: '14px 0',
    backgroundColor: '#1DB446',
    color: 'white',
    border: 'none',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: 12,
  },
  retryBtn: {
    width: '100%',
    padding: '14px 0',
    backgroundColor: '#fff',
    color: '#1a73e8',
    border: '2px solid #1a73e8',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: 12,
  },
};
