import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { getState, restore, subscribe } from '../lib/session';
import type { SessionState } from '../lib/session';
import type { Me, Permission } from '../lib/types';

interface AuthValue {
  state: SessionState;
  me: Me | null;
  /** La interfaz se decide por `permissions`, nunca por `role.code`. */
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

let restoreStarted = false;

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const state = useSyncExternalStore(subscribe, getState, getState);

  useEffect(() => {
    if (restoreStarted) return;
    restoreStarted = true;
    void restore();
  }, []);

  const value = useMemo<AuthValue>(() => {
    const me = state.status === 'authenticated' ? state.me : null;
    return {
      state,
      me,
      can: (permission: Permission): boolean => me?.permissions.includes(permission) ?? false,
    };
  }, [state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
