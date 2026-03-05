import { useState } from 'react';
import { useAuth } from '../../auth-context';
import {
  useMassageSchedules,
  useCreateMassageSchedule,
  useToggleMassageSchedule,
} from './use-massage';

const DAY_NAMES = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

export function ScheduleManagement() {
  const { apiBaseUrl, accessToken } = useAuth();
  const { schedules, loading, error, refresh } = useMassageSchedules(apiBaseUrl, accessToken);
  const { create, loading: creating, error: createError } = useCreateMassageSchedule(apiBaseUrl, accessToken);
  const { toggle, loading: toggling } = useToggleMassageSchedule(apiBaseUrl, accessToken);

  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [location, setLocation] = useState('');
  const [slotDurationMinutes, setSlotDurationMinutes] = useState(20);
  const [therapistCount, setTherapistCount] = useState(1);
  const [mode, setMode] = useState<'FIRST_COME' | 'LOTTERY'>('FIRST_COME');
  const [drawMode, setDrawMode] = useState<'AUTO' | 'MANUAL'>('AUTO');
  const [drawLeadMinutes, setDrawLeadMinutes] = useState(60);
  const [openLeadDays, setOpenLeadDays] = useState(7);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function handleCreate() {
    try {
      setActionMessage(null);
      await create({
        dayOfWeek,
        startTime,
        endTime,
        location,
        slotDurationMinutes,
        therapistCount,
        mode,
        ...(mode === 'LOTTERY' ? { drawMode, drawLeadMinutes } : {}),
        openLeadDays,
      });
      setActionMessage('排程已建立');
      setLocation('');
      refresh();
    } catch {
      // error is set in hook
    }
  }

  async function handleToggle(scheduleId: string) {
    try {
      setActionMessage(null);
      await toggle(scheduleId);
      refresh();
    } catch (e) {
      setActionMessage((e as Error).message);
    }
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>排程管理</h1>

      {actionMessage && <p style={styles.message}>{actionMessage}</p>}
      {createError && <p style={styles.error}>{createError}</p>}

      {/* Existing Schedules */}
      <h2 style={styles.sectionTitle}>現有排程</h2>
      {loading ? (
        <p style={styles.empty}>載入中...</p>
      ) : error ? (
        <p style={styles.error}>錯誤: {error}</p>
      ) : schedules.length === 0 ? (
        <p style={styles.empty}>尚無排程</p>
      ) : (
        <div style={styles.list}>
          {schedules.map((s) => (
            <div key={s.scheduleId} style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={styles.cardDay}>{DAY_NAMES[s.dayOfWeek]}</span>
                <div style={styles.badgeRow}>
                  <span style={s.mode === 'LOTTERY' ? styles.lotteryBadge : styles.fcfsBadge}>
                    {s.mode === 'LOTTERY' ? '抽籤' : '先到先得'}
                  </span>
                  <span style={s.status === 'ACTIVE' ? styles.activeBadge : styles.pausedBadge}>
                    {s.status === 'ACTIVE' ? '啟用' : '暫停'}
                  </span>
                </div>
              </div>
              <p style={styles.cardTime}>{s.startTime} – {s.endTime}</p>
              <p style={styles.cardMeta}>{s.location}</p>
              <p style={styles.cardMeta}>
                每節 {s.slotDurationMinutes} 分鐘 / {s.therapistCount} 位治療師
              </p>
              <button
                style={s.status === 'ACTIVE' ? styles.pauseBtn : styles.resumeBtn}
                disabled={toggling}
                onClick={() => handleToggle(s.scheduleId)}
              >
                {s.status === 'ACTIVE' ? '暫停' : '啟用'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Create New Schedule */}
      <h2 style={{ ...styles.sectionTitle, marginTop: 32 }}>新增排程</h2>
      <div style={styles.form}>
        <label style={styles.label}>星期</label>
        <select
          style={styles.input}
          value={dayOfWeek}
          onChange={(e) => setDayOfWeek(Number(e.target.value))}
        >
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <option key={d} value={d}>{DAY_NAMES[d]}</option>
          ))}
        </select>

        <label style={styles.label}>開始時間</label>
        <input
          type="time"
          style={styles.input}
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
        />

        <label style={styles.label}>結束時間</label>
        <input
          type="time"
          style={styles.input}
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
        />

        <label style={styles.label}>地點</label>
        <input
          type="text"
          style={styles.input}
          value={location}
          placeholder="例如：3F 休息室"
          onChange={(e) => setLocation(e.target.value)}
        />

        <label style={styles.label}>每節時間 (分鐘)</label>
        <input
          type="number"
          style={styles.input}
          value={slotDurationMinutes}
          min={5}
          onChange={(e) => setSlotDurationMinutes(Number(e.target.value))}
        />

        <label style={styles.label}>治療師人數</label>
        <input
          type="number"
          style={styles.input}
          value={therapistCount}
          min={1}
          onChange={(e) => setTherapistCount(Number(e.target.value))}
        />

        <label style={styles.label}>模式</label>
        <div style={styles.radioGroup}>
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
        </div>

        {mode === 'LOTTERY' && (
          <>
            <label style={styles.label}>抽籤模式</label>
            <div style={styles.radioGroup}>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="drawMode"
                  value="AUTO"
                  checked={drawMode === 'AUTO'}
                  onChange={() => setDrawMode('AUTO')}
                />
                自動
              </label>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="drawMode"
                  value="MANUAL"
                  checked={drawMode === 'MANUAL'}
                  onChange={() => setDrawMode('MANUAL')}
                />
                手動
              </label>
            </div>

            <label style={styles.label}>抽籤提前時間 (分鐘)</label>
            <input
              type="number"
              style={styles.input}
              value={drawLeadMinutes}
              min={0}
              onChange={(e) => setDrawLeadMinutes(Number(e.target.value))}
            />
          </>
        )}

        <label style={styles.label}>開放預約提前天數</label>
        <input
          type="number"
          style={styles.input}
          value={openLeadDays}
          min={0}
          onChange={(e) => setOpenLeadDays(Number(e.target.value))}
        />

        <button
          style={styles.submitBtn}
          disabled={creating || !location.trim()}
          onClick={handleCreate}
        >
          {creating ? '建立中...' : '建立排程'}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 16, fontFamily: 'sans-serif', maxWidth: 480, margin: '0 auto' },
  title: { fontSize: 22, margin: '0 0 16px 0' },
  sectionTitle: { fontSize: 18, margin: '0 0 12px 0', color: '#333' },
  message: { textAlign: 'center', color: '#1a73e8', marginTop: 8, marginBottom: 8, fontSize: 14 },
  empty: { color: '#999', textAlign: 'center', marginTop: 20 },
  error: { color: '#e74c3c', textAlign: 'center', marginTop: 8, fontSize: 14 },
  list: { display: 'flex', flexDirection: 'column', gap: 12 },
  card: {
    padding: 16,
    border: '1px solid #e0e0e0',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardDay: { fontSize: 16, fontWeight: 'bold' },
  cardTime: { margin: '4px 0', fontSize: 14, color: '#333' },
  cardMeta: { margin: '4px 0', fontSize: 13, color: '#666' },
  badgeRow: { display: 'flex', gap: 6 },
  fcfsBadge: {
    padding: '2px 10px',
    borderRadius: 12,
    backgroundColor: '#e3f2fd',
    color: '#1565c0',
    fontSize: 12,
    fontWeight: 'bold',
  },
  lotteryBadge: {
    padding: '2px 10px',
    borderRadius: 12,
    backgroundColor: '#fff3e0',
    color: '#e65100',
    fontSize: 12,
    fontWeight: 'bold',
  },
  activeBadge: {
    padding: '2px 10px',
    borderRadius: 12,
    backgroundColor: '#e8f5e9',
    color: '#2e7d32',
    fontSize: 12,
    fontWeight: 'bold',
  },
  pausedBadge: {
    padding: '2px 10px',
    borderRadius: 12,
    backgroundColor: '#f5f5f5',
    color: '#757575',
    fontSize: 12,
    fontWeight: 'bold',
  },
  pauseBtn: {
    marginTop: 12,
    width: '100%',
    padding: '10px 0',
    backgroundColor: '#fff',
    color: '#757575',
    border: '1px solid #bdbdbd',
    borderRadius: 8,
    fontSize: 14,
    cursor: 'pointer',
  },
  resumeBtn: {
    marginTop: 12,
    width: '100%',
    padding: '10px 0',
    backgroundColor: '#1DB446',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    cursor: 'pointer',
  },
  form: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 14, fontWeight: 'bold', color: '#333', marginTop: 4 },
  input: {
    padding: '10px 12px',
    border: '1px solid #ccc',
    borderRadius: 8,
    fontSize: 14,
    outline: 'none',
  },
  radioGroup: { display: 'flex', gap: 16 },
  radioLabel: { fontSize: 14, display: 'flex', alignItems: 'center', gap: 4 },
  submitBtn: {
    marginTop: 16,
    padding: '12px 0',
    backgroundColor: '#1DB446',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 'bold',
    cursor: 'pointer',
  },
};
