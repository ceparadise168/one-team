import { useState } from 'react';
import type { CampSite, TripParticipant } from './use-camping';
import { groupByHousehold, campingStyles as cs } from './camping-shared';
import type React from 'react';

interface Props {
  campSites: CampSite[];
  participants: TripParticipant[];
  isOpen: boolean;
  onAdd: (input: { name: string; cost: number; paidByParticipantId: string; memberParticipantIds: string[] }) => Promise<void>;
  onRemove: (campSiteId: string) => Promise<void>;
  onUpdate?: (campSiteId: string, input: { name: string; cost: number; paidByParticipantId: string; memberParticipantIds: string[] }) => Promise<void>;
}

export function CampSitesTab({ campSites, participants, isOpen, onAdd, onRemove, onUpdate }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
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
      resetForm();
    } finally { setSubmitting(false); }
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
                  <button onClick={() => onRemove(site.campSiteId)} style={cs.removeBtn}>刪除</button>
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
