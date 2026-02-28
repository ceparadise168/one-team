import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SetupWizard } from './setup-wizard/setup-wizard';
import { EmployeeList } from './employee-management/employee-list';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
const adminToken = import.meta.env.VITE_ADMIN_TOKEN ?? 'dev-admin-token';

const api = { baseUrl: apiBaseUrl, adminToken };

function App() {
  const [tenantId, setTenantId] = useState('');

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <h1>ONE TEAM Admin</h1>

      <section style={{ marginBottom: 24 }}>
        <label>
          Tenant ID（用於員工管理）：{' '}
          <input
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="輸入 tenantId"
            style={{ width: 260 }}
          />
        </label>
      </section>

      <hr />

      <SetupWizard apiBaseUrl={apiBaseUrl} adminToken={adminToken} />

      <hr />

      {tenantId ? (
        <EmployeeList api={api} tenantId={tenantId} />
      ) : (
        <p>請先輸入 Tenant ID 以查看員工管理。</p>
      )}
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
