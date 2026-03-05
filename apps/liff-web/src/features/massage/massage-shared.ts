import type React from 'react';

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('zh-TW')} ${d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

export function formatSlotRange(iso: string, durationMinutes: number): string {
  const start = new Date(iso);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return `${formatTime(start.toISOString())}–${formatTime(end.toISOString())}`;
}

const badge = (bg: string, color: string): React.CSSProperties => ({
  padding: '2px 10px',
  borderRadius: 12,
  fontSize: 12,
  fontWeight: 'bold',
  backgroundColor: bg,
  color,
});

export const sharedStyles = {
  backBtn: {
    background: 'none',
    border: 'none',
    color: '#1DB446',
    fontSize: 14,
    fontWeight: 'bold',
    cursor: 'pointer',
    padding: 0,
    whiteSpace: 'nowrap',
  } as React.CSSProperties,
  fcfsBadge: badge('#e3f2fd', '#1565c0'),
  lotteryBadge: badge('#fff3e0', '#e65100'),
  activeBadge: badge('#e8f5e9', '#2e7d32'),
  endedBadge: badge('#f5f5f5', '#999'),
  cancelledBadge: badge('#ffebee', '#c62828'),
  confirmedBadge: badge('#e8f5e9', '#2e7d32'),
  registeredBadge: badge('#fff3e0', '#e65100'),
  waitlistedBadge: badge('#fff3e0', '#e65100'),
  unsuccessfulBadge: badge('#f5f5f5', '#999'),
  pausedBadge: badge('#f5f5f5', '#757575'),
};
