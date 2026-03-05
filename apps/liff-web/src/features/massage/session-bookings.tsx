import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth-context';
import { useSessionBookings, useAdminCancelBooking, useExecuteDraw } from './use-massage';
import type { MassageBooking } from './use-massage';
import { formatTime, formatDateTime, formatSlotRange, sharedStyles } from './massage-shared';

function getStatusBadge(status: MassageBooking['status']): { label: string; style: React.CSSProperties } {
  switch (status) {
    case 'CONFIRMED':
      return { label: '預約成功', style: sharedStyles.confirmedBadge };
    case 'REGISTERED':
      return { label: '等待抽籤', style: sharedStyles.registeredBadge };
    case 'WAITLISTED':
      return { label: '候補中', style: sharedStyles.waitlistedBadge };
    case 'UNSUCCESSFUL':
      return { label: '未中籤', style: sharedStyles.unsuccessfulBadge };
    case 'CANCELLED':
      return { label: '已取消', style: sharedStyles.cancelledBadge };
  }
}

export function SessionBookings() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { apiBaseUrl, accessToken } = useAuth();
  const { session, bookings, loading, error, refresh } = useSessionBookings(
    apiBaseUrl,
    accessToken,
    sessionId!
  );
  const { cancel, loading: cancelling } = useAdminCancelBooking(apiBaseUrl, accessToken);
  const { draw, loading: drawing } = useExecuteDraw(apiBaseUrl, accessToken);
  const navigate = useNavigate();
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function handleAdminCancel(bookingId: string) {
    if (!confirm('確定要取消此預約嗎？')) return;
    try {
      setActionMessage(null);
      await cancel(bookingId);
      setActionMessage('已取消該預約');
      refresh();
    } catch (e) {
      setActionMessage((e as Error).message);
    }
  }

  async function handleDraw() {
    const registeredCount = bookings.filter(b => b.status === 'REGISTERED').length;
    if (!confirm(`確定要執行抽籤嗎？共 ${registeredCount} 人登記。`)) return;
    try {
      setActionMessage(null);
      await draw(sessionId!);
      setActionMessage('抽籤完成！已通知所有參與者。');
      refresh();
    } catch (e) {
      setActionMessage((e as Error).message);
    }
  }

  const registeredCount = bookings.filter(b => b.status === 'REGISTERED').length;
  const confirmedCount = bookings.filter(b => b.status === 'CONFIRMED').length;
  const waitlistedCount = bookings.filter(b => b.status === 'WAITLISTED').length;
  const canDraw = session?.mode === 'LOTTERY' && !session.drawnAt && registeredCount > 0;

  // Group bookings by slotStartAt
  const slotGroups = new Map<string, MassageBooking[]>();
  for (const bk of bookings) {
    const key = bk.slotStartAt || '_unknown';
    if (!slotGroups.has(key)) slotGroups.set(key, []);
    slotGroups.get(key)!.push(bk);
  }
  const sortedSlotKeys = [...slotGroups.keys()].sort();

  return (
    <div style={styles.container}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button style={sharedStyles.backBtn} onClick={() => navigate('/massage/admin')}>← 返回管理</button>
        <h1 style={styles.title}>場次預約明細</h1>
      </div>

      {loading ? (
        <p style={styles.empty}>載入中...</p>
      ) : error ? (
        <p style={styles.error}>錯誤: {error}</p>
      ) : (
        <>
          {session && (
            <div style={styles.sessionCard}>
              <div style={styles.cardHeader}>
                <span style={styles.cardDate}>{session.date}</span>
                <span
                  style={session.status === 'ACTIVE' ? sharedStyles.activeBadge : sharedStyles.cancelledBadge}
                >
                  {session.status === 'ACTIVE' ? '進行中' : '已取消'}
                </span>
              </div>
              <p style={styles.cardTime}>
                {formatTime(session.startAt)} – {formatTime(session.endAt)}
              </p>
              <p style={styles.cardMeta}>{session.location}</p>
              <p style={styles.cardMeta}>
                {session.slotDurationMinutes}分/節 · {session.therapistCount}位按摩師 · {session.mode === 'LOTTERY' ? '抽籤制' : '先到先得'}
              </p>
              {session.mode === 'LOTTERY' && session.drawAt && (
                <p style={styles.cardMeta}>
                  抽籤時間: {formatDateTime(session.drawAt)}
                  {' · '}
                  {(session.drawMode ?? 'AUTO') === 'AUTO' ? '自動抽籤' : '手動抽籤'}
                  {session.drawnAt && ` (已於 ${formatDateTime(session.drawnAt)} 執行)`}
                </p>
              )}
              <p style={styles.statsRow}>
                {session.mode === 'LOTTERY'
                  ? `登記: ${registeredCount} 人 · 中籤: ${confirmedCount} 人${waitlistedCount > 0 ? ` · 候補: ${waitlistedCount} 人` : ''}`
                  : `已預約: ${confirmedCount} 人${waitlistedCount > 0 ? ` · 候補: ${waitlistedCount} 人` : ''}`}
              </p>
            </div>
          )}

          {/* Draw button for LOTTERY mode */}
          {canDraw && (
            <button
              style={styles.drawBtn}
              disabled={drawing}
              onClick={handleDraw}
            >
              {drawing ? '抽籤中...' : `執行抽籤（${registeredCount} 人登記）`}
            </button>
          )}

          {actionMessage && <p style={styles.message}>{actionMessage}</p>}

          <h2 style={styles.subtitle}>預約列表 ({bookings.length})</h2>

          {bookings.length === 0 ? (
            <p style={styles.empty}>尚無預約</p>
          ) : (
            <div style={styles.list}>
              {sortedSlotKeys.map((slotKey) => {
                const slotBookings = slotGroups.get(slotKey)!;
                const slotConfirmed = slotBookings.filter(b => b.status === 'CONFIRMED').length;
                const slotWaitlisted = slotBookings.filter(b => b.status === 'WAITLISTED').length;
                const slotLabel =
                  slotKey === '_unknown'
                    ? '未指定時段'
                    : session
                      ? formatSlotRange(slotKey, session.slotDurationMinutes)
                      : formatTime(slotKey);
                return (
                  <div key={slotKey}>
                    <div style={styles.slotHeader}>
                      <span style={styles.slotHeaderTime}>{slotLabel}</span>
                      <span style={styles.slotHeaderCount}>
                        {slotConfirmed} 已確認{slotWaitlisted > 0 ? ` · ${slotWaitlisted} 候補` : ''}
                      </span>
                    </div>
                    {slotBookings.map((bk) => {
                      const badge = getStatusBadge(bk.status);
                      const canCancel = bk.status === 'CONFIRMED' || bk.status === 'REGISTERED' || bk.status === 'WAITLISTED';
                      return (
                        <div key={bk.bookingId} style={styles.card}>
                          <div style={styles.cardHeader}>
                            <span style={styles.employeeId}>{bk.employeeId}</span>
                            <span style={badge.style}>{badge.label}</span>
                          </div>
                          <p style={styles.cardMeta}>
                            登記時間: {new Date(bk.createdAt).toLocaleString('zh-TW')}
                          </p>
                          {bk.cancelledAt && (
                            <p style={styles.cardMeta}>
                              取消時間: {new Date(bk.cancelledAt).toLocaleString('zh-TW')}
                              {bk.cancellationReason && ` (${bk.cancellationReason})`}
                            </p>
                          )}
                          {canCancel && (
                            <button
                              style={styles.adminCancelBtn}
                              disabled={cancelling}
                              onClick={() => handleAdminCancel(bk.bookingId)}
                            >
                              管理員取消
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 16, fontFamily: 'sans-serif', maxWidth: 480, margin: '0 auto' },
  title: { fontSize: 22, margin: 0 },
  subtitle: { fontSize: 16, margin: '20px 0 12px 0', color: '#333' },
  message: { textAlign: 'center', color: '#1a73e8', marginTop: 8, marginBottom: 8, fontSize: 14 },
  empty: { color: '#999', textAlign: 'center', marginTop: 40 },
  error: { color: '#e74c3c', textAlign: 'center', marginTop: 40 },
  list: { display: 'flex', flexDirection: 'column', gap: 12 },
  sessionCard: {
    padding: 16,
    border: '2px solid #1DB446',
    borderRadius: 12,
    backgroundColor: '#f9fff9',
    marginBottom: 8,
  },
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
  statsRow: {
    margin: '8px 0 0 0',
    fontSize: 14,
    color: '#1DB446',
    fontWeight: 'bold',
  },
  employeeId: { fontSize: 15, fontWeight: 'bold' },
  slotHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    marginBottom: 8,
  },
  slotHeaderTime: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  slotHeaderCount: {
    fontSize: 12,
    color: '#666',
  },
  drawBtn: {
    width: '100%',
    padding: '12px 0',
    backgroundColor: '#e65100',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 'bold',
    cursor: 'pointer',
    marginBottom: 8,
  },
  adminCancelBtn: {
    marginTop: 10,
    width: '100%',
    padding: '8px 0',
    backgroundColor: '#fff',
    color: '#e74c3c',
    border: '1px solid #e74c3c',
    borderRadius: 8,
    fontSize: 13,
    cursor: 'pointer',
  },
};
