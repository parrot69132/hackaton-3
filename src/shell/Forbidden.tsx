import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import type { Permission } from '../lib/types';

export function Forbidden({ permission }: { permission?: Permission }): React.JSX.Element {
  const { me } = useAuth();
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center">
      <p className="text-sm uppercase tracking-widest text-lumon-dim">Acceso restringido</p>
      <h1 className="mt-3 text-2xl text-lumon-cyan">Sin permiso</h1>
      <p className="mt-4 text-lumon-dim">
        Tu cuenta no tiene el permiso necesario para esta seccion.
        {permission !== undefined ? (
          <>
            {' '}
            Hace falta <code className="text-lumon-text">{permission}</code>.
          </>
        ) : null}
      </p>
      {me !== null ? (
        <p className="mt-2 text-xs text-lumon-dim">
          Rol actual: {me.role.name} ({me.role.code}). Permisos:{' '}
          {me.permissions.length > 0 ? me.permissions.join(', ') : 'ninguno'}.
        </p>
      ) : null}
      <Link to="/files" className="lumon-btn mt-8 inline-block">
        Volver a los archivos
      </Link>
    </main>
  );
}
