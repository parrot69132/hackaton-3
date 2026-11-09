import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { getFile, getRules, refineGroup } from '../../lib/api';
import { ApiError, humanMessage, isAbort } from '../../lib/errors';
import { BINS, type Bin, type Cell, type DataFile, type Progress, type Rules } from '../../lib/types';
import { useAuth } from '../../auth/AuthContext';
import { Spinner } from '../../shell/Spinner';
import { GridView, type GridViewHandle } from './GridView';
import { TileStore } from './tileStore';
import { findGroup, type GroupResult } from './grid';

const BIN_NAME: Record<Bin, string> = {
  WO: 'WO · Woe',
  FC: 'FC · Frolic',
  DR: 'DR · Dread',
  MA: 'MA · Malice',
};

const BIN_BOX_CLASS: Record<Bin, string> = {
  WO: 'border-lumon-wo text-lumon-wo',
  FC: 'border-lumon-fc text-lumon-fc',
  DR: 'border-lumon-dr text-lumon-dr',
  MA: 'border-lumon-ma text-lumon-ma',
};

function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function intentionId(bin: Bin, cells: readonly Cell[]): string {
  const sorted = cells.map((c) => `${c.r},${c.c}`).sort();
  return `${bin}|${sorted.join(';')}`;
}

function detailReason(e: unknown): string | null {
  if (!(e instanceof ApiError) || typeof e.details !== 'object' || e.details === null) return null;
  const reason = (e.details as Record<string, unknown>)['reason'];
  return typeof reason === 'string' ? reason : null;
}

function parseCoord(raw: string | null, max: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return 0;
  return Math.min(n, Math.max(0, max - 1));
}

interface Notice {
  kind: 'info' | 'error' | 'ok';
  text: string;
}

export function RefinePage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const fileId = Number(id);
  const { can } = useAuth();
  const canRefine = can('files:refine');

  const [params, setParams] = useSearchParams();
  const [file, setFile] = useState<DataFile | null>(null);
  const [rules, setRules] = useState<Rules | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [storeVersion, setStoreVersion] = useState(0);
  const storeRef = useRef<TileStore | null>(null);

  const [selection, setSelection] = useState<GroupResult | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [refining, setRefining] = useState(false);

  const [focus, setFocus] = useState<Cell>({ r: 0, c: 0 });
  const [focusRequest, setFocusRequest] = useState(0);
  const gridRef = useRef<GridViewHandle | null>(null);

  const findAbort = useRef<AbortController | null>(null);
  const refineLock = useRef(false);
  const idempotencyKeys = useRef(new Map<string, string>());
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);

  // --- Carga del archivo y de SUS reglas (nunca valores fijos) ---
  useEffect(() => {
    if (!Number.isInteger(fileId) || fileId < 1) {
      setLoadError('El identificador del archivo no es valido.');
      return undefined;
    }
    const ctrl = new AbortController();
    setLoadError(null);
    void (async () => {
      try {
        const [loadedFile, loadedRules] = await Promise.all([
          getFile(fileId, ctrl.signal),
          getRules(fileId, ctrl.signal),
        ]);
        if (ctrl.signal.aborted) return;
        setFile(loadedFile);
        setRules(loadedRules);
        setProgress(loadedFile.progress);
      } catch (e) {
        if (isAbort(e)) return;
        setLoadError(humanMessage(e));
      }
    })();
    return () => ctrl.abort();
  }, [fileId, reloadToken]);

  // --- Store de bloques, uno por archivo ---
  useEffect(() => {
    if (file === null) return undefined;
    const store = new TileStore(file.id, file.tileSize, file.rows, file.cols, () => {
      setStoreVersion((v) => v + 1);
    });
    storeRef.current = store;
    setStoreVersion((v) => v + 1);
    return () => {
      store.dispose();
      storeRef.current = null;
    };
  }, [file]);

  // Posicion inicial desde la URL (?r=&c=): abrirla lleva directo ahi.
  const appliedInitial = useRef(false);
  useEffect(() => {
    if (file === null || appliedInitial.current) return;
    appliedInitial.current = true;
    const r = parseCoord(params.get('r'), file.rows);
    const c = parseCoord(params.get('c'), file.cols);
    setFocus({ r, c });
    if (r !== 0 || c !== 0) {
      window.requestAnimationFrame(() => gridRef.current?.scrollToCell(r, c));
    }
  }, [file, params]);

  /** El scroll actualiza la URL sin apilar historial. */
  const onPosition = useCallback(
    (r: number, c: number): void => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (r === 0) next.delete('r');
          else next.set('r', String(r));
          if (c === 0) next.delete('c');
          else next.set('c', String(c));
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const selectedKeys = useMemo(() => {
    const set = new Set<number>();
    if (selection !== null && file !== null) {
      for (const cell of selection.cells) set.add(cell.r * file.cols + cell.c);
    }
    return set;
  }, [selection, file]);

  /** Al elegir una celda que da miedo se selecciona el GRUPO COMPLETO. */
  const activate = useCallback(
    (cell: Cell): void => {
      const store = storeRef.current;
      if (store === null || rules === null) return;

      findAbort.current?.abort();
      const ctrl = new AbortController();
      findAbort.current = ctrl;
      setSelecting(true);
      setNotice(null);

      void (async () => {
        try {
          const group = await findGroup(
            cell,
            rules,
            { rows: store.rows, cols: store.cols, peek: store.peek, load: store.load },
            ctrl.signal,
          );
          if (ctrl.signal.aborted) return;
          if (group === null) {
            setSelection(null);
            setNotice({ kind: 'info', text: 'Esa celda no da miedo: no forma ningun grupo.' });
            return;
          }
          setSelection(group);
          if (group.noise === 'TOO_SMALL') {
            setNotice({
              kind: 'info',
              text: `Grupo de ${group.size} celdas: es ruido (el minimo es ${rules.minGroupSize}). No se puede refinar.`,
            });
          } else if (group.noise === 'TOO_LARGE') {
            setNotice({
              kind: 'info',
              text: `El grupo pasa de ${rules.maxGroupSize} celdas: es ruido. No se puede refinar.`,
            });
          } else if (group.alreadyRefined) {
            setNotice({
              kind: 'info',
              text: 'Este grupo ya tiene celdas refinadas.',
            });
          }
        } catch (e) {
          if (isAbort(e)) return;
          setNotice({ kind: 'error', text: humanMessage(e) });
        } finally {
          if (!ctrl.signal.aborted) setSelecting(false);
        }
      })();
    },
    [rules],
  );

  /**
   * Llevar el grupo a una caja. La Idempotency-Key se reutiliza para la MISMA
   * intencion: doble clic, doble Enter o un reintento por red nunca refinan
   * dos veces ni cuentan dos errores.
   */
  const sendToBin = useCallback(
    (bin: Bin): void => {
      const store = storeRef.current;
      const current = selection;
      if (store === null || current === null || file === null) return;
      if (!canRefine) {
        setNotice({ kind: 'error', text: 'Tu cuenta no tiene el permiso files:refine.' });
        return;
      }
      if (current.noise !== null) {
        setNotice({ kind: 'info', text: 'Un grupo que es ruido no se puede refinar.' });
        return;
      }
      if (refineLock.current) return;
      refineLock.current = true;
      setRefining(true);
      setNotice(null);

      const intention = intentionId(bin, current.cells);
      let key = idempotencyKeys.current.get(intention);
      if (key === undefined) {
        key = newIdempotencyKey();
        idempotencyKeys.current.set(intention, key);
      }

      void (async () => {
        try {
          const outcome = await refineGroup(file.id, bin, current.cells, key);
          // Las celdas se marcan sin volver a pedir la grilla.
          store.applyRefinement(current.cells, bin);
          setProgress(outcome.result.file.progress);
          setFile((prev) =>
            prev === null
              ? prev
              : {
                  ...prev,
                  progress: outcome.result.file.progress,
                  refinedGroups: outcome.result.file.refinedGroups,
                  totalGroups: outcome.result.file.totalGroups,
                  mistakes: outcome.result.file.mistakes,
                  status: outcome.result.file.status,
                },
          );
          setSelection(null);
          idempotencyKeys.current.delete(intention);
          setNotice({
            kind: 'ok',
            text: outcome.replayed
              ? `Ya estaba refinado en ${bin}: Lumon devolvio la misma respuesta sin refinar de nuevo.`
              : `Grupo de ${outcome.result.size} celdas enviado a ${bin}.`,
          });
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            // Alguien refino antes: los bloques afectados se vuelven a pedir.
            store.invalidateForCells(current.cells);
            setSelection(null);
            idempotencyKeys.current.delete(intention);
            setNotice({
              kind: 'error',
              text: 'Alguna celda ya estaba refinada. Recargue los bloques; vuelve a elegir el grupo.',
            });
          } else if (e instanceof ApiError && e.status === 422) {
            const reason = detailReason(e);
            if (e.code === 'WRONG_BIN') {
              setNotice({
                kind: 'error',
                text: `Caja equivocada: ${bin} no corresponde a este grupo. Lumon anoto el error.`,
              });
              // mistakes cambio en el servidor: se vuelve a leer el archivo.
              setReloadToken((t) => t + 1);
            } else {
              setNotice({
                kind: 'error',
                text: `Lumon rechazo el grupo${reason !== null ? `: ${reason}` : ''}. Vuelve a seleccionarlo.`,
              });
            }
            idempotencyKeys.current.delete(intention);
          } else {
            setNotice({ kind: 'error', text: humanMessage(e) });
          }
        } finally {
          refineLock.current = false;
          setRefining(false);
        }
      })();
    },
    [selection, file, canRefine],
  );

  // Teclado: 1-4 llevan el grupo seleccionado a su caja.
  function onWrapperKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (selection === null || selection.noise !== null) return;
    const index = ['1', '2', '3', '4'].indexOf(e.key);
    if (index < 0) return;
    const bin = BINS[index];
    if (bin === undefined) return;
    e.preventDefault();
    sendToBin(bin);
  }

  // --- Arrastre con Pointer Events, sin librerias ---
  const onCellPointerDown = useCallback(
    (cell: Cell, event: React.PointerEvent<HTMLDivElement>): void => {
      if (file === null || selection === null || selection.noise !== null) return;
      if (!selectedKeys.has(cell.r * file.cols + cell.c)) return;
      event.preventDefault();
      setDrag({ x: event.clientX, y: event.clientY });
    },
    [file, selection, selectedKeys],
  );

  useEffect(() => {
    if (drag === null) return undefined;
    const move = (e: PointerEvent): void => setDrag({ x: e.clientX, y: e.clientY });
    const up = (e: PointerEvent): void => {
      setDrag(null);
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const box = target?.closest<HTMLElement>('[data-bin]');
      const bin = box?.dataset['bin'];
      if (bin === 'WO' || bin === 'FC' || bin === 'DR' || bin === 'MA') sendToBin(bin);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', () => setDrag(null), { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, sendToBin]);

  // --- Render ---
  if (loadError !== null) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-xl text-lumon-dr">No se pudo abrir el archivo</h1>
        <p className="mt-3 text-sm text-lumon-dim">{loadError}</p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            className="lumon-btn"
            onClick={() => setReloadToken((t) => t + 1)}
          >
            Reintentar
          </button>
          <Link to="/files" className="lumon-btn-ghost">
            Volver
          </Link>
        </div>
      </main>
    );
  }

  if (file === null || rules === null || storeRef.current === null) {
    return <Spinner label="Abriendo el archivo…" />;
  }

  const store = storeRef.current;
  const shownProgress = progress ?? file.progress;
  const complete = file.status === 'COMPLETE' || shownProgress.overall >= 1;

  if (complete) {
    return (
      <main className="mx-auto max-w-xl px-4 py-20 text-center">
        <p className="text-sm uppercase tracking-widest text-lumon-dim">Archivo completado</p>
        <h1 className="mt-3 text-3xl text-lumon-wo">{file.name} al 100 %</h1>
        <p className="mt-4 text-lumon-dim">
          {file.refinedGroups} de {file.totalGroups} grupos refinados · {file.mistakes} errores
          anotados.
        </p>
        <p className="mt-6 text-sm text-lumon-dim">El trabajo es misterioso e importante.</p>
        <Link to="/files" className="lumon-btn mt-8 inline-block">
          Volver a los archivos
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-5" onKeyDown={onWrapperKeyDown}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl text-lumon-cyan">{file.name}</h1>
          <p className="mt-1 text-xs text-lumon-dim">
            {file.rows} × {file.cols} · bloques de {file.tileSize} · umbral {rules.tremorThreshold}{' '}
            · conectividad {rules.connectivity} · {rules.binning.strategy} ·{' '}
            {rules.binning.order.join(' ')} · grupos de {rules.minGroupSize} a {rules.maxGroupSize}
          </p>
        </div>
        <Link to="/files" className="lumon-btn-ghost">
          Volver
        </Link>
      </div>

      {/* Cajas: destino del arrastre y del teclado, con su avance */}
      <section aria-label="Cajas" className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {BINS.map((bin, index) => {
          const suggested = selection?.bin === bin && selection.noise === null;
          return (
            <button
              key={bin}
              type="button"
              data-bin={bin}
              disabled={selection === null || selection.noise !== null || refining}
              onClick={() => sendToBin(bin)}
              className={`lumon-panel border p-3 text-left transition-colors ${BIN_BOX_CLASS[bin]} ${
                suggested ? 'ring-2 ring-lumon-cyan' : ''
              } disabled:opacity-50`}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-sm">{BIN_NAME[bin]}</span>
                <span className="text-xs text-lumon-dim">
                  {index + 1} · {Math.round(shownProgress[bin] * 100)}%
                </span>
              </div>
              <div
                className="mt-2 h-1.5 w-full overflow-hidden rounded bg-lumon-bg"
                role="progressbar"
                aria-valuenow={Math.round(shownProgress[bin] * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Avance de ${bin}`}
              >
                <div className="h-full bg-current" style={{ width: `${shownProgress[bin] * 100}%` }} />
              </div>
              {suggested ? (
                <p className="mt-2 text-xs">Caja que corresponde a este grupo</p>
              ) : null}
            </button>
          );
        })}
      </section>

      {/* Estado de la seleccion */}
      <div
        aria-live="polite"
        className="lumon-panel mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm"
      >
        <span className="text-lumon-dim">
          Avance total: <span className="text-lumon-text">{Math.round(shownProgress.overall * 100)}%</span>
        </span>
        <span className="text-lumon-dim">
          Grupos: <span className="text-lumon-text">{file.refinedGroups}/{file.totalGroups}</span>
        </span>
        <span className="text-lumon-dim">
          Errores: <span className="text-lumon-text">{file.mistakes}</span>
        </span>
        <span className="text-lumon-dim">
          Bloques en cache: <span className="text-lumon-text">{store.loadedTiles}</span>
        </span>
        {selecting ? <span className="text-lumon-cyan">Buscando el grupo…</span> : null}
        {selection !== null ? (
          <span className="text-lumon-cyan">
            Grupo de {selection.size} celdas ·{' '}
            {selection.noise !== null
              ? 'ruido, no se refina'
              : `caja ${selection.bin ?? '?'} (arrastra o pulsa 1-4)`}
          </span>
        ) : null}
        {refining ? <span className="text-lumon-cyan">Enviando…</span> : null}
      </div>

      {notice !== null ? (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`mt-3 rounded border px-3 py-2 text-sm ${
            notice.kind === 'error'
              ? 'border-lumon-dr text-lumon-dr'
              : notice.kind === 'ok'
                ? 'border-lumon-wo text-lumon-wo'
                : 'border-lumon-line text-lumon-dim'
          }`}
        >
          {notice.text}
        </p>
      ) : null}

      <div className="mt-3">
        <GridView
          store={store}
          rules={rules}
          storeVersion={storeVersion}
          selected={selectedKeys}
          selectedBin={selection?.bin ?? null}
          focus={focus}
          focusRequest={focusRequest}
          onFocusChange={(cell) => {
            setFocus(cell);
            setFocusRequest((n) => n + 1);
          }}
          onActivate={activate}
          onPosition={onPosition}
          onCellPointerDown={onCellPointerDown}
          handleRef={gridRef}
        />
      </div>

      <p className="mt-2 text-xs text-lumon-dim">
        Celda enfocada: fila {focus.r + 1}, columna {focus.c + 1}. Enter selecciona el grupo; 1-4 lo
        lleva a WO, FC, DR o MA; tambien puedes arrastrarlo a una caja.
      </p>

      {drag !== null && selection !== null ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-50 rounded border border-lumon-cyan bg-lumon-panel px-2 py-1 text-xs text-lumon-cyan"
          style={{ left: drag.x + 12, top: drag.y + 12 }}
        >
          {selection.size} celdas → suelta en una caja
        </div>
      ) : null}
    </main>
  );
}
