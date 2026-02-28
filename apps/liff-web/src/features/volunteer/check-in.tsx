import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';

interface Props {
  apiBaseUrl: string;
  accessToken: string;
  mode: 'organizer' | 'self';
}

export function CheckIn({ apiBaseUrl, accessToken, mode }: Props) {
  const { activityId } = useParams<{ activityId: string }>();
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [scanning, setScanning] = useState(false);

  async function handleOrganizerScan() {
    setScanning(true);
    setStatus('idle');

    try {
      // Use LIFF scanCodeV2 if available
      const liff = (window as unknown as { liff?: { scanCodeV2: () => Promise<{ value: string }> } }).liff;
      if (!liff?.scanCodeV2) {
        throw new Error('請在 LINE 應用程式中開啟此頁面以使用掃碼功能');
      }

      const result = await liff.scanCodeV2();
      const scannedPayload = result.value;

      // Parse employee ID from scanned digital ID QR
      const res = await fetch(
        `${apiBaseUrl}/v1/volunteer/activities/${activityId}/scan-check-in`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ employeeId: scannedPayload }),
        }
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '打卡失敗');
      }

      setStatus('success');
      setMessage(`員工 ${scannedPayload} 打卡成功！`);
    } catch (e) {
      setStatus('error');
      setMessage((e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  async function handleSelfScan() {
    setScanning(true);
    setStatus('idle');

    try {
      const liff = (window as unknown as { liff?: { scanCodeV2: () => Promise<{ value: string }> } }).liff;
      if (!liff?.scanCodeV2) {
        throw new Error('請在 LINE 應用程式中開啟此頁面以使用掃碼功能');
      }

      const result = await liff.scanCodeV2();
      const qrPayload = result.value;

      const res = await fetch(
        `${apiBaseUrl}/v1/volunteer/activities/${activityId}/check-in`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ activityQrPayload: qrPayload }),
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
    } finally {
      setScanning(false);
    }
  }

  return (
    <div style={styles.container}>
      <Link to={`/volunteer/${activityId}`} style={styles.backLink}>← 返回活動</Link>

      <h1 style={styles.title}>
        {mode === 'organizer' ? '主辦掃碼打卡' : '自助掃碼打卡'}
      </h1>

      <p style={styles.desc}>
        {mode === 'organizer'
          ? '掃描參加者的數位員工證 QR Code 以完成打卡'
          : '掃描活動的 QR Code 以完成打卡'}
      </p>

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

      <button
        onClick={mode === 'organizer' ? handleOrganizerScan : handleSelfScan}
        disabled={scanning}
        style={styles.scanBtn}
      >
        {scanning ? '掃碼中...' : '開始掃碼'}
      </button>

      {mode === 'organizer' && status === 'success' && (
        <button
          onClick={handleOrganizerScan}
          style={styles.scanAgainBtn}
        >
          繼續掃碼下一位
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
    padding: 16, backgroundColor: '#e8f5e9', borderRadius: 8, marginBottom: 16,
  },
  successText: { color: '#2e7d32', margin: 0, textAlign: 'center', fontWeight: 'bold' },
  errorBox: {
    padding: 16, backgroundColor: '#fbe9e7', borderRadius: 8, marginBottom: 16,
  },
  errorText: { color: '#c62828', margin: 0, textAlign: 'center' },
  scanBtn: {
    width: '100%', padding: '16px 0', backgroundColor: '#1DB446', color: 'white',
    border: 'none', borderRadius: 12, fontSize: 18, fontWeight: 'bold', cursor: 'pointer',
  },
  scanAgainBtn: {
    width: '100%', padding: '14px 0', backgroundColor: '#fff', color: '#1DB446',
    border: '2px solid #1DB446', borderRadius: 12, fontSize: 16, fontWeight: 'bold',
    cursor: 'pointer', marginTop: 12,
  },
};
