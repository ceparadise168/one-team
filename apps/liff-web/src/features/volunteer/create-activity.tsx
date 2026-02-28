import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

interface Props {
  apiBaseUrl: string;
  accessToken: string;
}

export function CreateActivity({ apiBaseUrl, accessToken }: Props) {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [activityDate, setActivityDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [capacity, setCapacity] = useState('');
  const [checkInMode, setCheckInMode] = useState<'organizer-scan' | 'self-scan'>('organizer-scan');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${apiBaseUrl}/v1/volunteer/activities`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          title,
          description,
          location,
          activityDate,
          startTime,
          endTime,
          capacity: capacity ? parseInt(capacity, 10) : null,
          checkInMode,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '建立失敗');
      }

      const { activityId } = await res.json();
      navigate(`/volunteer/${activityId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.container}>
      <Link to="/volunteer" style={styles.backLink}>← 返回列表</Link>
      <h1 style={styles.title}>建立志工活動</h1>

      <form onSubmit={handleSubmit} style={styles.form}>
        <label style={styles.label}>
          活動名稱 *
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            style={styles.input}
          />
        </label>

        <label style={styles.label}>
          說明
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            style={styles.textarea}
          />
        </label>

        <label style={styles.label}>
          地點
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            style={styles.input}
          />
        </label>

        <label style={styles.label}>
          日期 *
          <input
            type="date"
            value={activityDate}
            onChange={(e) => setActivityDate(e.target.value)}
            required
            style={styles.input}
          />
        </label>

        <div style={styles.row}>
          <label style={{ ...styles.label, flex: 1 }}>
            開始時間
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              style={styles.input}
            />
          </label>
          <label style={{ ...styles.label, flex: 1 }}>
            結束時間
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              style={styles.input}
            />
          </label>
        </div>

        <label style={styles.label}>
          名額（留空為不限）
          <input
            type="number"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            min="1"
            style={styles.input}
            placeholder="不限"
          />
        </label>

        <fieldset style={styles.fieldset}>
          <legend style={styles.legend}>打卡方式</legend>
          <label style={styles.radioLabel}>
            <input
              type="radio"
              value="organizer-scan"
              checked={checkInMode === 'organizer-scan'}
              onChange={() => setCheckInMode('organizer-scan')}
            />
            <div>
              <strong>主辦掃碼</strong>
              <p style={styles.radioDesc}>主辦者掃描參加者的員工證 QR Code 來打卡</p>
            </div>
          </label>
          <label style={styles.radioLabel}>
            <input
              type="radio"
              value="self-scan"
              checked={checkInMode === 'self-scan'}
              onChange={() => setCheckInMode('self-scan')}
            />
            <div>
              <strong>自助掃碼</strong>
              <p style={styles.radioDesc}>參加者掃描活動 QR Code 來自助打卡</p>
            </div>
          </label>
        </fieldset>

        {error && <p style={styles.error}>{error}</p>}

        <button type="submit" disabled={submitting} style={styles.submitBtn}>
          {submitting ? '建立中...' : '建立活動'}
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 16, fontFamily: 'sans-serif', maxWidth: 480, margin: '0 auto' },
  backLink: { color: '#1a73e8', textDecoration: 'none', fontSize: 14 },
  title: { fontSize: 22, margin: '12px 0 16px 0' },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  label: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, color: '#333' },
  input: {
    padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8,
    fontSize: 15, outline: 'none',
  },
  textarea: {
    padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8,
    fontSize: 15, outline: 'none', resize: 'vertical',
  },
  row: { display: 'flex', gap: 12 },
  fieldset: { border: '1px solid #ddd', borderRadius: 8, padding: 12 },
  legend: { fontSize: 14, color: '#333', fontWeight: 'bold' },
  radioLabel: { display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 },
  radioDesc: { margin: '2px 0 0 0', fontSize: 12, color: '#999' },
  error: { color: '#e74c3c', textAlign: 'center' },
  submitBtn: {
    padding: '14px 0', backgroundColor: '#1DB446', color: 'white',
    border: 'none', borderRadius: 8, fontSize: 16, fontWeight: 'bold', cursor: 'pointer',
  },
};
