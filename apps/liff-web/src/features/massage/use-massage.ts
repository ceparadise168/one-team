import { useState, useEffect, useCallback } from 'react';

export interface MassageSession {
  tenantId: string;
  sessionId: string;
  date: string;
  startAt: string;
  endAt: string;
  location: string;
  quota: number;
  slotDurationMinutes: number;
  therapistCount: number;
  mode: 'FIRST_COME' | 'LOTTERY';
  openAt: string;
  drawAt: string | null;
  drawMode: 'AUTO' | 'MANUAL';
  drawnAt: string | null;
  status: 'ACTIVE' | 'CANCELLED';
  createdByEmployeeId: string;
  createdAt: string;
}

export interface MassageBooking {
  tenantId: string;
  bookingId: string;
  sessionId: string;
  employeeId: string;
  lineUserId: string;
  slotStartAt: string;
  status: 'REGISTERED' | 'CONFIRMED' | 'WAITLISTED' | 'UNSUCCESSFUL' | 'CANCELLED';
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
}

export interface SlotInfo {
  startAt: string;
  confirmed: number;
  waitlisted: number;
  capacity: number;
}

export function useMassageSessions(apiBaseUrl: string, accessToken: string) {
  const [sessions, setSessions] = useState<MassageSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    const today = new Date().toISOString().slice(0, 10);
    fetch(`${apiBaseUrl}/v1/massage/sessions?fromDate=${today}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error('載入失敗');
        return r.json();
      })
      .then((data) => {
        setSessions(data.sessions ?? []);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiBaseUrl, accessToken]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { sessions, loading, error, refresh };
}

export function useMyMassageBookings(apiBaseUrl: string, accessToken: string) {
  const [bookings, setBookings] = useState<MassageBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    fetch(`${apiBaseUrl}/v1/massage/my-bookings`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error('載入失敗');
        return r.json();
      })
      .then((data) => {
        setBookings(data.bookings ?? []);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiBaseUrl, accessToken]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { bookings, loading, error, refresh };
}

export function useSessionSlots(apiBaseUrl: string, accessToken: string, sessionId: string) {
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    fetch(`${apiBaseUrl}/v1/massage/sessions/${sessionId}/slots`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error('載入失敗');
        return r.json();
      })
      .then((data) => {
        setSlots(data.slots ?? []);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiBaseUrl, accessToken, sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { slots, loading, error, refresh };
}

export function useMassageBook(apiBaseUrl: string, accessToken: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const book = useCallback(
    async (sessionId: string, slotStartAt: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiBaseUrl}/v1/massage/sessions/${sessionId}/book`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ slotStartAt }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || '預約失敗');
        }
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl, accessToken]
  );

  return { book, loading, error };
}

export function useCancelMassageBooking(apiBaseUrl: string, accessToken: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = useCallback(
    async (bookingId: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiBaseUrl}/v1/massage/bookings/${bookingId}/cancel`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || '取消失敗');
        }
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl, accessToken]
  );

  return { cancel, loading, error };
}

export function useCreateMassageSession(apiBaseUrl: string, accessToken: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    async (body: {
      date: string;
      startAt: string;
      endAt: string;
      location: string;
      slotDurationMinutes: number;
      therapistCount: number;
      mode: 'FIRST_COME' | 'LOTTERY';
      openAt: string;
      drawAt?: string;
    }) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiBaseUrl}/v1/massage/sessions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || '建立失敗');
        }
        return await res.json();
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl, accessToken]
  );

  return { create, loading, error };
}

export function useSessionBookings(
  apiBaseUrl: string,
  accessToken: string,
  sessionId: string
) {
  const [session, setSession] = useState<MassageSession | null>(null);
  const [bookings, setBookings] = useState<MassageBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    fetch(`${apiBaseUrl}/v1/massage/sessions/${sessionId}/bookings`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error('載入失敗');
        return r.json();
      })
      .then((data) => {
        setSession(data.session ?? null);
        setBookings(data.bookings ?? []);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiBaseUrl, accessToken, sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { session, bookings, loading, error, refresh };
}

export function useCancelMassageSession(apiBaseUrl: string, accessToken: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = useCallback(
    async (sessionId: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiBaseUrl}/v1/massage/sessions/${sessionId}/cancel`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || '取消失敗');
        }
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl, accessToken]
  );

  return { cancel, loading, error };
}

export function useAdminCancelBooking(apiBaseUrl: string, accessToken: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = useCallback(
    async (bookingId: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiBaseUrl}/v1/massage/bookings/${bookingId}/admin-cancel`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || '取消失敗');
        }
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl, accessToken]
  );

  return { cancel, loading, error };
}

export function useExecuteDraw(apiBaseUrl: string, accessToken: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draw = useCallback(
    async (sessionId: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiBaseUrl}/v1/massage/sessions/${sessionId}/draw`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || '抽籤失敗');
        }
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl, accessToken]
  );

  return { draw, loading, error };
}
