import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getHealth } from '../lib/api';
import { backoffDelay } from '../lib/backoff';

type Phase = 'checking' | 'ok' | 'down';

/**
 * Si /meta/health no responde, la app muestra "Conectando con Lumon…" y
 * reintenta sola con espera creciente, con opcion de reintentar a mano.
 * La primera request despues de un rato puede tardar varios segundos.
 */
export function HealthGate({ children }: { children: ReactNode }): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('checking');
  const [attempt, setAttempt] = useState(0);
  const [nextRetryMs, setNextRetryMs] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const check = useCallback(async (): Promise<void> => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase((p) => (p === 'ok' ? 'ok' : 'checking'));
    try {
      const health = await getHealth(ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (health.status === 'ok') {
        setPhase('ok');
        setAttempt(0);
        setNextRetryMs(null);
        return;
      }
      throw new Error('estado no ok');
    } catch {
      if (ctrl.signal.aborted) return;
      setPhase('down');
      setAttempt((a) => a + 1);
    }
  }, []);

  useEffect(() => {
    void check();
    return () => {
      abortRef.current?.abort();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [check]);

  // Reintento automatico con espera creciente.
  useEffect(() => {
    if (phase !== 'down') return undefined;
    const delay = backoffDelay(Math.min(attempt, 6), 1000, 30_000);
    setNextRetryMs(delay);
    timerRef.current = window.setTimeout(() => {
      void check();
    }, delay);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [phase, attempt, check]);

  if (phase === 'ok') return <>{children}</>;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <div
        className="h-10 w-10 animate-spin rounded-full border-2 border-lumon-line border-t-lumon-cyan motion-reduce:animate-none"
        aria-hidden="true"
      />
      <h1 className="text-xl text-lumon-cyan" role="status">
        Conectando con Lumon…
      </h1>
      <p className="text-sm text-lumon-dim">
        {phase === 'checking'
          ? 'La primera conexion puede tardar unos segundos.'
          : `No responde. Reintentando en ${Math.round((nextRetryMs ?? 0) / 1000)} s (intento ${attempt}).`}
      </p>
      <button type="button" onClick={() => void check()} className="lumon-btn">
        Reintentar ahora
      </button>
    </main>
  );
}
