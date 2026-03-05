import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  const { apiBaseUrl, accessToken, employeeId } = useAuth();
  const { detail, loading, error, refresh } = useTripDetail(apiBaseUrl, accessToken, tripId!);
  const mutations = useTripMutations(apiBaseUrl, accessToken, tripId!);
  const [activeTab, setActiveTab] = useState<Tab>('participants');
  const [mutationError, setMutationError] = useState<string | null>(null);

  if (loading) return <div style={cs.container}><p style={cs.loading}>載入中...</p></div>;
  if (error) return <div style={cs.container}><p style={cs.error}>{error}</p></div>;
  if (!detail) return <div style={cs.container}><p style={cs.error}>找不到行程</p></div>;

  const isOpen = detail.trip.status === 'OPEN';

  const withRefresh = (fn: (...args: any[]) => Promise<any>) =>
    async (...args: any[]) => {
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
        <h1 style={styles.title}>{detail.trip.title}</h1>
        <div style={styles.dateRange}>{detail.trip.startDate} ~ {detail.trip.endDate}</div>
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
  title: { fontSize: 22, margin: '8px 0 4px', fontWeight: 700 },
  dateRange: { fontSize: 13, color: '#888' },
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
