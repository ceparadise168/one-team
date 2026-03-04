import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './auth-context';
import { RegistrationForm } from './features/registration/registration-form';
import { DigitalIdCard } from './features/digital-id/digital-id-card';
import { ActivityList } from './features/volunteer/activity-list';
import { ActivityDetail } from './features/volunteer/activity-detail';
import { CreateActivity } from './features/volunteer/create-activity';
import { CheckIn } from './features/volunteer/check-in';
import { Report } from './features/volunteer/report';
import { AdminPage } from './features/admin/admin-page';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
const liffId = import.meta.env.VITE_LIFF_ID ?? '';

function App() {
  const params = new URLSearchParams(window.location.search);
  const tenantId = params.get('tenantId') ?? '';

  return (
    <BrowserRouter>
      <AuthProvider apiBaseUrl={apiBaseUrl}>
        <Routes>
          <Route
            path="/register"
            element={
              <RegistrationForm apiBaseUrl={apiBaseUrl} liffId={liffId} tenantId={tenantId} />
            }
          />
          <Route path="/digital-id" element={<DigitalIdCard />} />
          <Route path="/volunteer" element={<ActivityList />} />
          <Route path="/volunteer/create" element={<CreateActivity />} />
          <Route path="/volunteer/:activityId" element={<ActivityDetail />} />
          <Route path="/volunteer/:activityId/report" element={<Report />} />
          <Route path="/volunteer/:activityId/scan" element={<CheckIn mode="organizer" />} />
          <Route path="/volunteer/:activityId/check-in" element={<CheckIn mode="self" />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route
            path="/"
            element={
              <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
                <h1>ONE TEAM</h1>
                <ul>
                  <li>
                    <a href="/register?tenantId=demo">員工自助註冊</a>
                  </li>
                  <li>
                    <a href="/digital-id?tenantId=demo&accessToken=demo">數位員工證</a>
                  </li>
                </ul>
              </div>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
