import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { ErrorBoundary } from './shell/ErrorBoundary';
import { HealthGate } from './shell/HealthGate';
import './index.css';

const container = document.getElementById('root');
if (container === null) throw new Error('Falta #root en index.html');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <HealthGate>
          <AuthProvider>
            <App />
          </AuthProvider>
        </HealthGate>
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
);
