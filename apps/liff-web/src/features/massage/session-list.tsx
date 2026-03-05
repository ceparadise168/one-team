import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth-context';
import {
  useMassageSessions,
  useMyMassageBookings,
  useMassageBook,
  useCancelMassageBooking,
} from './use-massage';
import type { MassageSession, MassageBooking } from './use-massage';

type Tab = 'sessions' | 'bookings';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('zh-TW')} ${d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

function canCancelBooking(booking: MassageBooking, session: MassageSession | undefined): boolean {
  if (booking.status !== 'CONFIRMED' && booking.status !== 'REGISTERED') return false;
  if (!session) return false;
  const twoHoursBefore = new Date(new Date(session.startAt).getTime() - 2 * 60 * 60 * 1000);
  return new Date() < twoHoursBefore;
}

/** Employee-facing booking status */
function getBookingStatusBadge(status: MassageBooking['status']): { label: string; style: React.CSSProperties } {
  switch (status) {
    case 'CONFIRMED':
      return { label: '預約成功', style: styles.confirmedBadge };
    case 'REGISTERED':
      return { label: '等待抽籤', style: styles.registeredBadge };
    case 'UNSUCCESSFUL':
      return { label: '未中籤', style: styles.unsuccessfulBadge };
    case 'CANCELLED':
      return { label: '已取消', style: styles.cancelledBadge };
  }
}

/** Determine what the session card button should show */
function getSessionAction(
  session: MassageSession,
  myBookings: MassageBooking[]
): { label: string; disabled: boolean; booked: boolean; statusLabel?: string; statusStyle?: React.CSSProperties } {
  // Check if user has an active booking for this session
  const activeBooking = myBookings.find(
    (b) => b.sessionId === session.sessionId && b.status !== 'CANCELLED'
  );

  if (activeBooking) {
    const badge = getBookingStatusBadge(activeBooking.status);
    return { label: '', disabled: true, booked: true, statusLabel: badge.label, statusStyle: badge.style };
  }

  const now = new Date();
  if (new Date(session.openAt) > now) {
    return { label: '尚未開放', disabled: true, booked: false };
  }

  if (session.mode === 'LOTTERY') {
    if (session.drawAt && new Date(session.drawAt) <= now) {
      return { label: '報名已截止', disabled: true, booked: false };
    }
    return { label: '登記抽籤', disabled: false, booked: false };
  }

  return { label: '立即預約', disabled: false, booked: false };
}

export function SessionList() {
  const { apiBaseUrl, accessToken } = useAuth();
  const { sessions, loading: sessionsLoading, error: sessionsError, refresh: refreshSessions } =
    useMassageSessions(apiBaseUrl, accessToken);
  const { bookings, loading: bookingsLoading, error: bookingsError, refresh: refreshBookings } =
    useMyMassageBookings(apiBaseUrl, accessToken);
  const { book, loading: booking } = useMassageBook(apiBaseUrl, accessToken);
  const { cancel, loading: cancelling } = useCancelMassageBooking(apiBaseUrl, accessToken);

  const [tab, setTab] = useState<Tab>('sessions');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loading = tab === 'sessions' ? sessionsLoading : bookingsLoading;
  const error = tab === 'sessions' ? sessionsError : bookingsError;

  const activeSessions = sessions.filter((s) => s.status === 'ACTIVE');

  async function handleBook(session: MassageSession) {
    const confirmMsg = session.mode === 'LOTTERY'
      ? '確定要登記抽籤嗎？'
      : '確定要預約此場次嗎？';
    if (!confirm(confirmMsg)) return;
    try {
      setActionMessage(null);
      await book(session.sessionId);
      setActionMessage(session.mode === 'LOTTERY' ? '已登記抽籤！' : '預約成功！');
      refreshSessions();
      refreshBookings();
    } catch (e) {
      setActionMessage((e as Error).message);
    }
  }

  async function handleCancelBooking(bookingId: string) {
    if (!confirm('確定要取消嗎？')) return;
    try {
      setActionMessage(null);
      await cancel(bookingId);
      setActionMessage('已取消');
      refreshSessions();
      refreshBookings();
    } catch (e) {
      setActionMessage((e as Error).message);
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <h1 style={styles.title}>按摩預約</h1>
        <Link to="/massage/admin" style={styles.adminLink}>管理</Link>
      </div>

      <div style={styles.tabBar}>
        <button
          style={tab === 'sessions' ? styles.tabActive : styles.tab}
          onClick={() => setTab('sessions')}
        >
          可預約場次
        </button>
        <button
          style={tab === 'bookings' ? styles.tabActive : styles.tab}
          onClick={() => setTab('bookings')}
        >
          我的預約
        </button>
      </div>

      {actionMessage && <p style={styles.message}>{actionMessage}</p>}

      {loading ? (
        <p style={styles.empty}>載入中...</p>
      ) : error ? (
        <p style={styles.error}>錯誤: {error}</p>
      ) : tab === 'sessions' ? (
        activeSessions.length === 0 ? (
          <p style={styles.empty}>目前沒有可預約的場次</p>
        ) : (
          <div style={styles.list}>
            {activeSessions.map((session) => {
              const action = getSessionAction(session, bookings);
              return (
                <div key={session.sessionId} style={styles.card}>
                  <div style={styles.cardHeader}>
                    <span style={styles.cardDate}>{session.date}</span>
                    <span style={session.mode === 'LOTTERY' ? styles.lotteryBadge : styles.fcfsBadge}>
                      {session.mode === 'LOTTERY' ? '抽籤制' : '先到先得'}
                    </span>
                  </div>
                  <p style={styles.cardTime}>
                    {formatTime(session.startAt)} – {formatTime(session.endAt)}
                  </p>
                  <p style={styles.cardMeta}>{session.location} · 名額 {session.quota}</p>
                  {session.mode === 'LOTTERY' && session.drawAt && (
                    <p style={styles.cardDrawTime}>
                      抽籤時間: {formatDateTime(session.drawAt)}
                    </p>
                  )}
                  <div style={styles.actionRow}>
                    {action.booked ? (
                      <span style={{ ...styles.bookedBadge, ...(action.statusStyle || {}) }}>
                        {action.statusLabel}
                      </span>
                    ) : (
                      <button
                        style={action.disabled ? styles.disabledBtn : styles.bookBtn}
                        disabled={action.disabled || booking}
                        onClick={() => handleBook(session)}
                      >
                        {action.label}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : bookings.length === 0 ? (
        <p style={styles.empty}>尚無預約紀錄</p>
      ) : (
        <div style={styles.list}>
          {bookings.map((bk) => {
            const session = sessions.find((s) => s.sessionId === bk.sessionId);
            const badge = getBookingStatusBadge(bk.status);
            const showCancel = canCancelBooking(bk, session);
            return (
              <div key={bk.bookingId} style={styles.card}>
                <div style={styles.cardHeader}>
                  <span style={styles.cardDate}>
                    {session ? session.date : '—'}
                  </span>
                  <span style={badge.style}>{badge.label}</span>
                </div>
                {session && (
                  <>
                    <p style={styles.cardTime}>
                      {formatTime(session.startAt)} – {formatTime(session.endAt)}
                    </p>
                    <p style={styles.cardMeta}>{session.location}</p>
                    <p style={styles.cardMeta}>
                      {session.mode === 'LOTTERY' ? '抽籤制' : '先到先得'} · 名額 {session.quota}
                    </p>
                  </>
                )}
                {showCancel && (
                  <button
                    style={styles.cancelBtn}
                    disabled={cancelling}
                    onClick={() => handleCancelBooking(bk.bookingId)}
                  >
                    取消預約
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 16, fontFamily: 'sans-serif', maxWidth: 480, margin: '0 auto' },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 22, margin: 0 },
  adminLink: {
    padding: '6px 14px',
    backgroundColor: '#f5f5f5',
    color: '#333',
    borderRadius: 8,
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 'bold',
  },
  tabBar: {
    display: 'flex',
    gap: 0,
    marginBottom: 16,
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
  message: { textAlign: 'center', color: '#1a73e8', marginTop: 8, marginBottom: 8, fontSize: 14 },
  empty: { color: '#999', textAlign: 'center', marginTop: 40 },
  error: { color: '#e74c3c', textAlign: 'center', marginTop: 40 },
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
  cardDate: { fontSize: 16, fontWeight: 'bold' },
  cardTime: { margin: '4px 0', fontSize: 14, color: '#333' },
  cardMeta: { margin: '4px 0', fontSize: 13, color: '#666' },
  cardDrawTime: {
    margin: '4px 0',
    fontSize: 13,
    color: '#e65100',
    fontWeight: 'bold',
  },
  actionRow: { marginTop: 12 },
  bookBtn: {
    width: '100%',
    padding: '10px 0',
    backgroundColor: '#1DB446',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  disabledBtn: {
    width: '100%',
    padding: '10px 0',
    backgroundColor: '#e0e0e0',
    color: '#999',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    cursor: 'not-allowed',
  },
  bookedBadge: {
    display: 'inline-block',
    padding: '6px 16px',
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 'bold',
  },
  cancelBtn: {
    marginTop: 12,
    width: '100%',
    padding: '10px 0',
    backgroundColor: '#fff',
    color: '#e74c3c',
    border: '1px solid #e74c3c',
    borderRadius: 8,
    fontSize: 14,
    cursor: 'pointer',
  },
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
  confirmedBadge: {
    padding: '2px 10px',
    borderRadius: 12,
    backgroundColor: '#e8f5e9',
    color: '#2e7d32',
    fontSize: 12,
    fontWeight: 'bold',
  },
  registeredBadge: {
    padding: '2px 10px',
    borderRadius: 12,
    backgroundColor: '#fff3e0',
    color: '#e65100',
    fontSize: 12,
    fontWeight: 'bold',
  },
  unsuccessfulBadge: {
    padding: '2px 10px',
    borderRadius: 12,
    backgroundColor: '#f5f5f5',
    color: '#999',
    fontSize: 12,
    fontWeight: 'bold',
  },
  cancelledBadge: {
    padding: '2px 10px',
    borderRadius: 12,
    backgroundColor: '#ffebee',
    color: '#c62828',
    fontSize: 12,
    fontWeight: 'bold',
  },
};
