import { useMemo } from 'react';
import { useAuth } from '../../auth-context';
import { useDigitalId } from './use-digital-id.js';

export function DigitalIdCard() {
  const { apiBaseUrl, tenantId, accessToken } = useAuth();
  const { state, refreshNow } = useDigitalId({
    apiBaseUrl,
    tenantId,
    accessToken,
  });

  const expiresAt = useMemo(() => {
    if (!state.expiresAtEpochSeconds) {
      return '-';
    }

    return new Date(state.expiresAtEpochSeconds * 1000).toISOString();
  }, [state.expiresAtEpochSeconds]);

  return (
    <section>
      <h2>Dynamic Digital Employee ID</h2>
      <p>Status: {state.isLoading ? 'loading' : 'ready'}</p>

      {state.error ? <p>Error: {state.error}</p> : null}

      <p>Expires At: {expiresAt}</p>
      <p>Refresh In: {state.refreshInSeconds ?? '-'} seconds</p>

      <div>
        <h3>QR Payload</h3>
        <code>{state.payload ?? '-'}</code>
      </div>

      <button type="button" onClick={() => void refreshNow()}>
        Refresh now
      </button>
    </section>
  );
}
