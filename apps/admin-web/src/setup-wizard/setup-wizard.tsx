import { FormEvent, useState } from 'react';
import { useSetupWizard } from './use-setup-wizard.js';

export function SetupWizard(props: { apiBaseUrl: string; adminToken: string }) {
  const { state, actions } = useSetupWizard({
    apiBaseUrl: props.apiBaseUrl,
    adminToken: props.adminToken
  });

  const [tenantName, setTenantName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [channelId, setChannelId] = useState('');
  const [channelSecret, setChannelSecret] = useState('');
  const [verificationToken, setVerificationToken] = useState('');

  async function onCreateTenant(event: FormEvent) {
    event.preventDefault();
    await actions.createTenant({ tenantName, adminEmail });
  }

  async function onConnectLine(event: FormEvent) {
    event.preventDefault();
    await actions.connectLineCredentials({ channelId, channelSecret });
  }

  async function onVerifyWebhook(event: FormEvent) {
    event.preventDefault();
    await actions.verifyWebhook({ verificationToken });
  }

  const snapshot = state.snapshot;

  return (
    <section>
      <h2>5-Minute Setup Wizard</h2>

      {state.error ? (
        <p>
          Error: {state.error} <button onClick={() => actions.clearError()}>Dismiss</button>
        </p>
      ) : null}

      <p>Submitting: {state.isSubmitting ? 'yes' : 'no'}</p>

      <form onSubmit={onCreateTenant}>
        <h3>Step 1: Create Tenant</h3>
        <label>
          Tenant Name
          <input value={tenantName} onChange={(event) => setTenantName(event.target.value)} />
        </label>
        <label>
          Admin Email
          <input
            type="email"
            value={adminEmail}
            onChange={(event) => setAdminEmail(event.target.value)}
          />
        </label>
        <button type="submit" disabled={state.isSubmitting}>
          Create Tenant
        </button>
      </form>

      <form onSubmit={onConnectLine}>
        <h3>Step 2: Connect LINE</h3>
        <label>
          Channel ID
          <input value={channelId} onChange={(event) => setChannelId(event.target.value)} />
        </label>
        <label>
          Channel Secret
          <input
            type="password"
            value={channelSecret}
            onChange={(event) => setChannelSecret(event.target.value)}
          />
        </label>
        <button type="submit" disabled={state.isSubmitting || !snapshot?.tenantId}>
          Connect
        </button>
      </form>

      <section>
        <h3>Step 3: Provision LINE Resources</h3>
        <button
          type="button"
          onClick={() => actions.provisionLineResources()}
          disabled={state.isSubmitting || !snapshot?.tenantId}
        >
          Auto-Provision LIFF + Rich Menu + Webhook
        </button>
      </section>

      <form onSubmit={onVerifyWebhook}>
        <h3>Step 4: Verify Webhook</h3>
        <label>
          Verification Token
          <input
            value={verificationToken}
            onChange={(event) => setVerificationToken(event.target.value)}
          />
        </label>
        <button type="submit" disabled={state.isSubmitting || !snapshot?.tenantId}>
          Verify Webhook
        </button>
      </form>

      <section>
        <h3>Setup Status</h3>
        <button type="button" onClick={() => actions.refreshStatus()} disabled={!snapshot?.tenantId}>
          Refresh Status
        </button>
        <pre>{JSON.stringify(snapshot, null, 2)}</pre>
      </section>
    </section>
  );
}
