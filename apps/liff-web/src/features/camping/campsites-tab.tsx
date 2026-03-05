import { useState } from 'react';
import type { CampSite, TripParticipant } from './use-camping';
import type React from 'react';

interface Props {
  campSites: CampSite[];
  participants: TripParticipant[];
  isOpen: boolean;
  onAdd: (input: { name: string; cost: number; paidByParticipantId: string; memberParticipantIds: string[] }) => Promise<void>;
  onRemove: (campSiteId: string) => Promise<void>;
}

export function CampSitesTab({ campSites, participants, isOpen, onAdd, onRemove }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [paidBy, setPaidBy] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const nameOf = new Map(participants.map(p => [p.participantId, p.name]));

  const handleSubmit = async () => {
    if (!name.trim() || !cost || !paidBy || selectedMembers.size === 0) return;
    setSubmitting(true);
    try {
      await onAdd({
        name: name.trim(),
        cost: Number(cost),
        paidByParticipantId: paidBy,
        memberParticipantIds: [...selectedMembers],
      });
      setName(''); setCost(''); setPaidBy(''); setSelectedMembers(new Set()); setShowForm(false);
    } finally { setSubmitting(false); }
  };

  const toggleMember = (pid: string) => {
    const next = new Set(selectedMembers);
    if (next.has(pid)) next.delete(pid); else next.add(pid);
    setSelectedMembers(next);
  };

  const totalCost = campSites.reduce((sum, s) => sum + s.cost, 0);

  return (
    <div>
      <div style={styles.summary}>
        {campSites.length} 個營位，共 ${totalCost.toLocaleString()}
      </div>

      {campSites.map(site => (
        <div key={site.campSiteId} style={styles.card}>
          <div style={styles.cardHeader}>
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
            <button onClick={() => onRemove(site.campSiteId)} style={styles.removeBtn}>刪除</button>
          )}
        </div>
      ))}

      {isOpen && !showForm && (
        <button onClick={() => setShowForm(true)} style={styles.addBtn}>+ 新增營位</button>
      )}

      {showForm && (
        <div style={styles.formCard}>
          <div style={styles.formTitle}>新增營位</div>
          <input style={styles.input} placeholder="營位名稱" value={name} onChange={e => setName(e.target.value)} />
          <input style={styles.input} placeholder="費用" type="number" value={cost} onChange={e => setCost(e.target.value)} />

          <div style={styles.fieldLabel}>代墊人</div>
          <select style={styles.select} value={paidBy} onChange={e => setPaidBy(e.target.value)}>
            <option value="">選擇代墊人</option>
            {participants.map(p => (
              <option key={p.participantId} value={p.participantId}>{p.name}</option>
            ))}
          </select>

          <div style={styles.fieldLabel}>入住成員</div>
          <ParticipantCheckboxes
            participants={participants}
            selected={selectedMembers}
            onToggle={toggleMember}
          />

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

function ParticipantCheckboxes({
  participants, selected, onToggle,
}: {
  participants: TripParticipant[];
  selected: Set<string>;
  onToggle: (pid: string) => void;
}) {
  // Group by household for cleaner display
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

  return (
    <div style={styles.checkboxGroup}>
      {individuals.map(p => (
        <label key={p.participantId} style={styles.checkboxLabel}>
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
            <label style={styles.checkboxLabel}>
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
              <label key={m.participantId} style={{ ...styles.checkboxLabel, paddingLeft: 20 }}>
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

const styles: Record<string, React.CSSProperties> = {
  summary: { fontSize: 13, color: '#888', marginBottom: 12 },
  card: {
    padding: 12, border: '1px solid #e0e0e0', borderRadius: 10,
    marginBottom: 10, backgroundColor: '#fff',
  },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontWeight: 600 },
  cardCost: { fontSize: 15, fontWeight: 700, color: '#1DB446' },
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
  checkboxGroup: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer' },
  householdGroup: { paddingLeft: 0, marginTop: 4 },
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
