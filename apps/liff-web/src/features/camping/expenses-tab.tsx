import { useState } from 'react';
import type { Expense, TripParticipant } from './use-camping';
import { campingStyles as cs } from './camping-shared';
import type React from 'react';

interface Props {
  expenses: Expense[];
  participants: TripParticipant[];
  isOpen: boolean;
  onAdd: (input: { description: string; amount: number; paidByParticipantId: string; splitType: 'ALL' | 'CUSTOM'; splitAmong: string[] | null }) => Promise<void>;
  onRemove: (expenseId: string) => Promise<void>;
  onUpdate?: (expenseId: string, input: { description: string; amount: number; paidByParticipantId: string; splitType: 'ALL' | 'CUSTOM'; splitAmong: string[] | null }) => Promise<void>;
}

export function ExpensesTab({ expenses, participants, isOpen, onAdd, onRemove, onUpdate }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState('');
  const [splitType, setSplitType] = useState<'ALL' | 'CUSTOM'>('ALL');
  const [splitAmong, setSplitAmong] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const nameOf = new Map(participants.map(p => [p.participantId, p.name]));
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  const resetForm = () => {
    setDescription(''); setAmount(''); setPaidBy('');
    setSplitType('ALL'); setSplitAmong(new Set());
    setShowForm(false); setEditingId(null);
  };

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
      resetForm();
    } finally { setSubmitting(false); }
  };

  const startEdit = (exp: Expense) => {
    setEditingId(exp.expenseId);
    setDescription(exp.description);
    setAmount(String(exp.amount));
    setPaidBy(exp.paidByParticipantId);
    setSplitType(exp.splitType);
    setSplitAmong(new Set(exp.splitAmong ?? []));
    setShowForm(false);
  };

  const handleUpdate = async () => {
    if (!editingId || !description.trim() || !amount || !paidBy) return;
    if (splitType === 'CUSTOM' && splitAmong.size === 0) return;
    setSubmitting(true);
    try {
      await onUpdate!(editingId, {
        description: description.trim(),
        amount: Number(amount),
        paidByParticipantId: paidBy,
        splitType,
        splitAmong: splitType === 'CUSTOM' ? [...splitAmong] : null,
      });
      resetForm();
    } finally { setSubmitting(false); }
  };

  const toggleSplitMember = (pid: string) => {
    const next = new Set(splitAmong);
    if (next.has(pid)) next.delete(pid); else next.add(pid);
    setSplitAmong(next);
  };

  const renderForm = (title: string, onSubmitFn: () => void, submitLabel: string) => (
    <div style={cs.formCard}>
      <div style={cs.formTitle}>{title}</div>
      <input style={cs.input} placeholder="費用說明" value={description} onChange={e => setDescription(e.target.value)} />
      <input style={cs.input} placeholder="金額" type="number" value={amount} onChange={e => setAmount(e.target.value)} />

      <div style={cs.fieldLabel}>代墊人</div>
      <select style={cs.select} value={paidBy} onChange={e => setPaidBy(e.target.value)}>
        <option value="">選擇代墊人</option>
        {participants.map(p => (
          <option key={p.participantId} value={p.participantId}>{p.name}</option>
        ))}
      </select>

      <div style={cs.fieldLabel}>分帳方式</div>
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
        <div style={cs.checkboxGroup}>
          {participants.map(p => (
            <label key={p.participantId} style={cs.checkboxLabel}>
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

      <div style={cs.formActions}>
        <button onClick={resetForm} style={cs.cancelBtn}>取消</button>
        <button onClick={onSubmitFn} disabled={submitting} style={cs.confirmBtn}>
          {submitting ? '...' : submitLabel}
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <div style={cs.summary}>
        {expenses.length} 筆費用，共 ${totalExpenses.toLocaleString()}
      </div>

      {expenses.map(exp => (
        <div key={exp.expenseId} style={cs.card}>
          {editingId === exp.expenseId ? (
            renderForm('編輯費用', handleUpdate, '儲存')
          ) : (
            <>
              <div style={cs.cardHeader}>
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
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {onUpdate && <button onClick={() => startEdit(exp)} style={styles.editBtn}>編輯</button>}
                  <button onClick={() => onRemove(exp.expenseId)} style={cs.removeBtn}>刪除</button>
                </div>
              )}
            </>
          )}
        </div>
      ))}

      {isOpen && !showForm && !editingId && (
        <button onClick={() => setShowForm(true)} style={cs.addBtn}>+ 新增費用</button>
      )}

      {showForm && !editingId && renderForm('新增費用', handleSubmit, '確認')}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  cardTitle: { fontSize: 15, fontWeight: 600 },
  cardAmount: { fontSize: 15, fontWeight: 700, color: '#e65100' },
  cardDetail: { fontSize: 13, color: '#666', marginTop: 4 },
  radioRow: { display: 'flex', gap: 16, marginBottom: 8 },
  radioLabel: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, cursor: 'pointer' },
  editBtn: {
    padding: '4px 12px', border: '1px solid #ddd', borderRadius: 6,
    backgroundColor: '#fff', color: '#555', fontSize: 12, cursor: 'pointer',
  },
};
