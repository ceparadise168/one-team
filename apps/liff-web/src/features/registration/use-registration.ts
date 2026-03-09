import { useCallback, useEffect, useState } from 'react';
import liff from '@line/liff';
import type { RegistrationFormData, SelfRegisterResponse } from './types';

interface UseRegistrationOptions {
  apiBaseUrl: string;
  liffId: string;
  tenantId: string;
}

interface UseRegistrationResult {
  isLiffReady: boolean;
  isSubmitting: boolean;
  isSuccess: boolean;
  error: string | null;
  submit: (data: RegistrationFormData) => Promise<void>;
}

export function useRegistration({
  apiBaseUrl,
  liffId,
  tenantId
}: UseRegistrationOptions): UseRegistrationResult {
  const [isLiffReady, setIsLiffReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    liff
      .init({ liffId })
      .then(() => setIsLiffReady(true))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'LIFF init failed')
      );
  }, [liffId]);

  const submit = useCallback(
    async (data: RegistrationFormData) => {
      setIsSubmitting(true);
      setError(null);
      try {
        const lineIdToken = liff.getIDToken();
        if (!lineIdToken) {
          throw new Error('LINE ID token not available. Please open in LINE app.');
        }
        const response = await fetch(`${apiBaseUrl}/v1/public/self-register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            employeeId: data.employeeId,
            lineIdToken,
            ...(data.nickname ? { nickname: data.nickname } : {})
          })
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? `Registration failed: ${response.status}`);
        }
        await response.json() as SelfRegisterResponse;
        setIsSuccess(true);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsSubmitting(false);
      }
    },
    [apiBaseUrl, tenantId]
  );

  return { isLiffReady, isSubmitting, isSuccess, error, submit };
}
