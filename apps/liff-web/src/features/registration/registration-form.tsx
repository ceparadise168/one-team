import { FormEvent, useState } from 'react';
import liff from '@line/liff';
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
  const [nickname, setNickname] = useState('');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await submit({ employeeId, nickname: nickname.trim() || undefined });
  }

  if (isSuccess) {
    return (
      <section style={{ textAlign: 'center', padding: 32 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
        <h2 style={{ marginBottom: 8 }}>申請已送出</h2>
        <p style={{ color: '#666', lineHeight: 1.6, marginBottom: 24 }}>
          管理員已收到您的申請通知，<br />
          審核通過後您會收到 LINE 訊息。
        </p>
        <button
          type="button"
          onClick={() => {
            try { liff.closeWindow(); } catch { window.close(); }
          }}
          style={{
            padding: '12px 32px',
            fontSize: 16,
            backgroundColor: '#06C755',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer'
          }}
        >
          關閉
        </button>
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
        <div style={{ marginBottom: 16 }}>
          <label>
            暱稱（選填）
            <br />
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="你期望怎麼被稱呼呢？"
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
