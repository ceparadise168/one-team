import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import liff from '@line/liff';
import { useAuth } from '../../auth-context';
import { useTripDetail, useTripMutations } from './use-camping';
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

  if (loading) return <div style={cs.container}><p style={cs.loading}>載入中...</p></div>;
  if (error) return <div style={cs.container}><p style={cs.error}>{error}</p></div>;
  if (!detail) return <div style={cs.container}><p style={cs.error}>找不到行程</p></div>;

  const isOpen = detail.trip.status === 'OPEN';

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
        <div style={styles.headerTop}>
          <div style={styles.headerTitleBox}>
            <h1 style={styles.title}>{detail.trip.title}</h1>
            <div style={styles.dateRange}>{detail.trip.startDate} ~ {detail.trip.endDate}</div>
          </div>
          <button onClick={handleShare} disabled={sharing} style={styles.shareBtn}>
            {sharing ? '...' : '分享'}
          </button>
        </div>
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
