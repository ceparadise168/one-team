import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { RegistrationForm } from './features/registration/registration-form';
import { DigitalIdCard } from './features/digital-id/digital-id-card';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
const liffId = import.meta.env.VITE_LIFF_ID ?? '';

function App() {
  const params = new URLSearchParams(window.location.search);
  const tenantId = params.get('tenantId') ?? '';
  const accessToken = params.get('accessToken') ?? '';

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/register"
          element={
            <RegistrationForm apiBaseUrl={apiBaseUrl} liffId={liffId} tenantId={tenantId} />
          }
        />
        <Route
          path="/digital-id"
          element={
            <DigitalIdCard
              apiBaseUrl={apiBaseUrl}
              tenantId={tenantId}
              accessToken={accessToken}
            />
          }
        />
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
