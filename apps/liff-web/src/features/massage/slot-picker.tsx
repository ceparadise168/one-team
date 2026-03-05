import React from 'react';
import type { SlotInfo } from './use-massage';

interface SlotPickerProps {
  slots: SlotInfo[];
  slotDurationMinutes: number;
  selectedSlot: string | null;
  onSelect: (slotStartAt: string) => void;
}

function formatSlotTime(iso: string, durationMinutes: number): string {
  const start = new Date(iso);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const fmt = (d: Date) =>
    d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${fmt(start)} - ${fmt(end)}`;
}

export function SlotPicker({ slots, slotDurationMinutes, selectedSlot, onSelect }: SlotPickerProps) {
  return (
    <div style={styles.grid}>
      {slots.map((slot) => {
        const isFull = slot.confirmed >= slot.capacity;
        const isSelected = selectedSlot === slot.startAt;
        return (
          <button
            key={slot.startAt}
            onClick={() => onSelect(slot.startAt)}
            style={{
              ...styles.slot,
              ...(isSelected ? styles.selectedSlot : {}),
              ...(isFull && !isSelected ? styles.fullSlot : {}),
            }}
          >
            <span style={styles.slotTime}>
              {formatSlotTime(slot.startAt, slotDurationMinutes)}
            </span>
            <span style={isFull ? styles.slotFull : styles.slotAvail}>
              {isFull
                ? `候補 (${slot.waitlisted}人等待)`
                : `${slot.confirmed}/${slot.capacity}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 8,
    marginTop: 12,
  },
  slot: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    padding: '10px 8px',
    border: '1px solid #e0e0e0',
    borderRadius: 10,
    backgroundColor: '#fff',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  selectedSlot: {
    border: '2px solid #1DB446',
    backgroundColor: '#e8f5e9',
  },
  fullSlot: {
    backgroundColor: '#fff8e1',
    borderColor: '#ffcc02',
  },
  slotTime: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  slotAvail: {
    fontSize: 12,
    color: '#1DB446',
    fontWeight: 'bold',
  },
  slotFull: {
    fontSize: 11,
    color: '#e65100',
    fontWeight: 'bold',
  },
};
