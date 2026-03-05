import type React from 'react';
import type { TripParticipant } from './use-camping';

export function groupByHousehold(participants: TripParticipant[]) {
  const households = new Map<string, TripParticipant[]>();
  const individuals: TripParticipant[] = [];
  for (const p of participants) {
    if (p.householdId) {
      if (!households.has(p.householdId)) households.set(p.householdId, []);
      households.get(p.householdId)!.push(p);
    } else {
      individuals.push(p);
    }
  }
  return { households, individuals };
}

export const campingStyles = {
  container: { padding: 16, fontFamily: 'sans-serif', maxWidth: 480, margin: '0 auto' } as React.CSSProperties,
  loading: { color: '#999', textAlign: 'center' } as React.CSSProperties,
  error: { color: '#c62828', textAlign: 'center' } as React.CSSProperties,
  backBtn: {
    background: 'none', border: 'none', color: '#1DB446', fontSize: 14,
    fontWeight: 'bold', cursor: 'pointer', padding: 0, marginBottom: 8,
  } as React.CSSProperties,
  summary: { fontSize: 13, color: '#888', marginBottom: 12 } as React.CSSProperties,
  card: {
    padding: 12, border: '1px solid #e0e0e0', borderRadius: 10,
    marginBottom: 10, backgroundColor: '#fff',
  } as React.CSSProperties,
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } as React.CSSProperties,
  input: {
    padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8,
    fontSize: 14, width: '100%', boxSizing: 'border-box', marginBottom: 8,
  } as React.CSSProperties,
  select: {
    padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8,
    fontSize: 14, width: '100%', boxSizing: 'border-box', marginBottom: 8,
  } as React.CSSProperties,
  formCard: {
    padding: 16, border: '1px solid #e0e0e0', borderRadius: 12,
    marginTop: 12, backgroundColor: '#fff',
  } as React.CSSProperties,
  formTitle: { fontSize: 15, fontWeight: 600, marginBottom: 12 } as React.CSSProperties,
  fieldLabel: { fontSize: 13, fontWeight: 600, color: '#666', marginTop: 8, marginBottom: 4 } as React.CSSProperties,
  formActions: { display: 'flex', gap: 8, marginTop: 12 } as React.CSSProperties,
  cancelBtn: {
    flex: 1, padding: '10px 0', border: '1px solid #ddd', borderRadius: 8,
    backgroundColor: '#fff', fontSize: 14, cursor: 'pointer',
  } as React.CSSProperties,
  confirmBtn: {
    flex: 1, padding: '10px 0', border: 'none', borderRadius: 8,
    backgroundColor: '#1DB446', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  } as React.CSSProperties,
  addBtn: {
    width: '100%', padding: '12px 0', border: '1px dashed #bbb', borderRadius: 8,
    backgroundColor: '#fff', fontSize: 14, cursor: 'pointer', color: '#555', marginTop: 12,
  } as React.CSSProperties,
  removeBtn: {
    background: 'none', border: 'none', color: '#c62828', fontSize: 12,
    cursor: 'pointer', padding: '4px 0', marginTop: 6,
  } as React.CSSProperties,
  checkboxGroup: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 } as React.CSSProperties,
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer' } as React.CSSProperties,
} as const;
