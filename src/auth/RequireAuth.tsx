import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { Spinner } from '../shell/Spinner';

/**
 * Ruta privada. Mientras se restaura la sesion NO se muestra el login.
 * Si no hay sesion, se guarda el destino exacto (ruta + query string) en
 * ?next= para volver ahi despues de entrar.
 */
export function RequireAuth(): React.JSX.Element {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') {
    return <Spinner label="Verificando tu sesion…" />;
  }

  if (state.status === 'anonymous') {
    const next = `${location.pathname}${location.search}${location.hash}`;
    const search = new URLSearchParams({ next });
    return <Navigate to={`/login?${search.toString()}`} replace state={{ reason: state.reason }} />;
  }

  return <Outlet />;
}
