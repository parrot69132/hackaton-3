import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './auth/LoginPage';
import { RegisterPage } from './auth/RegisterPage';
import { RequireAuth } from './auth/RequireAuth';
import { RequirePermission } from './auth/RequirePermission';
import { FilesListPage } from './files/FilesListPage';
import { StatusPage } from './status/StatusPage';
import { Layout } from './shell/Layout';
import { NotFound } from './shell/NotFound';
import { Spinner } from './shell/Spinner';

// La grilla del CP2 se carga aparte: no entra en el bundle inicial de /login (CP6).
const RefinePage = lazy(async () => {
  const mod = await import('./files/refine/RefinePage');
  return { default: mod.RefinePage };
});

export function App(): React.JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/files" replace />} />
          <Route path="/estado" element={<StatusPage />} />

          <Route element={<RequirePermission permission="files:read" />}>
            <Route path="/files" element={<FilesListPage />} />
            <Route
              path="/files/:id/refine"
              element={
                <Suspense fallback={<Spinner label="Abriendo el archivo…" />}>
                  <RefinePage />
                </Suspense>
              }
            />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
