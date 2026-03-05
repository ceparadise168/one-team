import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../auth-context';
import { useSessionBookings, useAdminCancelBooking, useExecuteDraw } from './use-massage';
import type { MassageBooking } from './use-massage';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('zh-TW')} ${d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

function getStatusBadge(status: MassageBooking['status']): { label: string; style: React.CSSProperties } {
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
    if (!confirm(`確定要執行抽籤嗎？共 ${registeredCount} 人登記，將抽出 ${session?.quota ?? '?'} 名。`)) return;
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
  const canDraw = session?.mode === 'LOTTERY' && !session.drawnAt && registeredCount > 0;

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>場次預約明細</h1>

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
                  style={session.status === 'ACTIVE' ? styles.activeBadge : styles.cancelledStatusBadge}
                >
                  {session.status === 'ACTIVE' ? '進行中' : '已取消'}
                </span>
              </div>
              <p style={styles.cardTime}>
                {formatTime(session.startAt)} – {formatTime(session.endAt)}
              </p>
              <p style={styles.cardMeta}>{session.location}</p>
              <p style={styles.cardMeta}>
                名額: {session.quota} · {session.mode === 'LOTTERY' ? '抽籤制' : '先到先得'}
              </p>
              {session.mode === 'LOTTERY' && session.drawAt && (
                <p style={styles.cardMeta}>
                  抽籤時間: {formatDateTime(session.drawAt)}
                  {session.drawnAt && ` (已於 ${formatDateTime(session.drawnAt)} 執行)`}
                </p>
              )}
              <p style={styles.statsRow}>
                {session.mode === 'LOTTERY'
                  ? `登記: ${registeredCount} 人 · 中籤: ${confirmedCount} 人`
                  : `已預約: ${confirmedCount} / ${session.quota} 人`}
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
              {bookings.map((bk) => {
                const badge = getStatusBadge(bk.status);
                const canCancel = bk.status === 'CONFIRMED' || bk.status === 'REGISTERED';
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
          )}
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 16, fontFamily: 'sans-serif', maxWidth: 480, margin: '0 auto' },
  title: { fontSize: 22, margin: '0 0 16px 0' },
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
  activeBadge: {
    padding: '2px 10px',
    borderRadius: 12,
    backgroundColor: '#e8f5e9',
    color: '#2e7d32',
    fontSize: 12,
    fontWeight: 'bold',
  },
  cancelledStatusBadge: {
    padding: '2px 10px',
    borderRadius: 12,
    backgroundColor: '#ffebee',
    color: '#c62828',
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
