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
import { SessionList } from './features/massage/session-list';
import { AdminSessions } from './features/massage/admin-sessions';
import { CreateSession } from './features/massage/create-session';
import { SessionBookings } from './features/massage/session-bookings';
import { ScheduleManagement } from './features/massage/schedule-management';
import { AuthGuard } from './auth-guard';
import { TripList } from './features/camping/trip-list';
import { CreateTrip } from './features/camping/create-trip';
import { TripDetail } from './features/camping/trip-detail';
import { SharePage } from './features/camping/share-page';

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
          <Route path="/digital-id" element={<AuthGuard><DigitalIdCard /></AuthGuard>} />
          <Route path="/volunteer" element={<AuthGuard><ActivityList /></AuthGuard>} />
          <Route path="/volunteer/create" element={<AuthGuard><CreateActivity /></AuthGuard>} />
          <Route path="/volunteer/:activityId" element={<AuthGuard><ActivityDetail /></AuthGuard>} />
          <Route path="/volunteer/:activityId/report" element={<AuthGuard><Report /></AuthGuard>} />
          <Route path="/volunteer/:activityId/scan" element={<AuthGuard><CheckIn mode="organizer" /></AuthGuard>} />
          <Route path="/volunteer/:activityId/check-in" element={<AuthGuard><CheckIn mode="self" /></AuthGuard>} />
          <Route path="/admin" element={<AuthGuard><AdminPage /></AuthGuard>} />
          <Route path="/massage" element={<AuthGuard><SessionList /></AuthGuard>} />
          <Route path="/massage/admin" element={<AuthGuard><AdminSessions /></AuthGuard>} />
          <Route path="/massage/admin/create" element={<AuthGuard><CreateSession /></AuthGuard>} />
          <Route path="/massage/admin/sessions/:sessionId" element={<AuthGuard><SessionBookings /></AuthGuard>} />
          <Route path="/massage/admin/schedules" element={<AuthGuard><ScheduleManagement /></AuthGuard>} />
          <Route path="/camping" element={<AuthGuard><TripList /></AuthGuard>} />
          <Route path="/camping/new" element={<AuthGuard><CreateTrip /></AuthGuard>} />
          <Route path="/camping/:tripId" element={<AuthGuard><TripDetail /></AuthGuard>} />
          <Route path="/camping/:tripId/share" element={<SharePage />} />
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
