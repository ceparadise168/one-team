import { useState } from 'react';
import type { Expense, TripParticipant } from './use-camping';
import type React from 'react';

interface Props {
  expenses: Expense[];
  participants: TripParticipant[];
  isOpen: boolean;
  onAdd: (input: { description: string; amount: number; paidByParticipantId: string; splitType: 'ALL' | 'CUSTOM'; splitAmong: string[] | null }) => Promise<void>;
  onRemove: (expenseId: string) => Promise<void>;
}

export function ExpensesTab({ expenses, participants, isOpen, onAdd, onRemove }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState('');
  const [splitType, setSplitType] = useState<'ALL' | 'CUSTOM'>('ALL');
  const [splitAmong, setSplitAmong] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const nameOf = new Map(participants.map(p => [p.participantId, p.name]));
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  const handleSubmit = async () => {
    if (!description.trim() || !amount || !paidBy) return;
    if (splitType === 'CUSTOM' && splitAmong.size === 0) return;
    setSubmitting(true);
    try {
      await onAdd({
        description: description.trim(),
        amount: Number(amount),
        paidByParticipantId: paidBy,
        splitType,
        splitAmong: splitType === 'CUSTOM' ? [...splitAmong] : null,
      });
      setDescription(''); setAmount(''); setPaidBy('');
      setSplitType('ALL'); setSplitAmong(new Set()); setShowForm(false);
    } finally { setSubmitting(false); }
  };

  const toggleSplitMember = (pid: string) => {
    const next = new Set(splitAmong);
    if (next.has(pid)) next.delete(pid); else next.add(pid);
    setSplitAmong(next);
  };

  return (
    <div>
      <div style={styles.summary}>
        {expenses.length} 筆費用，共 ${totalExpenses.toLocaleString()}
      </div>

      {expenses.map(exp => (
        <div key={exp.expenseId} style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.cardTitle}>{exp.description}</span>
            <span style={styles.cardAmount}>${exp.amount.toLocaleString()}</span>
          </div>
          <div style={styles.cardDetail}>
            代墊: {nameOf.get(exp.paidByParticipantId) ?? '?'}
          </div>
          <div style={styles.cardDetail}>
            分帳: {exp.splitType === 'ALL' ? '所有人' : (exp.splitAmong?.map(id => nameOf.get(id) ?? '?').join('、') ?? '?')}
          </div>
          {isOpen && (
            <button onClick={() => onRemove(exp.expenseId)} style={styles.removeBtn}>刪除</button>
          )}
        </div>
      ))}

      {isOpen && !showForm && (
        <button onClick={() => setShowForm(true)} style={styles.addBtn}>+ 新增費用</button>
      )}

      {showForm && (
        <div style={styles.formCard}>
          <div style={styles.formTitle}>新增費用</div>
          <input style={styles.input} placeholder="費用說明" value={description} onChange={e => setDescription(e.target.value)} />
          <input style={styles.input} placeholder="金額" type="number" value={amount} onChange={e => setAmount(e.target.value)} />

          <div style={styles.fieldLabel}>代墊人</div>
          <select style={styles.select} value={paidBy} onChange={e => setPaidBy(e.target.value)}>
            <option value="">選擇代墊人</option>
            {participants.map(p => (
              <option key={p.participantId} value={p.participantId}>{p.name}</option>
            ))}
          </select>

          <div style={styles.fieldLabel}>分帳方式</div>
          <div style={styles.radioRow}>
            <label style={styles.radioLabel}>
              <input type="radio" checked={splitType === 'ALL'} onChange={() => setSplitType('ALL')} />
              所有人均分
            </label>
            <label style={styles.radioLabel}>
              <input type="radio" checked={splitType === 'CUSTOM'} onChange={() => setSplitType('CUSTOM')} />
              指定對象
            </label>
          </div>

          {splitType === 'CUSTOM' && (
            <div style={styles.checkboxGroup}>
              {participants.map(p => (
                <label key={p.participantId} style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={splitAmong.has(p.participantId)}
                    onChange={() => toggleSplitMember(p.participantId)}
                  />
                  {p.name}
                </label>
              ))}
            </div>
          )}

          <div style={styles.formActions}>
            <button onClick={() => setShowForm(false)} style={styles.cancelBtn}>取消</button>
            <button onClick={handleSubmit} disabled={submitting} style={styles.confirmBtn}>
              {submitting ? '新增中...' : '確認'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  summary: { fontSize: 13, color: '#888', marginBottom: 12 },
  card: {
    padding: 12, border: '1px solid #e0e0e0', borderRadius: 10,
    marginBottom: 10, backgroundColor: '#fff',
  },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontWeight: 600 },
  cardAmount: { fontSize: 15, fontWeight: 700, color: '#e65100' },
  cardDetail: { fontSize: 13, color: '#666', marginTop: 4 },
  removeBtn: {
    background: 'none', border: 'none', color: '#c62828', fontSize: 12,
    cursor: 'pointer', padding: '4px 0', marginTop: 6,
  },
  addBtn: {
    width: '100%', padding: '12px 0', border: '1px dashed #bbb', borderRadius: 8,
    backgroundColor: '#fff', fontSize: 14, cursor: 'pointer', color: '#555', marginTop: 12,
  },
  formCard: {
    padding: 16, border: '1px solid #e0e0e0', borderRadius: 12,
    marginTop: 12, backgroundColor: '#fff',
  },
  formTitle: { fontSize: 15, fontWeight: 600, marginBottom: 12 },
  fieldLabel: { fontSize: 13, fontWeight: 600, color: '#666', marginTop: 8, marginBottom: 4 },
  input: {
    padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8,
    fontSize: 14, width: '100%', boxSizing: 'border-box', marginBottom: 8,
  },
  select: {
    padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8,
    fontSize: 14, width: '100%', boxSizing: 'border-box', marginBottom: 8,
  },
  radioRow: { display: 'flex', gap: 16, marginBottom: 8 },
  radioLabel: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, cursor: 'pointer' },
  checkboxGroup: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer' },
  formActions: { display: 'flex', gap: 8, marginTop: 12 },
  cancelBtn: {
    flex: 1, padding: '10px 0', border: '1px solid #ddd', borderRadius: 8,
    backgroundColor: '#fff', fontSize: 14, cursor: 'pointer',
  },
  confirmBtn: {
    flex: 1, padding: '10px 0', border: 'none', borderRadius: 8,
    backgroundColor: '#1DB446', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },
};
