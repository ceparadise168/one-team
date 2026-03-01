import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth-context';
import { useActivities, useMyActivities } from './use-volunteer';
import { CITIES } from '../../constants';

type Tab = 'all' | 'mine';

export function ActivityList() {
  const { apiBaseUrl, accessToken } = useAuth();
  const { activities, loading: allLoading, error } = useActivities(apiBaseUrl, accessToken);
  const { registrations, loading: myLoading } = useMyActivities(apiBaseUrl, accessToken);
  const [tab, setTab] = useState<Tab>('all');
  const [cityFilter, setCityFilter] = useState<string>('');

  const loading = tab === 'all' ? allLoading : myLoading;

  const filteredActivities = cityFilter
    ? activities.filter((a) => a.city === cityFilter)
    : activities;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>志工活動</h1>
        <Link to="/volunteer/create" style={styles.createBtn}>
          建立活動
        </Link>
      </div>

      {/* Tab bar */}
      <div style={styles.tabBar}>
        <button
          style={tab === 'all' ? styles.tabActive : styles.tab}
          onClick={() => setTab('all')}
        >
          全部活動
        </button>
        <button
          style={tab === 'mine' ? styles.tabActive : styles.tab}
          onClick={() => setTab('mine')}
        >
          我的報名
        </button>
      </div>

      {/* City filter chips (only on "all" tab) */}
      {tab === 'all' && (
        <div style={styles.chipScroll}>
          <button
            style={!cityFilter ? styles.chipActive : styles.chip}
            onClick={() => setCityFilter('')}
          >
            全部
          </button>
          {CITIES.map((c) => (
            <button
              key={c}
              style={cityFilter === c ? styles.chipActive : styles.chip}
              onClick={() => setCityFilter(cityFilter === c ? '' : c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p style={styles.empty}>載入中...</p>
      ) : error ? (
        <p style={styles.error}>錯誤: {error}</p>
      ) : tab === 'all' ? (
        /* All activities tab */
        filteredActivities.length === 0 ? (
          <p style={styles.empty}>
            {cityFilter ? `${cityFilter}目前沒有活動` : '目前沒有開放中的活動'}
          </p>
        ) : (
          <div style={styles.list}>
            {filteredActivities.map((activity) => (
              <Link
                key={activity.activityId}
                to={`/volunteer/${activity.activityId}`}
                style={styles.card}
              >
                {activity.city && <span style={styles.cityBadge}>{activity.city}</span>}
                <h3 style={styles.cardTitle}>{activity.title}</h3>
                <p style={styles.cardMeta}>
                  {activity.activityDate} {activity.startTime}–{activity.endTime}
                </p>
                <p style={styles.cardMeta}>{activity.location}</p>
                <span style={styles.badge}>
                  {activity.checkInMode === 'organizer-scan' ? '主辦掃碼' : '自助掃碼'}
                </span>
              </Link>
            ))}
          </div>
        )
      ) : /* My registrations tab */
      registrations.length === 0 ? (
        <p style={styles.empty}>尚未報名任何活動</p>
      ) : (
        <div style={styles.list}>
          {registrations.map((reg) => (
            <Link
              key={reg.activityId}
              to={`/volunteer/${reg.activityId}`}
              style={styles.card}
            >
              {reg.activity ? (
                <>
                  {reg.activity.city && (
                    <span style={styles.cityBadge}>{reg.activity.city}</span>
                  )}
                  <h3 style={styles.cardTitle}>{reg.activity.title}</h3>
                  <p style={styles.cardMeta}>
                    {reg.activity.activityDate} {reg.activity.startTime}–{reg.activity.endTime}
                  </p>
                  <p style={styles.cardMeta}>{reg.activity.location}</p>
                </>
              ) : (
                <h3 style={styles.cardTitle}>活動 {reg.activityId}</h3>
              )}
              <div style={styles.badgeRow}>
                <span style={styles.registeredBadge}>已報名</span>
                {reg.checkedIn ? (
                  <span style={styles.checkedInBadge}>已打卡</span>
                ) : (
                  <span style={styles.notCheckedInBadge}>未打卡</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 16, fontFamily: 'sans-serif', maxWidth: 480, margin: '0 auto' },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 22, margin: 0 },
  createBtn: {
    padding: '8px 16px',
    backgroundColor: '#1DB446',
    color: 'white',
    borderRadius: 8,
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 'bold',
  },
  tabBar: {
    display: 'flex',
    gap: 0,
    marginBottom: 12,
    borderBottom: '2px solid #e0e0e0',
  },
  tab: {
    flex: 1,
    padding: '10px 0',
    border: 'none',
    background: 'none',
    fontSize: 15,
    color: '#999',
    cursor: 'pointer',
    borderBottom: '2px solid transparent',
    marginBottom: -2,
  },
  tabActive: {
    flex: 1,
    padding: '10px 0',
    border: 'none',
    background: 'none',
    fontSize: 15,
    color: '#1DB446',
    fontWeight: 'bold',
    cursor: 'pointer',
    borderBottom: '2px solid #1DB446',
    marginBottom: -2,
  },
  chipScroll: {
    display: 'flex',
    gap: 8,
    overflowX: 'auto',
    paddingBottom: 8,
    marginBottom: 12,
  },
  chip: {
    flexShrink: 0,
    padding: '6px 14px',
    borderRadius: 20,
    border: '1px solid #ddd',
    background: '#fff',
    fontSize: 13,
    color: '#555',
    cursor: 'pointer',
  },
  chipActive: {
    flexShrink: 0,
    padding: '6px 14px',
    borderRadius: 20,
    border: '1px solid #1DB446',
    background: '#e8f5e9',
    fontSize: 13,
    color: '#1DB446',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  empty: { color: '#999', textAlign: 'center', marginTop: 40 },
  list: { display: 'flex', flexDirection: 'column', gap: 12 },
  card: {
    padding: 16,
    border: '1px solid #e0e0e0',
    borderRadius: 12,
    textDecoration: 'none',
    color: '#333',
    backgroundColor: '#fff',
  },
  cardTitle: { margin: '0 0 8px 0', fontSize: 16 },
  cardMeta: { margin: '4px 0', fontSize: 13, color: '#666' },
  cityBadge: {
    display: 'inline-block',
    marginBottom: 6,
    padding: '2px 8px',
    backgroundColor: '#e3f2fd',
    borderRadius: 4,
    fontSize: 12,
    color: '#1565c0',
  },
  badge: {
    display: 'inline-block',
    marginTop: 8,
    padding: '2px 8px',
    backgroundColor: '#f0f0f0',
    borderRadius: 4,
    fontSize: 12,
    color: '#555',
  },
  badgeRow: { display: 'flex', gap: 8, marginTop: 8 },
  registeredBadge: {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: 12,
    backgroundColor: '#e3f2fd',
    color: '#1565c0',
    fontSize: 12,
    fontWeight: 'bold',
  },
  checkedInBadge: {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: 12,
    backgroundColor: '#e8f5e9',
    color: '#2e7d32',
    fontSize: 12,
    fontWeight: 'bold',
  },
  notCheckedInBadge: {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: 12,
    backgroundColor: '#f5f5f5',
    color: '#999',
    fontSize: 12,
  },
  error: { color: '#e74c3c' },
};
