import { FormEvent, useState } from 'react';
import { useRegistration } from './use-registration';

interface RegistrationFormProps {
  apiBaseUrl: string;
  liffId: string;
  tenantId: string;
}

export function RegistrationForm({ apiBaseUrl, liffId, tenantId }: RegistrationFormProps) {
  const { isLiffReady, isSubmitting, isSuccess, error, submit } = useRegistration({
    apiBaseUrl,
    liffId,
    tenantId
  });

  const [employeeId, setEmployeeId] = useState('');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await submit({ employeeId });
  }

  if (isSuccess) {
    return (
      <section style={{ textAlign: 'center', padding: 32 }}>
        <h2>申請已送出</h2>
        <p>您的自助註冊申請已送出，請等候管理員審核。</p>
      </section>
    );
  }

  return (
    <section style={{ maxWidth: 400, margin: '0 auto', padding: 24 }}>
      <h2>員工自助註冊</h2>

      {!isLiffReady && <p>LIFF 初始化中…</p>}
      {error && <p style={{ color: 'red' }}>錯誤：{error}</p>}

      <form onSubmit={(e) => void onSubmit(e)}>
        <div style={{ marginBottom: 16 }}>
          <label>
            員工編號
            <br />
            <input
              required
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              disabled={!isLiffReady || isSubmitting}
              style={{ width: '100%' }}
            />
          </label>
        </div>
        <button type="submit" disabled={!isLiffReady || isSubmitting}>
          {isSubmitting ? '送出中…' : '送出申請'}
        </button>
      </form>
    </section>
  );
}
