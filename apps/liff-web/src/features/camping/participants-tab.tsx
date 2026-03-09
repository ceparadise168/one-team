import { useState } from 'react';
import type { TripParticipant } from './use-camping';
import { groupByHousehold, campingStyles as cs } from './camping-shared';
import type React from 'react';

interface Props {
  participants: TripParticipant[];
  isOpen: boolean;
  onAdd: (input: { name: string; employeeId: string | null; lineUserId: string | null; splitWeight: 1 | 0.5 | 0 }) => Promise<void>;
  onAddHousehold: (input: {
    household: {
      head: { name: string; employeeId: null; lineUserId: null; splitWeight: 1 | 0.5 | 0 };
      members: Array<{ name: string; employeeId: null; lineUserId: null; splitWeight: 1 | 0.5 | 0 }>;
      settleAsHousehold: boolean;
    };
  }) => Promise<void>;
  onRemove: (participantId: string) => Promise<void>;
}

const WEIGHT_CONFIG: Record<string, { label: string; badge: string; bg: string; color: string }> = {
  '1':   { label: '全額分攤', badge: '全額', bg: '#e3f2fd', color: '#1565c0' },
  '0.5': { label: '半額分攤', badge: '半額', bg: '#fff3e0', color: '#e65100' },
  '0':   { label: '不列入分攤', badge: '不列入', bg: '#f3e5f5', color: '#7b1fa2' },
};

export function ParticipantsTab({ participants, isOpen, onAdd, onAddHousehold, onRemove }: Props) {
  const [showAddForm, setShowAddForm] = useState<'none' | 'individual' | 'household'>('none');
  const [name, setName] = useState('');
  const [weight, setWeight] = useState<1 | 0.5 | 0>(1);
  const [householdHead, setHouseholdHead] = useState('');
  const [householdHeadWeight, setHouseholdHeadWeight] = useState<1 | 0.5 | 0>(1);
  const [members, setMembers] = useState<Array<{ name: string; weight: 1 | 0.5 | 0 }>>([{ name: '', weight: 1 }]);
  const [submitting, setSubmitting] = useState(false);

  const { households, individuals } = groupByHousehold(participants);

  const handleAddIndividual = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await onAdd({ name: name.trim(), employeeId: null, lineUserId: null, splitWeight: weight });
      setName(''); setWeight(1); setShowAddForm('none');
    } finally { setSubmitting(false); }
  };

  const handleAddHousehold = async () => {
    if (!householdHead.trim()) return;
    setSubmitting(true);
    try {
      await onAddHousehold({
        household: {
          head: { name: householdHead.trim(), employeeId: null, lineUserId: null, splitWeight: householdHeadWeight },
          members: members.filter(m => m.name.trim()).map(m => ({
            name: m.name.trim(), employeeId: null, lineUserId: null, splitWeight: m.weight,
          })),
          settleAsHousehold: true,
        },
      });
      setHouseholdHead(''); setHouseholdHeadWeight(1);
      setMembers([{ name: '', weight: 1 }]); setShowAddForm('none');
    } finally { setSubmitting(false); }
  };

  return (
    <div>
      <div style={cs.summary}>共 {participants.length} 人</div>

      {/* Individuals */}
      {individuals.map(p => (
        <div key={p.participantId} style={styles.participantCard}>
          <div style={styles.participantRow}>
            <span style={styles.participantName}>{p.name}</span>
            <WeightBadge weight={p.splitWeight} />
            {isOpen && (
              <button onClick={() => onRemove(p.participantId)} style={cs.removeBtn}>移除</button>
            )}
          </div>
        </div>
      ))}

      {/* Households */}
      {[...households.entries()].map(([hid, members]) => {
        const head = members.find(m => m.isHouseholdHead);
        return (
          <div key={hid} style={styles.householdCard}>
            <div style={styles.householdTitle}>{head?.name ?? '?'} 一家</div>
            {members.map(m => (
              <div key={m.participantId} style={styles.participantRow}>
                <span style={styles.participantName}>
                  {m.isHouseholdHead ? '👤 ' : '  '}{m.name}
                </span>
                <WeightBadge weight={m.splitWeight} />
                {isOpen && (
                  <button onClick={() => onRemove(m.participantId)} style={cs.removeBtn}>移除</button>
                )}
              </div>
            ))}
          </div>
        );
      })}

      {/* Add buttons */}
      {isOpen && showAddForm === 'none' && (
        <div style={styles.actionRow}>
          <button onClick={() => setShowAddForm('individual')} style={styles.addBtn}>+ 新增個人</button>
          <button onClick={() => setShowAddForm('household')} style={styles.addBtn}>+ 新增一戶</button>
        </div>
      )}

      {/* Individual form */}
      {showAddForm === 'individual' && (
        <div style={cs.formCard}>
          <div style={cs.formTitle}>新增個人</div>
          <input style={cs.input} placeholder="名字" value={name} onChange={e => setName(e.target.value)} />
          <WeightSelect value={weight} onChange={setWeight} />
          <div style={cs.formActions}>
            <button onClick={() => setShowAddForm('none')} style={cs.cancelBtn}>取消</button>
            <button onClick={handleAddIndividual} disabled={submitting} style={cs.confirmBtn}>
              {submitting ? '新增中...' : '確認新增'}
            </button>
          </div>
        </div>
      )}

      {/* Household form */}
      {showAddForm === 'household' && (
        <div style={cs.formCard}>
          <div style={cs.formTitle}>新增一戶</div>
          <div style={cs.fieldLabel}>戶主</div>
          <input style={cs.input} placeholder="戶主名字" value={householdHead} onChange={e => setHouseholdHead(e.target.value)} />
          <WeightSelect value={householdHeadWeight} onChange={setHouseholdHeadWeight} />

          <div style={cs.fieldLabel}>家庭成員</div>
          {members.map((m, i) => (
            <div key={i} style={styles.memberRow}>
              <input
                style={{ ...cs.input, flex: 1 }}
                placeholder={`成員 ${i + 1} 名字`}
                value={m.name}
                onChange={e => {
                  const updated = [...members];
                  updated[i] = { ...updated[i], name: e.target.value };
                  setMembers(updated);
                }}
              />
              <WeightSelect
                value={m.weight}
                onChange={w => {
                  const updated = [...members];
                  updated[i] = { ...updated[i], weight: w };
                  setMembers(updated);
                }}
              />
              {members.length > 1 && (
                <button onClick={() => setMembers(members.filter((_, j) => j !== i))} style={styles.removeMemberBtn}>×</button>
              )}
            </div>
          ))}
          <button
            onClick={() => setMembers([...members, { name: '', weight: 1 }])}
            style={styles.addMemberBtn}
          >
            + 增加成員
          </button>

          <div style={cs.formActions}>
            <button onClick={() => setShowAddForm('none')} style={cs.cancelBtn}>取消</button>
            <button onClick={handleAddHousehold} disabled={submitting} style={cs.confirmBtn}>
              {submitting ? '新增中...' : '確認新增'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WeightBadge({ weight }: { weight: number }) {
  const info = WEIGHT_CONFIG[String(weight)] ?? WEIGHT_CONFIG['1'];
  return <span style={{ ...styles.badge, backgroundColor: info.bg, color: info.color }}>{info.badge}</span>;
}

function WeightSelect({ value, onChange }: { value: 1 | 0.5 | 0; onChange: (v: 1 | 0.5 | 0) => void }) {
  return (
    <select
      style={styles.select}
      value={String(value)}
      onChange={e => onChange(Number(e.target.value) as 1 | 0.5 | 0)}
    >
      <option value="1">全額分攤</option>
      <option value="0.5">半額分攤</option>
      <option value="0">不列入分攤</option>
    </select>
  );
}

const styles: Record<string, React.CSSProperties> = {
  participantCard: { padding: '10px 12px', borderBottom: '1px solid #f0f0f0' },
  participantRow: { display: 'flex', alignItems: 'center', gap: 8 },
  participantName: { flex: 1, fontSize: 15 },
  badge: { padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 'bold' },
  householdCard: {
    padding: 12, border: '1px solid #e0e0e0', borderRadius: 10,
    marginBottom: 10, backgroundColor: '#fafafa',
  },
  householdTitle: { fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#555' },
  actionRow: { display: 'flex', gap: 8, marginTop: 16 },
  addBtn: {
    flex: 1, padding: '10px 0', border: '1px dashed #bbb', borderRadius: 8,
    backgroundColor: '#fff', fontSize: 14, cursor: 'pointer', color: '#555',
  },
  select: {
    padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8,
    fontSize: 14, marginBottom: 8,
  },
  memberRow: { display: 'flex', gap: 8, alignItems: 'flex-start' },
  removeMemberBtn: {
    background: 'none', border: 'none', color: '#c62828', fontSize: 18,
    cursor: 'pointer', padding: '6px',
  },
  addMemberBtn: {
    background: 'none', border: 'none', color: '#1DB446', fontSize: 13,
    cursor: 'pointer', padding: '4px 0', fontWeight: 600,
  },
};
