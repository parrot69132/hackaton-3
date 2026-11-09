import { getTile } from '../../lib/api';
import { backoffDelay, sleep } from '../../lib/backoff';
import { ApiError, NetworkError, isAbort } from '../../lib/errors';
import type { Bin, Cell } from '../../lib/types';
import { decodeTremor, type CellInfo, type DecodedTile, cellFromTile } from './grid';

const BIN_CHAR: Record<Bin, string> = { WO: 'W', FC: 'F', DR: 'D', MA: 'M' };

interface Inflight {
  promise: Promise<DecodedTile>;
  controller: AbortController;
  /** Pedido por la busqueda de grupo: no se cancela al salir de la vista. */
  pinned: boolean;
}

export type TileState = 'missing' | 'loading' | 'ready' | 'error';

/**
 * Cache de bloques del archivo.
 *  - Nunca hay dos requests en vuelo para el mismo bloque.
 *  - Los bloques que salen de la vista se cancelan antes de responder.
 *  - Respeta 429 (no pide NADA hasta que pase Retry-After) y reintenta 503
 *    con espera creciente.
 *  - La grilla nunca se descarga entera: solo los bloques que hacen falta.
 */
export class TileStore {
  private readonly cache = new Map<string, DecodedTile>();
  private readonly inflight = new Map<string, Inflight>();
  private readonly failed = new Map<string, string>();
  /** Puerta global del 429: hasta este instante no se pide nada. */
  private gateUntil = 0;

  constructor(
    private readonly fileId: number,
    readonly tileSize: number,
    readonly rows: number,
    readonly cols: number,
    private readonly onChange: () => void,
  ) {}

  static key(tileRow: number, tileCol: number): string {
    return `${tileRow}:${tileCol}`;
  }

  tileRowOf(r: number): number {
    return Math.floor(r / this.tileSize);
  }
  tileColOf(c: number): number {
    return Math.floor(c / this.tileSize);
  }
  get tileRows(): number {
    return Math.ceil(this.rows / this.tileSize);
  }
  get tileCols(): number {
    return Math.ceil(this.cols / this.tileSize);
  }

  stateOf(tileRow: number, tileCol: number): TileState {
    const k = TileStore.key(tileRow, tileCol);
    if (this.cache.has(k)) return 'ready';
    if (this.inflight.has(k)) return 'loading';
    if (this.failed.has(k)) return 'error';
    return 'missing';
  }

  errorOf(tileRow: number, tileCol: number): string | null {
    return this.failed.get(TileStore.key(tileRow, tileCol)) ?? null;
  }

  /** Lee una celda del cache. null si su bloque aun no llego. */
  peek = (r: number, c: number): CellInfo | null => {
    const tile = this.cache.get(TileStore.key(this.tileRowOf(r), this.tileColOf(c)));
    if (tile === undefined) return null;
    return cellFromTile(tile, r, c);
  };

  /** Pide un bloque (si no esta ya pedido o en cache). */
  ensure(tileRow: number, tileCol: number, pinned = false): Promise<DecodedTile> {
    const k = TileStore.key(tileRow, tileCol);
    const cached = this.cache.get(k);
    if (cached !== undefined) return Promise.resolve(cached);

    const existing = this.inflight.get(k);
    if (existing !== undefined) {
      // Nunca una segunda request para el mismo bloque: se reutiliza la promesa.
      if (pinned) existing.pinned = true;
      return existing.promise;
    }

    const controller = new AbortController();
    const entry: Inflight = {
      controller,
      pinned,
      promise: this.fetchWithPolicy(tileRow, tileCol, controller.signal)
        .then((tile) => {
          this.cache.set(k, tile);
          this.failed.delete(k);
          this.inflight.delete(k);
          this.onChange();
          return tile;
        })
        .catch((e: unknown) => {
          this.inflight.delete(k);
          if (!isAbort(e)) {
            this.failed.set(k, e instanceof Error ? e.message : 'Error al pedir el bloque');
            this.onChange();
          }
          throw e;
        }),
    };
    this.inflight.set(k, entry);
    this.failed.delete(k);
    this.onChange();
    return entry.promise;
  }

  /** Carga el bloque de una celda; usado por la busqueda de grupo (pinned). */
  load = async (r: number, c: number, signal: AbortSignal): Promise<void> => {
    const promise = this.ensure(this.tileRowOf(r), this.tileColOf(c), true);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    await promise;
  };

  private async fetchWithPolicy(
    tileRow: number,
    tileCol: number,
    signal: AbortSignal,
  ): Promise<DecodedTile> {
    for (let attempt = 0; ; attempt += 1) {
      const wait = this.gateUntil - Date.now();
      if (wait > 0) await sleep(wait, signal);

      try {
        const raw = await getTile(this.fileId, tileRow, tileCol, signal);
        return {
          tileRow: raw.tileRow,
          tileCol: raw.tileCol,
          originRow: raw.originRow,
          originCol: raw.originCol,
          rows: raw.rows,
          cols: raw.cols,
          values: raw.values,
          tremor: decodeTremor(raw.tremor),
          bins: raw.bins,
          version: raw.version,
        };
      } catch (e) {
        if (isAbort(e)) throw e;

        if (e instanceof ApiError && e.status === 429) {
          // Puerta global: ningun bloque se pide hasta que pase Retry-After.
          this.gateUntil = Date.now() + (e.retryAfterMs ?? 1_000);
          if (attempt < 6) continue;
          throw e;
        }
        if (e instanceof ApiError && e.status === 503) {
          if (attempt < 5) {
            await sleep(e.retryAfterMs ?? backoffDelay(attempt), signal);
            continue;
          }
          throw e;
        }
        if (e instanceof NetworkError && attempt < 3) {
          await sleep(backoffDelay(attempt), signal);
          continue;
        }
        throw e;
      }
    }
  }

  /** Cancela las requests de bloques que ya salieron de la vista. */
  cancelOutside(keepKeys: ReadonlySet<string>): void {
    for (const [k, entry] of this.inflight) {
      if (entry.pinned) continue;
      if (!keepKeys.has(k)) {
        entry.controller.abort();
        this.inflight.delete(k);
      }
    }
  }

  /**
   * Marca localmente las celdas refinadas, sin volver a pedir la grilla.
   */
  applyRefinement(cells: readonly Cell[], bin: Bin): void {
    const char = BIN_CHAR[bin];
    const touched = new Map<string, DecodedTile>();

    for (const { r, c } of cells) {
      const k = TileStore.key(this.tileRowOf(r), this.tileColOf(c));
      const tile = touched.get(k) ?? this.cache.get(k);
      if (tile === undefined) continue;
      const lr = r - tile.originRow;
      const lc = c - tile.originCol;
      if (lr < 0 || lc < 0 || lr >= tile.rows || lc >= tile.cols) continue;
      const idx = lr * tile.cols + lc;
      const next = `${tile.bins.slice(0, idx)}${char}${tile.bins.slice(idx + 1)}`;
      touched.set(k, { ...tile, bins: next });
    }

    for (const [k, tile] of touched) this.cache.set(k, tile);
    if (touched.size > 0) this.onChange();
  }

  /** Ante 409 ALREADY_REFINED los bloques afectados se vuelven a pedir. */
  invalidateForCells(cells: readonly Cell[]): void {
    const keys = new Set<string>();
    for (const { r, c } of cells) {
      keys.add(TileStore.key(this.tileRowOf(r), this.tileColOf(c)));
    }
    for (const k of keys) {
      this.cache.delete(k);
      this.failed.delete(k);
      const inflight = this.inflight.get(k);
      if (inflight !== undefined) {
        inflight.controller.abort();
        this.inflight.delete(k);
      }
    }
    this.onChange();
  }

  retry(tileRow: number, tileCol: number): void {
    this.failed.delete(TileStore.key(tileRow, tileCol));
    void this.ensure(tileRow, tileCol).catch(() => undefined);
  }

  dispose(): void {
    for (const [, entry] of this.inflight) entry.controller.abort();
    this.inflight.clear();
    this.cache.clear();
    this.failed.clear();
  }

  get loadedTiles(): number {
    return this.cache.size;
  }
}
