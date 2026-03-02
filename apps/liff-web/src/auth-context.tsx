import { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';

interface AuthContextValue {
  accessToken: string;
  employeeId: string;
  tenantId: string;
  apiBaseUrl: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function parseJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function extractEmployeeId(accessToken: string): string {
  if (!accessToken) return '';
  const payload = parseJwtPayload(accessToken);
  if (payload && typeof payload.employeeId === 'string') {
    return payload.employeeId;
  }
  return '';
}

function getTokenExpSeconds(accessToken: string): number | null {
  const payload = parseJwtPayload(accessToken);
  if (payload && typeof payload.exp === 'number') return payload.exp;
  return null;
}

export function AuthProvider({
  children,
  apiBaseUrl,
}: {
  children: ReactNode;
  apiBaseUrl: string;
}) {
  const params = new URLSearchParams(window.location.search);
  const initialAccessToken = params.get('accessToken') ?? '';
  const tenantId = params.get('tenantId') ?? '';
  const initialRefreshToken = params.get('refreshToken') ?? '';

  const [accessToken, setAccessToken] = useState(initialAccessToken);
  const refreshTokenRef = useRef(initialRefreshToken);
  const refreshingRef = useRef(false);

  const employeeId = extractEmployeeId(accessToken);

  const refreshAccessToken = useCallback(async () => {
    const rt = refreshTokenRef.current;
    if (!rt || refreshingRef.current) return;
    refreshingRef.current = true;

    try {
      const res = await fetch(`${apiBaseUrl}/v1/public/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      });

      if (!res.ok) return;

      const data = (await res.json()) as {
        accessToken: string;
        refreshToken: string;
      };
      setAccessToken(data.accessToken);
      refreshTokenRef.current = data.refreshToken;
    } catch {
      // Refresh failed — token stays stale until next attempt
    } finally {
      refreshingRef.current = false;
    }
  }, [apiBaseUrl]);

  // Schedule proactive refresh before expiry
  useEffect(() => {
    if (!accessToken || !refreshTokenRef.current) return;

    const exp = getTokenExpSeconds(accessToken);
    if (!exp) return;

    const nowSec = Math.floor(Date.now() / 1000);
    // Refresh 60 seconds before expiry, minimum 5 seconds from now
    const refreshInMs = Math.max((exp - nowSec - 60) * 1000, 5000);

    const timer = setTimeout(() => {
      void refreshAccessToken();
    }, refreshInMs);

    return () => clearTimeout(timer);
  }, [accessToken, refreshAccessToken]);

  const value = { accessToken, employeeId, tenantId, apiBaseUrl };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
