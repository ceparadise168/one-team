import { useState, useEffect, useCallback } from 'react';

export interface CampingTrip {
  tripId: string;
  tenantId: string;
  title: string;
  startDate: string;
  endDate: string;
  creatorEmployeeId: string;
  status: 'OPEN' | 'SETTLED';
  createdAt: string;
}

export interface TripParticipant {
  tripId: string;
  participantId: string;
  name: string;
  employeeId: string | null;
  lineUserId: string | null;
  splitWeight: 1 | 0.5 | 0;
  householdId: string | null;
  isHouseholdHead: boolean;
  settleAsHousehold: boolean;
}

export interface CampSite {
  tripId: string;
  campSiteId: string;
  name: string;
  cost: number;
  paidByParticipantId: string;
  memberParticipantIds: string[];
}

export interface Expense {
  tripId: string;
  expenseId: string;
  description: string;
  amount: number;
  paidByParticipantId: string;
  splitType: 'ALL' | 'CUSTOM';
  splitAmong: string[] | null;
  createdAt: string;
}

export interface TransferInstruction {
  fromParticipantId: string;
  toParticipantId: string;
  amount: number;
}

export interface ParticipantSummary {
  participantId: string;
  name: string;
  totalOwed: number;
  totalPaid: number;
  netAmount: number;
  breakdown: string;
}

export interface Settlement {
  tripId: string;
  transfers: TransferInstruction[];
  participantSummaries: ParticipantSummary[];
  settledAt: string;
}

export interface TripDetail {
  trip: CampingTrip;
  participants: TripParticipant[];
  campSites: CampSite[];
  expenses: Expense[];
  settlement: Settlement | null;
}

export interface AuditLog {
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  entityType: 'TRIP' | 'PARTICIPANT' | 'CAMPSITE' | 'EXPENSE' | 'SETTLEMENT';
  entityName: string;
  actorName: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  createdAt: string;
}

export function useCampingTrips(apiBaseUrl: string, accessToken: string) {
  const [trips, setTrips] = useState<CampingTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!accessToken) return;
    setLoading(true);
    fetch(`${apiBaseUrl}/v1/liff/camping/trips`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(r => { if (!r.ok) throw new Error('載入失敗'); return r.json(); })
      .then(data => { setTrips(data.trips ?? []); setError(null); })
      .catch(() => setError('載入失敗，請稍後再試'))
      .finally(() => setLoading(false));
  }, [apiBaseUrl, accessToken]);

  useEffect(() => { refresh(); }, [refresh]);
  return { trips, loading, error, refresh };
}

export function useTripDetail(apiBaseUrl: string, accessToken: string, tripId: string) {
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!accessToken) return;
    setLoading(true);
    fetch(`${apiBaseUrl}/v1/liff/camping/trips/${tripId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(r => { if (!r.ok) throw new Error('載入失敗'); return r.json(); })
      .then(data => { setDetail(data); setError(null); })
      .catch(() => setError('載入失敗，請稍後再試'))
      .finally(() => setLoading(false));
  }, [apiBaseUrl, accessToken, tripId]);

  useEffect(() => { refresh(); }, [refresh]);
  return { detail, loading, error, refresh };
}

export function useCreateTrip(apiBaseUrl: string, accessToken: string) {
  const [loading, setLoading] = useState(false);

  const create = useCallback(async (input: { title: string; startDate: string; endDate: string; creatorName: string }) => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/v1/liff/camping/trips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error('建立失敗');
      return await res.json() as { tripId: string };
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, accessToken]);

  return { create, loading };
}

export function useTripMutations(apiBaseUrl: string, accessToken: string, tripId: string) {
  const post = useCallback(async (path: string, body: unknown) => {
    const res = await fetch(`${apiBaseUrl}/v1/liff/camping/trips/${tripId}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const detail = await res.text(); throw new Error(detail || '操作失敗'); }
    return res.json();
  }, [apiBaseUrl, accessToken, tripId]);

  const put = useCallback(async (path: string, body: unknown) => {
    const res = await fetch(`${apiBaseUrl}/v1/liff/camping/trips/${tripId}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('操作失敗');
    return res.json();
  }, [apiBaseUrl, accessToken, tripId]);

  const del = useCallback(async (path: string) => {
    const res = await fetch(`${apiBaseUrl}/v1/liff/camping/trips/${tripId}${path}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error('操作失敗');
    return res.json();
  }, [apiBaseUrl, accessToken, tripId]);

  return { post, put, del };
}

export function useAuditLogs(apiBaseUrl: string, accessToken: string, tripId: string) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/v1/liff/camping/trips/${tripId}/audit-logs`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error('載入失敗');
      const data = await res.json();
      setLogs(data.logs ?? []);
    } finally { setLoading(false); }
  }, [apiBaseUrl, accessToken, tripId]);

  useEffect(() => { refresh(); }, [refresh]);
  return { logs, loading, refresh };
}

export async function updateTripApi(apiBaseUrl: string, accessToken: string, tripId: string, input: {
  title?: string; startDate?: string; endDate?: string;
  creatorEmployeeId?: string; actorName?: string;
}) {
  const res = await fetch(`${apiBaseUrl}/v1/liff/camping/trips/${tripId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('更新失敗');
}

export async function unsettleTripApi(apiBaseUrl: string, accessToken: string, tripId: string, actorName?: string) {
  const res = await fetch(`${apiBaseUrl}/v1/liff/camping/trips/${tripId}/unsettle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ actorName }),
  });
  if (!res.ok) throw new Error('取消結算失敗');
}
