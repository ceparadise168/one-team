import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth-context';
import { useCreateMassageSession } from './use-massage';

type Mode = 'FIRST_COME' | 'LOTTERY';
type DrawMode = 'AUTO' | 'MANUAL';

export function CreateSession() {
  const { apiBaseUrl, accessToken } = useAuth();
  const { create, loading, error } = useCreateMassageSession(apiBaseUrl, accessToken);
  const navigate = useNavigate();

  const [date, setDate] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [location, setLocation] = useState('');
  const [quota, setQuota] = useState('');
  const [mode, setMode] = useState<Mode>('FIRST_COME');
  const [drawMode, setDrawMode] = useState<DrawMode>('AUTO');
  const [openAt, setOpenAt] = useState('');
  const [drawAt, setDrawAt] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const body: {
        date: string;
        startAt: string;
        endAt: string;
        location: string;
        quota: number;
        mode: Mode;
        openAt: string;
        drawAt?: string;
        drawMode?: DrawMode;
      } = {
        date,
        startAt: `${date}T${startAt}`,
        endAt: `${date}T${endAt}`,
        location,
        quota: parseInt(quota, 10),
        mode,
        openAt: openAt ? new Date(openAt).toISOString() : new Date().toISOString(),
      };
      if (mode === 'LOTTERY' && drawAt) {
        body.drawAt = new Date(drawAt).toISOString();
        body.drawMode = drawMode;
      }
      await create(body);
      navigate('/massage/admin');
    } catch {
      // error is set in the hook
    }
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>新增按摩場次</h1>

      {error && <p style={styles.error}>{error}</p>}

      <form onSubmit={handleSubmit} style={styles.form}>
        <label style={styles.label}>
          日期
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            style={styles.input}
          />
        </label>

        <div style={styles.row}>
          <label style={{ ...styles.label, flex: 1 }}>
            開始時間
            <input
              type="time"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              required
              style={styles.input}
            />
          </label>
          <label style={{ ...styles.label, flex: 1 }}>
            結束時間
            <input
              type="time"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
              required
              style={styles.input}
            />
          </label>
        </div>

        <label style={styles.label}>
          地點
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            required
            placeholder="例: B1 按摩室"
            style={styles.input}
          />
        </label>

        <label style={styles.label}>
          名額
          <input
            type="number"
            value={quota}
            onChange={(e) => setQuota(e.target.value)}
            required
            min={1}
            style={styles.input}
          />
        </label>

        <fieldset style={styles.fieldset}>
          <legend style={styles.legend}>預約模式</legend>
          <label style={styles.radioLabel}>
            <input
              type="radio"
              name="mode"
              value="FIRST_COME"
              checked={mode === 'FIRST_COME'}
              onChange={() => setMode('FIRST_COME')}
            />
            先到先得
          </label>
          <label style={styles.radioLabel}>
            <input
              type="radio"
              name="mode"
              value="LOTTERY"
              checked={mode === 'LOTTERY'}
              onChange={() => setMode('LOTTERY')}
            />
            抽籤
          </label>
        </fieldset>

        <label style={styles.label}>
          開放預約時間
          <input
            type="datetime-local"
            value={openAt}
            onChange={(e) => setOpenAt(e.target.value)}
            required
            style={styles.input}
          />
        </label>

        {mode === 'LOTTERY' && (
          <>
            <label style={styles.label}>
              抽籤時間
              <input
                type="datetime-local"
                value={drawAt}
                onChange={(e) => setDrawAt(e.target.value)}
                required
                style={styles.input}
              />
            </label>
            <fieldset style={styles.fieldset}>
              <legend style={styles.legend}>抽籤方式</legend>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="drawMode"
                  value="AUTO"
                  checked={drawMode === 'AUTO'}
                  onChange={() => setDrawMode('AUTO')}
                />
                自動抽籤
              </label>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="drawMode"
                  value="MANUAL"
                  checked={drawMode === 'MANUAL'}
                  onChange={() => setDrawMode('MANUAL')}
                />
                手動抽籤（系統提醒）
              </label>
            </fieldset>
          </>
        )}

        <button type="submit" style={styles.submitBtn} disabled={loading}>
          {loading ? '建立中...' : '建立場次'}
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 16, fontFamily: 'sans-serif', maxWidth: 480, margin: '0 auto' },
  title: { fontSize: 22, margin: '0 0 20px 0' },
  error: { color: '#e74c3c', fontSize: 14, marginBottom: 12 },
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: 14,
    color: '#333',
    fontWeight: 'bold',
  },
  input: {
    padding: '10px 12px',
    border: '1px solid #e0e0e0',
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 'normal',
    boxSizing: 'border-box' as const,
    outline: 'none',
  },
  row: { display: 'flex', gap: 12 },
  fieldset: {
    border: '1px solid #e0e0e0',
    borderRadius: 8,
    padding: '12px 16px',
    margin: 0,
  },
  legend: { fontSize: 14, fontWeight: 'bold', color: '#333' },
  radioLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 14,
    color: '#333',
    marginRight: 20,
    cursor: 'pointer',
  },
  submitBtn: {
    padding: '12px 0',
    backgroundColor: '#1DB446',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: 8,
  },
};
