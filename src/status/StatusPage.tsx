import { useCallback, useEffect, useState } from 'react';
import {
  getClearance,
  getHealth,
  getIntegrationStatus,
  requestDeployChallenge,
  runClearanceCheck,
  setChaos,
  verifyDeploy,
} from '../lib/api';
import { ApiError, humanMessage, isAbort } from '../lib/errors';
import { BUILD_SHA, STORAGE } from '../lib/env';
import { useAuth } from '../auth/AuthContext';
import type { Check, Clearance, IntegrationStatus } from '../lib/types';

function Dot({ ok }: { ok: boolean }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? 'bg-lumon-wo' : 'bg-lumon-dr'}`}
    />
  );
}

function CheckList({ checks }: { checks: readonly Check[] }): React.JSX.Element {
  if (checks.length === 0) {
    return <p className="text-sm text-lumon-dim">Sin comprobaciones todavia.</p>;
  }
  return (
    <ul className="space-y-1 text-sm">
      {checks.map((c) => (
        <li key={c.key} className="flex items-start gap-2">
          <span className="mt-1.5">
            <Dot ok={c.passed} />
          </span>
          <span>
            <span className={c.passed ? 'text-lumon-wo' : 'text-lumon-dr'}>{c.label}</span>
            {c.reason !== null && c.reason !== '' ? (
              <span className="text-lumon-dim"> — {c.reason}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function StatusPage(): React.JSX.Element {
  const { me } = useAuth();
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null);
  const [clearance, setClearance] = useState<Clearance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);

  const origin = window.location.origin;
  const isLocal = origin.includes('localhost') || origin.includes('127.0.0.1');

  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setError(null);
    try {
      const [health, status, clear] = await Promise.all([
        getHealth(signal).then(
          () => true,
          () => false,
        ),
        getIntegrationStatus(signal),
        getClearance(signal),
      ]);
      if (signal?.aborted === true) return;
      setApiOk(health);
      setIntegrations(status);
      setClearance(clear);
    } catch (e) {
      if (isAbort(e)) return;
      setError(humanMessage(e));
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  async function withBusy(label: string, fn: () => Promise<string>): Promise<void> {
    setBusy(true);
    setMessage(`${label}…`);
    try {
      setMessage(await fn());
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CHECK_FROM_APP_REQUIRED') {
        setMessage(
          'La revision automatica solo corre desde la app desplegada, no desde localhost ni Swagger.',
        );
      } else {
        setMessage(humanMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl text-lumon-cyan">Estado del piso</h1>
      <p className="mt-1 text-sm text-lumon-dim">
        Build desplegado, API, integraciones y clearance.
      </p>

      {error !== null ? (
        <p role="alert" className="mt-4 rounded border border-lumon-dr px-3 py-2 text-sm text-lumon-dr">
          {error}
        </p>
      ) : null}

      <section className="lumon-panel mt-5 p-4">
        <h2 className="text-lumon-cyan">Despliegue</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-lumon-dim">Build de esta app</dt>
            <dd className="text-lumon-text">
              {BUILD_SHA}{' '}
              {BUILD_SHA === 'dev' ? (
                <span className="text-lumon-dim">(local)</span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-lumon-dim">Origen</dt>
            <dd className="break-all text-lumon-text">{origin}</dd>
          </div>
          <div>
            <dt className="text-lumon-dim">API responde</dt>
            <dd>
              {apiOk === null ? (
                <span className="text-lumon-dim">comprobando…</span>
              ) : (
                <>
                  <Dot ok={apiOk} />{' '}
                  <span className={apiOk ? 'text-lumon-wo' : 'text-lumon-dr'}>
                    {apiOk ? 'si' : 'no'}
                  </span>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-lumon-dim">Cuadrilla</dt>
            <dd className="text-lumon-text">
              {me !== null ? `${me.team.code} · ${me.team.name}` : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-lumon-dim">Origen verificado</dt>
            <dd className="break-all">
              {integrations === null ? (
                <span className="text-lumon-dim">—</span>
              ) : integrations.deploy.verifiedAt !== null ? (
                <>
                  <Dot ok /> <span className="text-lumon-wo">{integrations.deploy.origin}</span>
                </>
              ) : (
                <>
                  <Dot ok={false} /> <span className="text-lumon-dr">sin verificar</span>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-lumon-dim">Ultimo build visto por Lumon</dt>
            <dd className="text-lumon-text">{integrations?.deploy.lastBuildSeen ?? '—'}</dd>
          </div>
        </dl>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            className="lumon-btn-ghost"
            onClick={() =>
              void withBusy('Pidiendo el token', async () => {
                const ch = await requestDeployChallenge(origin);
                setChallengeToken(ch.token);
                return `Publica este token en ${ch.wellKnownPath} y luego pulsa Verificar.`;
              })
            }
          >
            1 · Pedir token del dominio
          </button>
          <button
            type="button"
            disabled={busy}
            className="lumon-btn-ghost"
            onClick={() =>
              void withBusy('Verificando el dominio', async () => {
                await verifyDeploy();
                return 'Dominio verificado: tu origen ya esta en la lista de CORS.';
              })
            }
          >
            2 · Verificar dominio
          </button>
        </div>

        {challengeToken !== null ? (
          <div className="mt-3 rounded border border-lumon-line bg-lumon-bg p-3">
            <p className="text-xs text-lumon-dim">
              Contenido exacto de <code>public/.well-known/lumon-verification.txt</code> (texto
              plano, sin nada mas):
            </p>
            <code className="mt-1 block break-all text-sm text-lumon-cyan">{challengeToken}</code>
          </div>
        ) : null}
      </section>

      <section className="lumon-panel mt-4 p-4">
        <h2 className="text-lumon-cyan">Storage de imagenes</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-lumon-dim">Proveedor configurado en la app</dt>
            <dd className="text-lumon-text">{STORAGE.provider ?? 'sin configurar'}</dd>
          </div>
          <div>
            <dt className="text-lumon-dim">Verificado por Lumon</dt>
            <dd>
              {integrations === null ? (
                <span className="text-lumon-dim">—</span>
              ) : integrations.storage.verifiedAt !== null ? (
                <>
                  <Dot ok /> <span className="text-lumon-wo">{integrations.storage.provider}</span>
                </>
              ) : (
                <>
                  <Dot ok={false} /> <span className="text-lumon-dr">sin verificar</span>
                </>
              )}
            </dd>
          </div>
        </dl>
        <div className="mt-3">
          <CheckList checks={integrations?.storage.checks ?? []} />
        </div>
      </section>

      <section className="lumon-panel mt-4 p-4">
        <h2 className="text-lumon-cyan">Piso de Pruebas</h2>
        <p className="mt-2 text-sm">
          {clearance === null ? (
            <span className="text-lumon-dim">—</span>
          ) : clearance.granted ? (
            <>
              <Dot ok /> <span className="text-lumon-wo">Abierto</span>
            </>
          ) : (
            <>
              <Dot ok={false} /> <span className="text-lumon-dr">Cerrado</span>
            </>
          )}
        </p>

        {clearance !== null ? (
          <p className="mt-2 text-xs text-lumon-dim">
            Workspace {clearance.workspace.kind} · caos nivel {clearance.workspace.chaosLevel} ·
            roster {clearance.roster.members.length}/3
            {clearance.roster.complete ? ' (completo)' : ' (incompleto)'}
            {clearance.roster.locked ? ' · bloqueado' : ''}
          </p>
        ) : null}

        <div className="mt-3">
          <CheckList checks={clearance?.checks ?? []} />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || isLocal}
            className="lumon-btn"
            onClick={() =>
              void withBusy('Corriendo la revision', async () => {
                const result = await runClearanceCheck();
                const failed = result.checks.filter((c) => !c.passed);
                return result.granted
                  ? 'Revision aprobada: el Piso de Pruebas quedo abierto.'
                  : `Faltan ${failed.length} comprobaciones. Revisa el detalle de abajo.`;
              })
            }
          >
            Abrir el Piso de Pruebas
          </button>
          {isLocal ? (
            <span className="text-xs text-lumon-dim">
              Desde localhost responde 403: corre esto en la app desplegada.
            </span>
          ) : null}
        </div>
      </section>

      <section className="lumon-panel mt-4 p-4">
        <h2 className="text-lumon-cyan">Modo caos</h2>
        <p className="mt-1 text-xs text-lumon-dim">
          La evaluacion corre con nivel 1 como minimo. La revision automatica pide refinar 3 grupos
          con caos 1 o 2 activado.
        </p>
        <div className="mt-3 flex gap-2">
          {([0, 1, 2] as const).map((level) => (
            <button
              key={level}
              type="button"
              disabled={busy}
              className={
                clearance?.workspace.chaosLevel === level ? 'lumon-btn' : 'lumon-btn-ghost'
              }
              onClick={() =>
                void withBusy(`Activando caos ${level}`, async () => {
                  await setChaos(level);
                  return `Caos en nivel ${level}.`;
                })
              }
            >
              Nivel {level}
            </button>
          ))}
        </div>
      </section>

      {message !== null ? (
        <p role="status" className="mt-4 rounded border border-lumon-line px-3 py-2 text-sm text-lumon-text">
          {message}
        </p>
      ) : null}

      <button type="button" className="lumon-btn-ghost mt-4" onClick={() => void load()}>
        Actualizar estado
      </button>
    </main>
  );
}
