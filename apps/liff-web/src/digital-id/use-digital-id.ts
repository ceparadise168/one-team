import { useEffect, useMemo, useRef, useState } from 'react';
import { DigitalIdCardState, DigitalIdResponse } from './types.js';

export function useDigitalId(input: {
  apiBaseUrl: string;
  tenantId: string;
  accessToken: string;
  refreshSeconds?: number;
}): {
  state: DigitalIdCardState;
  refreshNow: () => Promise<void>;
} {
  const [state, setState] = useState<DigitalIdCardState>({ isLoading: true });
  const mountedRef = useRef(true);

  const refreshIntervalMs = useMemo(() => (input.refreshSeconds ?? 25) * 1000, [input.refreshSeconds]);

  async function fetchDigitalId(): Promise<void> {
    setState((prev) => ({ ...prev, isLoading: true, error: undefined }));

    try {
      const response = await fetch(
        `${input.apiBaseUrl.replace(/\/$/, '')}/v1/liff/tenants/${input.tenantId}/me/digital-id`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${input.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorBody?.error ?? `Failed to load digital ID (${response.status})`);
      }

      const payload = (await response.json()) as DigitalIdResponse;

      if (!mountedRef.current) {
        return;
      }

      setState({
        isLoading: false,
        payload: payload.payload,
        expiresAtEpochSeconds: payload.expiresAtEpochSeconds,
        refreshInSeconds: payload.refreshInSeconds
      });
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }

      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    void fetchDigitalId();

    const timer = setInterval(() => {
      void fetchDigitalId();
    }, refreshIntervalMs);

    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [refreshIntervalMs, input.apiBaseUrl, input.tenantId, input.accessToken]);

  return {
    state,
    refreshNow: fetchDigitalId
  };
}
