import { useState, useEffect } from 'react';
import { useAuth } from '../../auth-context';

export function ProfilePage() {
  const { apiBaseUrl, tenantId, accessToken, employeeId } = useAuth();
  const [nickname, setNickname] = useState('');
  const [originalNickname, setOriginalNickname] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    async function fetchProfile() {
      try {
        const res = await fetch(`${apiBaseUrl}/v1/liff/tenants/${tenantId}/me/profile`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error('Failed to load profile');
        const data = await res.json();
        setNickname(data.nickname ?? '');
        setOriginalNickname(data.nickname ?? '');
      } catch {
        setMessage({ type: 'error', text: '無法載入個人資料' });
      } finally {
        setIsLoading(false);
      }
    }
    if (accessToken && tenantId) void fetchProfile();
  }, [apiBaseUrl, tenantId, accessToken]);

  async function handleSave() {
    setIsSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${apiBaseUrl}/v1/liff/tenants/${tenantId}/me/profile`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ nickname: nickname.trim() || undefined }),
      });
      if (!res.ok) throw new Error('Failed to save');
      const data = await res.json();
      setOriginalNickname(data.nickname ?? '');
      setMessage({ type: 'success', text: '已儲存' });
    } catch {
      setMessage({ type: 'error', text: '儲存失敗，請稍後再試' });
    } finally {
      setIsSaving(false);
    }
  }

  const hasChanges = nickname !== originalNickname;

  if (isLoading) {
    return <div style={{ padding: 32, textAlign: 'center' }}>載入中...</div>;
  }

  return (
    <section style={{ maxWidth: 400, margin: '0 auto', padding: 24 }}>
      <h2 style={{ marginBottom: 24 }}>我的資料</h2>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', marginBottom: 4, color: '#666', fontSize: 14 }}>
          員工編號
        </label>
        <div style={{ padding: '8px 12px', backgroundColor: '#f5f5f5', borderRadius: 4, color: '#333' }}>
          {employeeId}
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <label style={{ display: 'block', marginBottom: 4, color: '#666', fontSize: 14 }}>
          暱稱
        </label>
        <input
          value={nickname}
          onChange={(e) => { setNickname(e.target.value); setMessage(null); }}
          placeholder="你期望怎麼被稱呼呢？"
          disabled={isSaving}
          style={{ width: '100%', padding: '8px 12px', borderRadius: 4, border: '1px solid #ddd', fontSize: 16, boxSizing: 'border-box' }}
        />
      </div>

      {message && (
        <p style={{ color: message.type === 'success' ? '#06C755' : 'red', marginBottom: 16 }}>
          {message.text}
        </p>
      )}

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={isSaving || !hasChanges}
        style={{
          width: '100%',
          padding: '12px 0',
          fontSize: 16,
          backgroundColor: hasChanges ? '#06C755' : '#ccc',
          color: 'white',
          border: 'none',
          borderRadius: 8,
          cursor: hasChanges ? 'pointer' : 'default',
        }}
      >
        {isSaving ? '儲存中...' : '儲存'}
      </button>
    </section>
  );
}
