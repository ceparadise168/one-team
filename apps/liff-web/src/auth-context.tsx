import { createContext, useContext, useMemo } from 'react';
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

export function AuthProvider({
  children,
  apiBaseUrl,
}: {
  children: ReactNode;
  apiBaseUrl: string;
}) {
  const value = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const accessToken = params.get('accessToken') ?? '';
    const tenantId = params.get('tenantId') ?? '';

    let employeeId = '';
    if (accessToken) {
      const payload = parseJwtPayload(accessToken);
      if (payload && typeof payload.employeeId === 'string') {
        employeeId = payload.employeeId;
      }
    }

    return { accessToken, employeeId, tenantId, apiBaseUrl };
  }, [apiBaseUrl]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
