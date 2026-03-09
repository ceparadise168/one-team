import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import liff from '@line/liff';
import { useAuth } from '../../auth-context';
import { useTripDetail, useTripMutations, updateTripApi } from './use-camping';
import { ParticipantsTab } from './participants-tab';
import { CampSitesTab } from './campsites-tab';
import { ExpensesTab } from './expenses-tab';
import { SettlementTab } from './settlement-tab';
import { campingStyles as cs } from './camping-shared';
import type React from 'react';

type Tab = 'participants' | 'campsites' | 'expenses' | 'settlement';

const TAB_LABELS: Record<Tab, string> = {
  participants: '參與者',
  campsites: '營位',
  expenses: '費用',
  settlement: '結算',
};

export function TripDetail() {
  const { tripId } = useParams<{ tripId: string }>();
  const navigate = useNavigate();
  const { apiBaseUrl, accessToken, employeeId, tenantId, liffId } = useAuth();
  const { detail, loading, error, refresh } = useTripDetail(apiBaseUrl, accessToken, tripId!);
  const mutations = useTripMutations(apiBaseUrl, accessToken, tripId!);
  const [activeTab, setActiveTab] = useState<Tab>('participants');
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [joining, setJoining] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editCreator, setEditCreator] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);

  if (loading) return <div style={cs.container}><p style={cs.loading}>載入中...</p></div>;
  if (error) return <div style={cs.container}><p style={cs.error}>{error}</p></div>;
  if (!detail) return <div style={cs.container}><p style={cs.error}>找不到行程</p></div>;

  const isOpen = detail.trip.status === 'OPEN';
  const isCreator = detail.trip.creatorEmployeeId === employeeId;
  const isParticipant = detail.participants.some(p => p.employeeId === employeeId);
  const showJoinButton = isOpen && !isParticipant && !!employeeId;
  const myName = detail.participants.find(p => p.employeeId === employeeId)?.name ?? employeeId;

  const startEditing = () => {
    setEditTitle(detail.trip.title);
    setEditStartDate(detail.trip.startDate);
    setEditEndDate(detail.trip.endDate);
    setEditCreator(detail.trip.creatorEmployeeId);
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    setEditSubmitting(true);
    try {
      setMutationError(null);
      await updateTripApi(apiBaseUrl, accessToken, tripId!, {
        title: editTitle,
        startDate: editStartDate,
        endDate: editEndDate,
        creatorEmployeeId: editCreator !== detail.trip.creatorEmployeeId ? editCreator : undefined,
        actorName: myName,
      });
      setEditing(false);
      refresh();
    } catch (err) {
      setMutationError((err as Error).message);
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleJoin = async () => {
    setJoining(true);
    try {
      let name: string | null = null;
      try {
        const profile = await liff.getProfile();
        name = profile.displayName;
      } catch {
        // LIFF profile unavailable
      }
      if (!name) {
        name = prompt('請輸入你的名字');
      }
      if (!name) return;
      await mutations.post('/join', { name });
      refresh();
    } catch (err) {
      setMutationError((err as Error).message);
    } finally {
      setJoining(false);
    }
  };

  const handleShare = async () => {
    setSharing(true);
    try {
      // Ensure LIFF SDK is fully initialized before using shareTargetPicker
      await liff.ready;
      const tripUrl = liffId
        ? `https://liff.line.me/${liffId}/camping/${detail.trip.tripId}?tenantId=${tenantId}`
        : `${window.location.origin}/camping/${detail.trip.tripId}?tenantId=${tenantId}`;
      const nameOf = new Map(detail.participants.map(p => [p.participantId, p.name]));
      const settlement = detail.settlement;

      let bodyContents: Record<string, unknown>[];
      let altText: string;

      if (settlement) {
        altText = `${detail.trip.title} 結算報告`;
        const transferRows: Record<string, unknown>[] = settlement.transfers.length > 0
          ? settlement.transfers.map(t => ({
              type: 'box', layout: 'horizontal',
              contents: [
                { type: 'text', text: `${nameOf.get(t.fromParticipantId) ?? t.fromParticipantId} → ${nameOf.get(t.toParticipantId) ?? t.toParticipantId}`, size: 'sm', color: '#333333', flex: 3, wrap: true },
                { type: 'text', text: `$${t.amount}`, size: 'sm', weight: 'bold', color: '#e65100', align: 'end', flex: 1 },
              ],
              margin: 'sm',
            }))
          : [{ type: 'text', text: '所有人已結清', size: 'sm', color: '#27ae60', align: 'center', margin: 'sm' }];
        bodyContents = [
          { type: 'text', text: '轉帳明細', weight: 'bold', size: 'sm', color: '#888888' },
          { type: 'separator', margin: 'sm' },
          ...transferRows,
        ];
      } else {
        altText = `${detail.trip.title} — 一起來記帳吧！`;
        const participantNames = detail.participants.map(p => p.name).join('、');
        bodyContents = [
          { type: 'text', text: `目前 ${detail.participants.length} 位參與者`, size: 'sm', color: '#666666', wrap: true },
          ...(participantNames ? [{ type: 'text', text: participantNames, size: 'xs', color: '#999999', margin: 'sm', wrap: true }] : []),
          { type: 'text', text: '點擊下方按鈕查看行程、新增費用', size: 'sm', color: '#888888', margin: 'md', wrap: true },
        ];
      }

      const flexMessage = {
        type: 'flex',
        altText,
        contents: {
          type: 'bubble',
          header: {
            type: 'box', layout: 'vertical',
            contents: [
              { type: 'text', text: detail.trip.title, weight: 'bold', size: 'lg', color: '#333333' },
              { type: 'text', text: `${detail.trip.startDate} ~ ${detail.trip.endDate}`, size: 'xs', color: '#999999', margin: 'sm' },
              ...(settlement ? [{ type: 'text', text: '已結算', size: 'xs', color: '#e65100', weight: 'bold', margin: 'sm' }] : []),
            ],
            paddingAll: '20px',
            backgroundColor: '#F5F7FA',
          },
          body: { type: 'box', layout: 'vertical', contents: bodyContents },
          footer: {
            type: 'box', layout: 'vertical',
            contents: [{
              type: 'button',
              action: { type: 'uri', label: settlement ? '查看結算' : '查看行程', uri: tripUrl },
              style: 'primary', color: '#1DB446',
            }],
          },
        },
      };

      if (liff.isApiAvailable('shareTargetPicker')) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await liff.shareTargetPicker([flexMessage as any]);
      } else {
        // shareTargetPicker unavailable (opened via direct URL, not LIFF URL)
        // Fall back to clipboard copy
        await navigator.clipboard.writeText(tripUrl);
        alert('已複製行程連結！');
      }
    } catch (err) {
      console.error('[share] error', err);
      alert(`分享失敗：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSharing(false);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const withRefresh = <T extends (...args: any[]) => Promise<unknown>>(fn: T) =>
    async (...args: Parameters<T>) => {
      try {
        setMutationError(null);
        await fn(...args);
        refresh();
      } catch (err) {
        setMutationError((err as Error).message);
      }
    };

  return (
    <div style={cs.container}>
      <button onClick={() => navigate('/camping')} style={cs.backBtn}>← 返回</button>

      <div style={styles.header}>
        {editing ? (
          <div style={cs.formCard}>
            <div style={cs.formTitle}>編輯行程</div>
            <input style={cs.input} placeholder="行程名稱" value={editTitle} onChange={e => setEditTitle(e.target.value)} />
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...cs.input, flex: 1 }} type="date" value={editStartDate} onChange={e => setEditStartDate(e.target.value)} />
              <input style={{ ...cs.input, flex: 1 }} type="date" value={editEndDate} onChange={e => setEditEndDate(e.target.value)} />
            </div>
            <div style={cs.fieldLabel}>建立者（轉移）</div>
            <select style={cs.input} value={editCreator} onChange={e => setEditCreator(e.target.value)}>
              {detail.participants.filter(p => p.employeeId).map(p => (
                <option key={p.participantId} value={p.employeeId!}>{p.name}</option>
              ))}
            </select>
            <div style={cs.formActions}>
              <button onClick={() => setEditing(false)} style={cs.cancelBtn}>取消</button>
              <button onClick={handleSaveEdit} disabled={editSubmitting} style={cs.confirmBtn}>
                {editSubmitting ? '儲存中...' : '儲存'}
              </button>
            </div>
          </div>
        ) : (
          <div style={styles.headerTop}>
            <div style={styles.headerTitleBox}>
              <h1 style={styles.title}>{detail.trip.title}</h1>
              <div style={styles.dateRange}>{detail.trip.startDate} ~ {detail.trip.endDate}</div>
            </div>
            {isOpen && isCreator && (
              <button onClick={startEditing} style={styles.editBtn}>編輯</button>
            )}
            {showJoinButton && (
              <button onClick={handleJoin} disabled={joining} style={styles.joinBtn}>
                {joining ? '...' : '加入行程'}
              </button>
            )}
            <button onClick={handleShare} disabled={sharing} style={styles.shareBtn}>
              {sharing ? '...' : '分享'}
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={styles.tabBar}>
        {(Object.keys(TAB_LABELS) as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              ...styles.tab,
              ...(activeTab === tab ? styles.tabActive : {}),
            }}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {mutationError && (
        <div style={styles.mutationError}>{mutationError}</div>
      )}

      {/* Tab content */}
      <div style={styles.tabContent}>
        {activeTab === 'participants' && (
          <ParticipantsTab
            participants={detail.participants}
            isOpen={isOpen}
            onAdd={withRefresh(async (input) => {
              await mutations.post('/participants', input);
            })}
            onAddHousehold={withRefresh(async (input) => {
              await mutations.post('/participants', input);
            })}
            onRemove={withRefresh(async (participantId) => {
              await mutations.del(`/participants/${participantId}`);
            })}
            onUpdate={withRefresh(async (participantId, updates) => {
              await mutations.put(`/participants/${participantId}`, updates);
            })}
          />
        )}

        {activeTab === 'campsites' && (
          <CampSitesTab
            campSites={detail.campSites}
            participants={detail.participants}
            isOpen={isOpen}
            onAdd={withRefresh(async (input) => {
              await mutations.post('/campsites', input);
            })}
            onRemove={withRefresh(async (campSiteId) => {
              await mutations.del(`/campsites/${campSiteId}`);
            })}
          />
        )}

        {activeTab === 'expenses' && (
          <ExpensesTab
            expenses={detail.expenses}
            participants={detail.participants}
            isOpen={isOpen}
            onAdd={withRefresh(async (input) => {
              await mutations.post('/expenses', input);
            })}
            onRemove={withRefresh(async (expenseId) => {
              await mutations.del(`/expenses/${expenseId}`);
            })}
          />
        )}

        {activeTab === 'settlement' && (
          <SettlementTab
            trip={detail.trip}
            participants={detail.participants}
            settlement={detail.settlement}
            currentEmployeeId={employeeId}
            apiBaseUrl={apiBaseUrl}
            accessToken={accessToken}
            onSettle={withRefresh(async () => {
              await mutations.post('/settle', {});
            })}
          />
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { marginBottom: 16 },
  headerTop: { display: 'flex', alignItems: 'center', gap: 12 },
  headerTitleBox: { flex: 1 },
  title: { fontSize: 22, margin: '8px 0 4px', fontWeight: 700 },
  dateRange: { fontSize: 13, color: '#888' },
  editBtn: {
    padding: '8px 16px', border: '1px solid #ddd', borderRadius: 8,
    backgroundColor: '#fff', color: '#555', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', whiteSpace: 'nowrap' as const, flexShrink: 0,
  },
  joinBtn: {
    padding: '8px 16px', border: 'none', borderRadius: 8,
    backgroundColor: '#FF9800', color: '#fff', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', whiteSpace: 'nowrap' as const, flexShrink: 0,
  },
  shareBtn: {
    padding: '8px 16px', border: 'none', borderRadius: 8,
    backgroundColor: '#1DB446', color: '#fff', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', whiteSpace: 'nowrap' as const, flexShrink: 0,
  },
  tabBar: {
    display: 'flex', borderBottom: '2px solid #f0f0f0', marginBottom: 16,
  },
  tab: {
    flex: 1, padding: '10px 0', background: 'none', border: 'none',
    fontSize: 14, fontWeight: 600, color: '#999', cursor: 'pointer',
    borderBottom: '2px solid transparent', marginBottom: -2,
  },
  tabActive: {
    color: '#1DB446', borderBottom: '2px solid #1DB446',
  },
  tabContent: { minHeight: 200 },
  mutationError: {
    padding: '8px 12px', backgroundColor: '#ffebee', color: '#c62828',
    borderRadius: 8, fontSize: 13, marginBottom: 12,
  },
};
