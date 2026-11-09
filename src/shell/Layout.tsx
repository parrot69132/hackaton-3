import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { logout } from '../lib/session';
import { BUILD_SHA } from '../lib/env';

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive
    ? 'rounded px-3 py-1.5 text-lumon-bg bg-lumon-cyan'
    : 'rounded px-3 py-1.5 text-lumon-dim hover:text-lumon-cyan';
}

export function Layout(): React.JSX.Element {
  const { me, can } = useAuth();
  const [leaving, setLeaving] = useState(false);

  async function onLogout(): Promise<void> {
    setLeaving(true);
    try {
      await logout();
    } finally {
      setLeaving(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-lumon-cyan focus:px-3 focus:py-2 focus:text-lumon-bg"
      >
        Saltar al contenido
      </a>

      <header className="border-b border-lumon-line bg-lumon-panel">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Link to="/files" className="text-lumon-cyan">
            Lumon · MDR
          </Link>

          <nav aria-label="Secciones" className="flex flex-wrap items-center gap-1 text-sm">
            {can('files:read') ? (
              <NavLink to="/files" className={navClass}>
                Archivos
              </NavLink>
            ) : null}
            <NavLink to="/estado" className={navClass}>
              Estado
            </NavLink>
          </nav>

          <div className="ml-auto flex items-center gap-3 text-xs text-lumon-dim">
            {me !== null ? (
              <span>
                {me.team.code} · {me.displayName} · {me.role.name}
              </span>
            ) : null}
            <span className="hidden sm:inline" title="Commit desplegado">
              build {BUILD_SHA}
            </span>
            <button
              type="button"
              onClick={() => void onLogout()}
              disabled={leaving}
              className="lumon-btn-ghost"
            >
              {leaving ? 'Saliendo…' : 'Salir'}
            </button>
          </div>
        </div>
      </header>

      <div id="contenido" className="flex-1">
        <Outlet />
      </div>
    </div>
  );
}
