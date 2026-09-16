import {StrictMode, lazy, Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/inter/latin.css';
import '@fontsource/inter/latin-ext.css';
const App = lazy(() => import('./App.tsx'));
const AdminApp = lazy(() => import('./AdminApp.tsx').then((m) => ({ default: m.AdminApp }))); 
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider } from './contexts/AuthContext';
import './index.css';
import { initWebVitalsReporting } from './utils/rum';

const rootElement = document.getElementById('root');
if (!rootElement) {
  const fallback = document.createElement('div');
  fallback.setAttribute('role', 'alert');
  fallback.style.cssText = 'min-height:100vh;display:grid;place-items:center;padding:2rem;font-family:Inter,Arial,sans-serif;color:#202426;background:#EDEEEE;text-align:center;';
  fallback.textContent = 'Gadwal couldn’t start. Reload the page and try again.';
  document.body.appendChild(fallback);
} else {
  const isAdmin = window.location.pathname.startsWith('/admin');
  createRoot(rootElement).render(
    <StrictMode>
      <ErrorBoundary>
        <AuthProvider>
          <Suspense fallback={<div role="status" aria-live="polite" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem', fontFamily: 'Inter, Arial, sans-serif', color: '#202426', background: '#EDEEEE' }}>Loading Gadwal…</div>}>
            {isAdmin ? <AdminApp /> : <App />}
          </Suspense>
        </AuthProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
}
