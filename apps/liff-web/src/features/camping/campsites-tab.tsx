import { useState } from 'react';
import type { CampSite, Expense, TripParticipant } from './use-camping';
import { groupByHousehold, campingStyles as cs } from './camping-shared';
import type React from 'react';

interface Props {
  campSites: CampSite[];
  expenses: Expense[];
  participants: TripParticipant[];
  isOpen: boolean;
  onAdd: (input: { name: string; cost: number; paidByParticipantId: string; memberParticipantIds: string[] }) => Promise<string>;
  onRemove: (campSiteId: string) => Promise<void>;
  onUpdate?: (campSiteId: string, input: { name: string; cost: number; paidByParticipantId: string; memberParticipantIds: string[] }) => Promise<void>;
  onAddExpense: (input: { description: string; amount: number; paidByParticipantId: string; splitType: 'ALL' | 'CUSTOM'; splitAmong: string[] | null; campSiteId: string }) => Promise<void>;
  onUpdateExpense: (expenseId: string, input: { description: string; amount: number; paidByParticipantId: string; splitType: 'ALL' | 'CUSTOM'; splitAmong: string[] | null }) => Promise<void>;
  onRemoveExpense: (expenseId: string) => Promise<void>;
}

export function CampSitesTab({ campSites, expenses, participants, isOpen, onAdd, onRemove, onUpdate, onAddExpense, onUpdateExpense, onRemoveExpense }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [paidBy, setPaidBy] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    type: 'add' | 'update' | 'delete';
    campSiteId: string;
    campSiteName: string;
    campSiteCost: number;
    paidByParticipantId: string;
    memberParticipantIds: string[];
  } | null>(null);

  const nameOf = new Map(participants.map(p => [p.participantId, p.name]));

  const handleSubmit = async () => {
    if (!name.trim() || !cost || !paidBy || selectedMembers.size === 0) return;
    setSubmitting(true);
    try {
      const trimmedName = name.trim();
      const numCost = Number(cost);
      const members = [...selectedMembers];
      const campSiteId = await onAdd({
        name: trimmedName,
        cost: numCost,
        paidByParticipantId: paidBy,
        memberParticipantIds: members,
      });
      setConfirmDialog({
        type: 'add',
        campSiteId,
        campSiteName: trimmedName,
        campSiteCost: numCost,
        paidByParticipantId: paidBy,
        memberParticipantIds: members,
      });
      resetForm();
    } finally { setSubmitting(false); }
  };

  const toggleMember = (pid: string) => {
    const next = new Set(selectedMembers);
    if (next.has(pid)) next.delete(pid); else next.add(pid);
    setSelectedMembers(next);
  };

  const totalCost = campSites.reduce((sum, s) => sum + s.cost, 0);

  const startEdit = (site: CampSite) => {
    setEditingId(site.campSiteId);
    setName(site.name);
    setCost(String(site.cost));
    setPaidBy(site.paidByParticipantId);
    setSelectedMembers(new Set(site.memberParticipantIds));
    setShowForm(false);
  };

  const handleUpdate = async () => {
    if (!editingId || !name.trim() || !cost || !paidBy || selectedMembers.size === 0) return;
    setSubmitting(true);
    try {
      await onUpdate!(editingId, {
        name: name.trim(),
        cost: Number(cost),
        paidByParticipantId: paidBy,
        memberParticipantIds: [...selectedMembers],
      });
      setConfirmDialog({
        type: 'update',
        campSiteId: editingId,
        campSiteName: name.trim(),
        campSiteCost: Number(cost),
        paidByParticipantId: paidBy,
        memberParticipantIds: [...selectedMembers],
      });
      resetForm();
    } finally { setSubmitting(false); }
  };

  const handleRemove = async (campSiteId: string) => {
    const site = campSites.find(s => s.campSiteId === campSiteId);
    const linkedExpense = expenses.find(e => e.campSiteId === campSiteId);
    await onRemove(campSiteId);
    if (linkedExpense && site) {
      setConfirmDialog({
        type: 'delete',
        campSiteId,
        campSiteName: site.name,
        campSiteCost: site.cost,
        paidByParticipantId: site.paidByParticipantId,
        memberParticipantIds: site.memberParticipantIds,
      });
    }
  };

  const resetForm = () => {
    setName(''); setCost(''); setPaidBy(''); setSelectedMembers(new Set());
    setShowForm(false); setEditingId(null);
  };

  return (
    <div>
      <div style={cs.summary}>
        {campSites.length} 個營位，共 ${totalCost.toLocaleString()}
      </div>

      {campSites.map(site => (
        <div key={site.campSiteId} style={cs.card}>
          {editingId === site.campSiteId ? (
            <div style={cs.formCard}>
              <div style={cs.formTitle}>編輯營位</div>
              <input style={cs.input} placeholder="營位名稱" value={name} onChange={e => setName(e.target.value)} />
              <input style={cs.input} placeholder="費用" type="number" value={cost} onChange={e => setCost(e.target.value)} />
              <div style={cs.fieldLabel}>代墊人</div>
              <select style={cs.select} value={paidBy} onChange={e => setPaidBy(e.target.value)}>
                <option value="">選擇代墊人</option>
                {participants.map(p => (
                  <option key={p.participantId} value={p.participantId}>{p.name}</option>
                ))}
              </select>
              <div style={cs.fieldLabel}>入住成員</div>
              <ParticipantCheckboxes participants={participants} selected={selectedMembers} onToggle={toggleMember} />
              <div style={cs.formActions}>
                <button onClick={resetForm} style={cs.cancelBtn}>取消</button>
                <button onClick={handleUpdate} disabled={submitting} style={cs.confirmBtn}>
                  {submitting ? '儲存中...' : '儲存'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div style={cs.cardHeader}>
                <span style={styles.cardTitle}>{site.name}</span>
                <span style={styles.cardCost}>${site.cost.toLocaleString()}</span>
              </div>
              <div style={styles.cardDetail}>
                代墊: {nameOf.get(site.paidByParticipantId) ?? '?'}
              </div>
              <div style={styles.cardDetail}>
                成員: {site.memberParticipantIds.map(id => nameOf.get(id) ?? '?').join('、')}
              </div>
              <div style={styles.cardDetail}>
                每人: ${Math.round(site.cost / site.memberParticipantIds.length).toLocaleString()}
              </div>
              {isOpen && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {onUpdate && <button onClick={() => startEdit(site)} style={styles.editBtn}>編輯</button>}
                  <button onClick={() => handleRemove(site.campSiteId)} style={cs.removeBtn}>刪除</button>
                </div>
              )}
            </>
          )}
        </div>
      ))}

      {isOpen && !showForm && (
        <button onClick={() => setShowForm(true)} style={cs.addBtn}>+ 新增營位</button>
      )}

      {showForm && !editingId && (
        <div style={cs.formCard}>
          <div style={cs.formTitle}>新增營位</div>
          <input style={cs.input} placeholder="營位名稱" value={name} onChange={e => setName(e.target.value)} />
          <input style={cs.input} placeholder="費用" type="number" value={cost} onChange={e => setCost(e.target.value)} />

          <div style={cs.fieldLabel}>代墊人</div>
          <select style={cs.select} value={paidBy} onChange={e => setPaidBy(e.target.value)}>
            <option value="">選擇代墊人</option>
            {participants.map(p => (
              <option key={p.participantId} value={p.participantId}>{p.name}</option>
            ))}
          </select>

          <div style={cs.fieldLabel}>入住成員</div>
          <ParticipantCheckboxes
            participants={participants}
            selected={selectedMembers}
            onToggle={toggleMember}
          />

          <div style={cs.formActions}>
            <button onClick={resetForm} style={cs.cancelBtn}>取消</button>
            <button onClick={handleSubmit} disabled={submitting} style={cs.confirmBtn}>
              {submitting ? '新增中...' : '確認'}
            </button>
          </div>
        </div>
      )}

      {confirmDialog && (
        <div style={dialogStyles.overlay}>
          <div style={dialogStyles.dialog}>
            <div style={dialogStyles.title}>
              {confirmDialog.type === 'add' && '是否將營位費用帶入費用清單？'}
              {confirmDialog.type === 'update' && '是否更新對應的費用？'}
              {confirmDialog.type === 'delete' && '是否一併刪除對應的費用？'}
            </div>
            <div style={dialogStyles.detail}>
              營位-{confirmDialog.campSiteName}，${confirmDialog.campSiteCost.toLocaleString()}
            </div>
            <div style={dialogStyles.actions}>
              <button onClick={() => setConfirmDialog(null)} style={cs.cancelBtn}>否</button>
              <button
                onClick={async () => {
                  const d = confirmDialog;
                  setConfirmDialog(null);
                  if (d.type === 'add') {
                    await onAddExpense({
                      description: `營位-${d.campSiteName}`,
                      amount: d.campSiteCost,
                      paidByParticipantId: d.paidByParticipantId,
                      splitType: 'CUSTOM',
                      splitAmong: d.memberParticipantIds,
                      campSiteId: d.campSiteId,
                    });
                  } else if (d.type === 'update') {
                    const linkedExpense = expenses.find(e => e.campSiteId === d.campSiteId);
                    if (linkedExpense) {
                      await onUpdateExpense(linkedExpense.expenseId, {
                        description: `營位-${d.campSiteName}`,
                        amount: d.campSiteCost,
                        paidByParticipantId: d.paidByParticipantId,
                        splitType: 'CUSTOM',
                        splitAmong: d.memberParticipantIds,
                      });
                    } else {
                      await onAddExpense({
                        description: `營位-${d.campSiteName}`,
                        amount: d.campSiteCost,
                        paidByParticipantId: d.paidByParticipantId,
                        splitType: 'CUSTOM',
                        splitAmong: d.memberParticipantIds,
                        campSiteId: d.campSiteId,
                      });
                    }
                  } else if (d.type === 'delete') {
                    const linkedExpense = expenses.find(e => e.campSiteId === d.campSiteId);
                    if (linkedExpense) {
                      await onRemoveExpense(linkedExpense.expenseId);
                    }
                  }
                }}
                style={cs.confirmBtn}
              >
                是
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ParticipantCheckboxes({
  participants, selected, onToggle,
}: {
  participants: TripParticipant[];
  selected: Set<string>;
  onToggle: (pid: string) => void;
}) {
  const { households, individuals } = groupByHousehold(participants);

  return (
    <div style={cs.checkboxGroup}>
      {individuals.map(p => (
        <label key={p.participantId} style={cs.checkboxLabel}>
          <input
            type="checkbox"
            checked={selected.has(p.participantId)}
            onChange={() => onToggle(p.participantId)}
          />
          {p.name}
        </label>
      ))}
      {[...households.entries()].map(([hid, members]) => {
        const head = members.find(m => m.isHouseholdHead);
        const allSelected = members.every(m => selected.has(m.participantId));
        return (
          <div key={hid} style={styles.householdGroup}>
            <label style={cs.checkboxLabel}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => {
                  for (const m of members) {
                    if (allSelected && selected.has(m.participantId)) onToggle(m.participantId);
                    if (!allSelected && !selected.has(m.participantId)) onToggle(m.participantId);
                  }
                }}
              />
              <strong>{head?.name ?? '?'} 一家 ({members.length}人)</strong>
            </label>
            {members.map(m => (
              <label key={m.participantId} style={{ ...cs.checkboxLabel, paddingLeft: 20 }}>
                <input
                  type="checkbox"
                  checked={selected.has(m.participantId)}
                  onChange={() => onToggle(m.participantId)}
                />
                {m.name}
              </label>
            ))}
          </div>
        );
      })}
    </div>
  );
}

const dialogStyles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  dialog: {
    backgroundColor: '#fff', borderRadius: 12, padding: 24,
    maxWidth: 320, width: '90%', textAlign: 'center' as const,
  },
  title: { fontSize: 16, fontWeight: 600, marginBottom: 12 },
  detail: { fontSize: 14, color: '#666', marginBottom: 20 },
  actions: { display: 'flex', gap: 12, justifyContent: 'center' },
};

const styles: Record<string, React.CSSProperties> = {
  cardTitle: { fontSize: 15, fontWeight: 600 },
  cardCost: { fontSize: 15, fontWeight: 700, color: '#1DB446' },
  cardDetail: { fontSize: 13, color: '#666', marginTop: 4 },
  householdGroup: { paddingLeft: 0, marginTop: 4 },
  editBtn: {
    padding: '4px 12px', border: '1px solid #ddd', borderRadius: 6,
    backgroundColor: '#fff', color: '#555', fontSize: 12, cursor: 'pointer',
  },
};
