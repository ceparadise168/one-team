import { useAuditLogs } from './use-camping';
import type { AuditLog } from './use-camping';
import { campingStyles as cs } from './camping-shared';
import type React from 'react';

interface Props {
  tripId: string;
  apiBaseUrl: string;
  accessToken: string;
}

export function HistoryTab({ tripId, apiBaseUrl, accessToken }: Props) {
  const { logs, loading } = useAuditLogs(apiBaseUrl, accessToken, tripId);

  if (loading) return <div style={cs.loading}>載入中...</div>;
  if (logs.length === 0) return <div style={styles.empty}>尚無操作紀錄</div>;

  return (
    <div>
      {logs.map((log, i) => (
        <div key={i} style={cs.card}>
          <div style={styles.timestamp}>
            {formatDate(log.createdAt)}
          </div>
          <div style={styles.action}>
            <strong>{log.actorName}</strong> {describeAction(log)}
          </div>
          {log.changes && (
            <div style={styles.changes}>
              {Object.entries(log.changes).map(([field, { from, to }]) => (
                <div key={field}>{translateField(field)}: {formatValue(from)} → {formatValue(to)}</div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function describeAction(log: AuditLog): string {
  const entityTypes: Record<string, string> = {
    TRIP: '行程', PARTICIPANT: '參與者', CAMPSITE: '營位',
    EXPENSE: '費用', SETTLEMENT: '結算',
  };
  const actions: Record<string, string> = {
    CREATE: '新增了', UPDATE: '修改了', DELETE: '刪除了',
  };
  if (log.entityType === 'SETTLEMENT' && log.action === 'CREATE') return '完成了結算';
  if (log.entityType === 'SETTLEMENT' && log.action === 'DELETE') return '取消了結算';
  return `${actions[log.action]}${entityTypes[log.entityType]}「${log.entityName}」`;
}

function translateField(field: string): string {
  const map: Record<string, string> = {
    title: '標題', startDate: '開始日期', endDate: '結束日期',
    name: '名稱', cost: '費用', amount: '金額',
    description: '說明', splitType: '分帳方式',
    paidByParticipantId: '代墊人', splitWeight: '分攤比例',
    creatorEmployeeId: '建立者',
  };
  return map[field] ?? field;
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '-';
  if (typeof val === 'number') return `$${val.toLocaleString()}`;
  return String(val);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

const styles: Record<string, React.CSSProperties> = {
  empty: { textAlign: 'center', padding: '32px 0', fontSize: 14, color: '#999' },
  timestamp: { fontSize: 12, color: '#999' },
  action: { fontSize: 14, marginTop: 4 },
  changes: { fontSize: 13, color: '#666', marginTop: 4 },
};
