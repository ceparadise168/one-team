import { useMemo, useState } from 'react';
import { SetupWizardApiClient } from './api-client.js';
import { SetupWizardActions, SetupWizardState } from './types.js';

export function useSetupWizard(input: {
  apiBaseUrl: string;
  adminToken: string;
}): {
  state: SetupWizardState;
  actions: SetupWizardActions;
} {
  const [state, setState] = useState<SetupWizardState>({
    isSubmitting: false
  });

  const api = useMemo(() => {
    return new SetupWizardApiClient({
      baseUrl: input.apiBaseUrl,
      adminToken: input.adminToken
    });
  }, [input.apiBaseUrl, input.adminToken]);

  const actions: SetupWizardActions = {
    async createTenant(payload) {
      setState((prev) => ({ ...prev, isSubmitting: true, error: undefined }));
      try {
        const snapshot = await api.createTenant(payload);
        setState({ isSubmitting: false, snapshot });
      } catch (error) {
        setState((prev) => ({
          ...prev,
          isSubmitting: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }));
      }
    },

    async connectLineCredentials(payload) {
      setState((prev) => ({ ...prev, isSubmitting: true, error: undefined }));

      try {
        const tenantId = assertTenantId(state);
        const snapshot = await api.connectLineCredentials({
          tenantId,
          channelId: payload.channelId,
          channelSecret: payload.channelSecret
        });
        setState({ isSubmitting: false, snapshot });
      } catch (error) {
        setState((prev) => ({
          ...prev,
          isSubmitting: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }));
      }
    },

    async provisionLineResources() {
      setState((prev) => ({ ...prev, isSubmitting: true, error: undefined }));

      try {
        const tenantId = assertTenantId(state);
        const result = await api.provisionLineResources({ tenantId });
        setState({ isSubmitting: false, snapshot: result.snapshot });
      } catch (error) {
        setState((prev) => ({
          ...prev,
          isSubmitting: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }));
      }
    },

    async verifyWebhook(payload) {
      setState((prev) => ({ ...prev, isSubmitting: true, error: undefined }));

      try {
        const tenantId = assertTenantId(state);
        const snapshot = await api.verifyWebhook({
          tenantId,
          verificationToken: payload.verificationToken
        });
        setState({ isSubmitting: false, snapshot });
      } catch (error) {
        setState((prev) => ({
          ...prev,
          isSubmitting: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }));
      }
    },

    async refreshStatus() {
      setState((prev) => ({ ...prev, isSubmitting: true, error: undefined }));

      try {
        const tenantId = assertTenantId(state);
        const snapshot = await api.getSetupStatus({ tenantId });
        setState({ isSubmitting: false, snapshot });
      } catch (error) {
        setState((prev) => ({
          ...prev,
          isSubmitting: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }));
      }
    },

    clearError() {
      setState((prev) => ({ ...prev, error: undefined }));
    }
  };

  return {
    state,
    actions
  };
}

function assertTenantId(state: SetupWizardState): string {
  const tenantId = state.snapshot?.tenantId;

  if (!tenantId) {
    throw new Error('Please create tenant first');
  }

  return tenantId;
}
