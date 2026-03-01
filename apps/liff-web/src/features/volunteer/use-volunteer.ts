import { useState, useEffect, useCallback } from 'react';

interface VolunteerActivity {
  activityId: string;
  title: string;
  description: string;
  location: string;
  city: string | null;
  activityDate: string;
  startTime: string;
  endTime: string;
  capacity: number | null;
  checkInMode: 'organizer-scan' | 'self-scan';
  selfScanPayload: string | null;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  createdBy: string;
  createdAt: string;
}

interface ActivityDetail {
  activity: VolunteerActivity;
  registrationCount: number;
  myRegistration?: { status: string; registeredAt: string } | null;
  myCheckIn?: { checkedInAt: string; mode: string } | null;
}

interface Registration {
  activityId: string;
  employeeId: string;
  registeredAt: string;
  status: 'REGISTERED' | 'CANCELLED';
}

interface EnrichedRegistration extends Registration {
  activity: VolunteerActivity | null;
  checkedIn: boolean;
}

export type { VolunteerActivity, ActivityDetail, Registration, EnrichedRegistration };

export function useActivities(apiBaseUrl: string, accessToken: string) {
  const [activities, setActivities] = useState<VolunteerActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiBaseUrl}/v1/volunteer/activities?status=OPEN`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json())
      .then((data) => setActivities(data.activities))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiBaseUrl, accessToken]);

  return { activities, loading, error };
}

export function useActivityDetail(apiBaseUrl: string, accessToken: string, activityId: string) {
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    fetch(`${apiBaseUrl}/v1/volunteer/activities/${activityId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error('Activity not found');
        return r.json();
      })
      .then((data) => setDetail(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiBaseUrl, accessToken, activityId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { detail, loading, error, refresh };
}

export function useMyActivities(apiBaseUrl: string, accessToken: string) {
  const [registrations, setRegistrations] = useState<EnrichedRegistration[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    fetch(`${apiBaseUrl}/v1/volunteer/my-activities`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json())
      .then((data) => setRegistrations(data.registrations))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiBaseUrl, accessToken]);

  return { registrations, loading };
}

interface ReportData {
  activity: VolunteerActivity;
  registrations: Array<{
    activityId: string;
    employeeId: string;
    registeredAt: string;
    status: string;
  }>;
  checkIns: Array<{
    employeeId: string;
    checkedInAt: string;
    mode: string;
  }>;
}

export function useReport(apiBaseUrl: string, accessToken: string, activityId: string) {
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiBaseUrl}/v1/volunteer/activities/${activityId}/report`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load report');
        return r.json();
      })
      .then((data) => setReport(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiBaseUrl, accessToken, activityId]);

  return { report, loading, error };
}
