import type { ReactNode } from 'react';
import { useAuth } from './auth-context';

export function AuthGuard({ children }: { children: ReactNode }) {
  const { authStatus } = useAuth();

  if (authStatus === 'none') {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p style={styles.icon}>🔒</p>
          <h2 style={styles.title}>尚未登入</h2>
          <p style={styles.desc}>
            請從 LINE 選單重新進入服務，系統會自動完成登入。
          </p>
          <p style={styles.hint}>提示：請回到 LINE 聊天室，點選下方選單的「員工服務」。</p>
        </div>
      </div>
    );
  }

  if (authStatus === 'expired') {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p style={styles.icon}>⏰</p>
          <h2 style={styles.title}>登入已過期</h2>
          <p style={styles.desc}>
            您的登入憑證已過期，請從 LINE 選單重新進入服務。
          </p>
          <p style={styles.hint}>提示：請回到 LINE 聊天室，點選下方選單的「員工服務」重新開啟。</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 24,
    fontFamily: 'sans-serif',
    maxWidth: 480,
    margin: '0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '60vh',
  },
  card: {
    textAlign: 'center',
    padding: 32,
    border: '1px solid #e0e0e0',
    borderRadius: 16,
    backgroundColor: '#fff',
  },
  icon: { fontSize: 48, margin: '0 0 12px 0' },
  title: { fontSize: 20, margin: '0 0 12px 0', color: '#333' },
  desc: { fontSize: 15, color: '#555', margin: '0 0 16px 0', lineHeight: 1.6 },
  hint: {
    fontSize: 13,
    color: '#888',
    margin: 0,
    padding: '12px 16px',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    lineHeight: 1.5,
  },
};
