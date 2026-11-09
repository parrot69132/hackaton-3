import { Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { Forbidden } from '../shell/Forbidden';
import type { Permission } from '../lib/types';

/**
 * Abrir por URL una ruta sin el permiso muestra una pagina "sin permiso",
 * nunca un error ni una pantalla en blanco.
 */
export function RequirePermission({
  permission,
}: {
  permission: Permission;
}): React.JSX.Element {
  const { can } = useAuth();
  if (!can(permission)) return <Forbidden permission={permission} />;
  return <Outlet />;
}
