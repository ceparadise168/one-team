import { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import liff from '@line/liff';

export type AuthStatus = 'authenticated' | 'expired' | 'none' | 'authenticating';

interface AuthContextValue {
  accessToken: string;
  employeeId: string;
  tenantId: string;
  apiBaseUrl: string;
  authStatus: AuthStatus;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY_REFRESH = 'one_team_refresh_token';
const STORAGE_KEY_ACCESS = 'one_team_access_token';
const STORAGE_KEY_TENANT = 'one_team_tenant_id';

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

function isTokenExpired(accessToken: string): boolean {
  const exp = getTokenExpSeconds(accessToken);
  if (!exp) return true;
  return Math.floor(Date.now() / 1000) >= exp;
}

/** Read initial tokens: URL params take priority, then sessionStorage */
function getInitialTokens(): { accessToken: string; refreshToken: string; tenantId: string } {
  const params = new URLSearchParams(window.location.search);
  const urlAccess = params.get('accessToken') ?? '';
  const urlRefresh = params.get('refreshToken') ?? '';
  const urlTenant = params.get('tenantId') ?? '';

  if (urlAccess) {
    // Fresh tokens from URL — persist to sessionStorage
    try {
      sessionStorage.setItem(STORAGE_KEY_ACCESS, urlAccess);
      if (urlRefresh) sessionStorage.setItem(STORAGE_KEY_REFRESH, urlRefresh);
      if (urlTenant) sessionStorage.setItem(STORAGE_KEY_TENANT, urlTenant);
    } catch { /* private browsing */ }

    // Clean URL params to avoid leaking tokens in history
    const url = new URL(window.location.href);
    url.searchParams.delete('accessToken');
    url.searchParams.delete('refreshToken');
    url.searchParams.delete('tenantId');
    window.history.replaceState({}, '', url.toString());

    return { accessToken: urlAccess, refreshToken: urlRefresh, tenantId: urlTenant };
  }

  // Fallback: restore from sessionStorage (survives F5 refresh)
  const storedAccess = sessionStorage.getItem(STORAGE_KEY_ACCESS) ?? '';
  const storedRefresh = sessionStorage.getItem(STORAGE_KEY_REFRESH) ?? '';
  const storedTenant = sessionStorage.getItem(STORAGE_KEY_TENANT) ?? '';
  // URL tenantId takes priority (e.g. shared link with tenantId but no accessToken)
  const tenantId = urlTenant || storedTenant;
  if (urlTenant && urlTenant !== storedTenant) {
    try { sessionStorage.setItem(STORAGE_KEY_TENANT, urlTenant); } catch { /* private browsing */ }
  }
  return { accessToken: storedAccess, refreshToken: storedRefresh, tenantId };
}

export function AuthProvider({
  children,
  apiBaseUrl,
  liffId,
}: {
  children: ReactNode;
  apiBaseUrl: string;
  liffId: string;
}) {
  const initial = getInitialTokens();

  const [accessToken, setAccessToken] = useState(initial.accessToken);
  const [authStatus, setAuthStatus] = useState<AuthStatus>(
    initial.accessToken ? (isTokenExpired(initial.accessToken) ? 'expired' : 'authenticated') : 'none'
  );
  const tenantId = initial.tenantId;
  const refreshTokenRef = useRef(initial.refreshToken);
  const refreshingRef = useRef(false);
  const liffAttemptedRef = useRef(false);

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

      if (!res.ok) {
        // Refresh failed — mark as expired
        setAuthStatus('expired');
        return;
      }

      const data = (await res.json()) as {
        accessToken: string;
        refreshToken: string;
      };
      setAccessToken(data.accessToken);
      refreshTokenRef.current = data.refreshToken;
      setAuthStatus('authenticated');

      // Persist new tokens
      try {
        sessionStorage.setItem(STORAGE_KEY_ACCESS, data.accessToken);
        sessionStorage.setItem(STORAGE_KEY_REFRESH, data.refreshToken);
      } catch { /* private browsing */ }
    } catch {
      setAuthStatus('expired');
    } finally {
      refreshingRef.current = false;
    }
  }, [apiBaseUrl]);

  // On mount: if access token is expired but we have refresh token, try refresh immediately
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (accessToken && isTokenExpired(accessToken) && refreshTokenRef.current) {
      void refreshAccessToken();
    }
  }, [accessToken, refreshAccessToken]);

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

  // LIFF auto-login: when no tokens are available but inside LINE, use LIFF SDK
  useEffect(() => {
    if (authStatus !== 'none' || !tenantId || !liffId || liffAttemptedRef.current) return;
    liffAttemptedRef.current = true;

    let cancelled = false;
    setAuthStatus('authenticating');

    (async () => {
      try {
        await liff.init({ liffId });

        if (!liff.isLoggedIn()) {
          if (!cancelled) setAuthStatus('none');
          return;
        }

        const idToken = liff.getIDToken();
        if (!idToken) {
          if (!cancelled) setAuthStatus('none');
          return;
        }

        const res = await fetch(`${apiBaseUrl}/v1/public/auth/line-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, lineIdToken: idToken }),
        });

        if (!res.ok) {
          if (!cancelled) setAuthStatus('none');
          return;
        }

        const tokens = await res.json() as { accessToken: string; refreshToken: string };

        if (cancelled) return;

        setAccessToken(tokens.accessToken);
        refreshTokenRef.current = tokens.refreshToken;
        setAuthStatus('authenticated');

        try {
          sessionStorage.setItem(STORAGE_KEY_ACCESS, tokens.accessToken);
          sessionStorage.setItem(STORAGE_KEY_REFRESH, tokens.refreshToken);
          sessionStorage.setItem(STORAGE_KEY_TENANT, tenantId);
        } catch { /* private browsing */ }
      } catch (err) {
        console.warn('[AuthProvider] LIFF auto-login failed:', err);
        if (!cancelled) setAuthStatus('none');
      }
    })();

    return () => { cancelled = true; };
  }, [authStatus, tenantId, liffId, apiBaseUrl]);

  const value = { accessToken, employeeId, tenantId, apiBaseUrl, authStatus };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
