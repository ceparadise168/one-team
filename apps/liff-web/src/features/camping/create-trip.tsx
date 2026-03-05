import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth-context';
import { useCreateTrip } from './use-camping';
import { campingStyles as cs } from './camping-shared';
import type React from 'react';

export function CreateTrip() {
  const { apiBaseUrl, accessToken } = useAuth();
  const navigate = useNavigate();
  const { create, loading } = useCreateTrip(apiBaseUrl, accessToken);

  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [creatorName, setCreatorName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !startDate || !endDate || !creatorName) {
      setError('請填寫所有欄位');
      return;
    }
    try {
      const result = await create({ title, startDate, endDate, creatorName });
      navigate(`/camping/${result.tripId}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div style={cs.container}>
      <button onClick={() => navigate('/camping')} style={cs.backBtn}>← 返回</button>
      <h1 style={styles.title}>新增露營行程</h1>

      <form onSubmit={handleSubmit} style={styles.form}>
        <label style={styles.label}>
          行程名稱
          <input
            style={styles.input}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="例：2026 冬季露營"
          />
        </label>

        <label style={styles.label}>
          你的名字
          <input
            style={styles.input}
            value={creatorName}
            onChange={e => setCreatorName(e.target.value)}
            placeholder="用於帳務計算的顯示名稱"
          />
        </label>

        <div style={styles.dateRow}>
          <label style={{ ...styles.label, flex: 1 }}>
            開始日期
            <input type="date" style={styles.input} value={startDate} onChange={e => setStartDate(e.target.value)} />
          </label>
          <label style={{ ...styles.label, flex: 1 }}>
            結束日期
            <input type="date" style={styles.input} value={endDate} onChange={e => setEndDate(e.target.value)} />
          </label>
        </div>

        {error && <p style={styles.error}>{error}</p>}

        <button type="submit" disabled={loading} style={styles.submitBtn}>
          {loading ? '建立中...' : '建立行程'}
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  title: { fontSize: 22, margin: '8px 0 20px', fontWeight: 700 },
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  label: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, fontWeight: 600, color: '#333' },
  input: {
    padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8,
    fontSize: 15, outline: 'none',
  },
  dateRow: { display: 'flex', gap: 12 },
  error: { color: '#c62828', fontSize: 14, margin: 0 },
  submitBtn: {
    padding: '12px 0', backgroundColor: '#1DB446', color: '#fff', border: 'none',
    borderRadius: 8, fontSize: 16, fontWeight: 600, cursor: 'pointer', marginTop: 8,
  },
};
