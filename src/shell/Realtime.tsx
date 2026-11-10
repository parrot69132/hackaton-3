import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { humanMessage } from '../lib/errors';
import { killSession } from '../lib/session';
import { eventStream, type LumonEvent, type StreamStatus } from '../lib/realtime/eventStream';
import { useAuth } from '../auth/AuthContext';

/** Indicador visible del estado de la conexion de eventos. */
export function StreamIndicator(): React.JSX.Element {
  const [status, setStatus] = useState<StreamStatus>(eventStream.getStatus());
  useEffect(() => eventStream.subscribeStatus(setStatus), []);

  const label: Record<StreamStatus, string> = {
    idle: 'eventos: en espera',
    connecting: 'eventos: conectando',
    open: 'eventos: en vivo',
    retrying: 'eventos: reconectando',
    stopped: 'eventos: detenidos',
  };
  const color: Record<StreamStatus, string> = {
    idle: 'bg-lumon-dim',
    connecting: 'bg-lumon-ma',
    open: 'bg-lumon-wo',
    retrying: 'bg-lumon-ma',
    stopped: 'bg-lumon-dr',
  };

  return (
    <span className="flex items-center gap-1.5" title={label[status]}>
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${color[status]}`} />
      <span className="sr-only" role="status">
        {label[status]}
      </span>
      <span className="hidden lg:inline">{label[status]}</span>
    </span>
  );
}

interface Contingency {
  id: string;
  message: string;
}

function readContingency(event: LumonEvent): Contingency | null {
  const id = event.data['id'];
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  const message = event.data['message'];
  return {
    id: String(id),
    message:
      typeof message === 'string' && message !== ''
        ? message
        : 'Lumon activo una contingencia de horas extra para tu cuenta.',
  };
}

/**
 * Modal de contingencia: interrumpe en TODAS las pestanas (el evento llega a
 * todas por el BroadcastChannel del stream), atrapa el foco, se anuncia a
 * lectores de pantalla y solo se cierra al confirmar con
 * POST /contingency/{id}/ack. Si la confirmacion falla, sigue abierto.
 */
function ContingencyModal({
  contingency,
  onResolved,
}: {
  contingency: Contingency;
  onResolved: () => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const previouslyFocused = document.activeElement;
    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  // Foco atrapado: Tab y Shift+Tab giran dentro del modal. Escape no cierra.
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusables === undefined || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (first === undefined || last === undefined) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  async function confirm(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiFetch<void>(`/contingency/${contingency.id}/ack`, { method: 'POST', retries: 1 });
      onResolved();
    } catch (e) {
      setError(humanMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onKeyDown={onKeyDown}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cont-title"
        aria-describedby="cont-desc"
        className="lumon-panel w-full max-w-md p-6"
      >
        <h2 id="cont-title" className="text-lg text-lumon-ma">
          Contingencia de horas extra
        </h2>
        <p id="cont-desc" className="mt-3 text-sm text-lumon-text">
          {contingency.message}
        </p>
        {error !== null ? (
          <p role="alert" className="mt-3 text-sm text-lumon-dr">
            No se pudo confirmar: {error}
          </p>
        ) : null}
        <button
          ref={confirmRef}
          type="button"
          onClick={() => void confirm()}
          disabled={busy}
          className="lumon-btn mt-6 w-full"
        >
          {busy ? 'Confirmando…' : 'Confirmar contingencia'}
        </button>
      </div>
    </div>
  );
}

/** Arranca el stream mientras haya sesion y reparte los eventos globales. */
export function RealtimeHost(): React.JSX.Element | null {
  const { state } = useAuth();
  const [contingency, setContingency] = useState<Contingency | null>(null);

  const onEvent = useCallback((event: LumonEvent): void => {
    if (event.type === 'session.revoked') {
      killSession('Lumon revoco tu sesion. Vuelve a entrar.');
      return;
    }
    if (event.type === 'contingency.activated') {
      const c = readContingency(event);
      if (c !== null) setContingency(c);
      return;
    }
    if (event.type === 'contingency.resolved') {
      setContingency(null);
    }
  }, []);

  useEffect(() => {
    if (state.status !== 'authenticated') return undefined;
    const off = eventStream.subscribe(onEvent);
    eventStream.start();
    return () => {
      off();
      eventStream.stop();
    };
  }, [state.status, onEvent]);

  if (contingency === null) return null;
  return <ContingencyModal contingency={contingency} onResolved={() => setContingency(null)} />;
}
