import type { Bin, Cell, Rules } from '../../lib/types';
import { BIN_FROM_CHAR } from '../../lib/types';

export interface DecodedTile {
  tileRow: number;
  tileCol: number;
  originRow: number;
  originCol: number;
  rows: number;
  cols: number;
  values: string;
  tremor: Uint8Array;
  bins: string;
  version: number;
}

/** `tremor` llega en base64, un byte por celda (0 a 100). */
export function decodeTremor(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export interface CellInfo {
  digit: number;
  tremor: number;
  bin: Bin | null;
}

export function cellFromTile(tile: DecodedTile, r: number, c: number): CellInfo | null {
  const lr = r - tile.originRow;
  const lc = c - tile.originCol;
  if (lr < 0 || lc < 0 || lr >= tile.rows || lc >= tile.cols) return null;
  const idx = lr * tile.cols + lc;
  const digit = tile.values.charCodeAt(idx) - 48;
  const tremor = tile.tremor[idx] ?? 0;
  const binChar = tile.bins.charAt(idx);
  return {
    digit: Number.isFinite(digit) ? digit : 0,
    tremor,
    bin: BIN_FROM_CHAR[binChar] ?? null,
  };
}

export function isScary(tremor: number, rules: Rules): boolean {
  return tremor >= rules.tremorThreshold;
}

const OFFSETS_4: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const OFFSETS_8: ReadonlyArray<readonly [number, number]> = [
  ...OFFSETS_4,
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

export function neighborOffsets(rules: Rules): ReadonlyArray<readonly [number, number]> {
  return rules.connectivity === 8 ? OFFSETS_8 : OFFSETS_4;
}

/** La caja correcta sale de las reglas DEL ARCHIVO, nunca de valores fijos. */
export function binForGroup(digits: readonly number[], rules: Rules): Bin {
  let index: number;
  if (rules.binning.strategy === 'DIGIT_SUM_MOD') {
    let sum = 0;
    for (const d of digits) sum += d;
    index = sum % 4;
  } else {
    let max = 0;
    for (const d of digits) if (d > max) max = d;
    index = max % 4;
  }
  const bin = rules.binning.order[index];
  if (bin === undefined) {
    throw new Error(`binning.order invalido: falta el indice ${index}`);
  }
  return bin;
}

export type NoiseReason = 'TOO_SMALL' | 'TOO_LARGE';

export interface GroupResult {
  cells: Cell[];
  size: number;
  bin: Bin | null;
  noise: NoiseReason | null;
  /** Alguna celda del grupo ya estaba refinada. */
  alreadyRefined: boolean;
}

export interface CellSource {
  rows: number;
  cols: number;
  /** Lee del cache; null si el bloque todavia no esta cargado. */
  peek: (r: number, c: number) => CellInfo | null;
  /** Carga el bloque que contiene esa celda (pinned: no se cancela por scroll). */
  load: (r: number, c: number, signal: AbortSignal) => Promise<void>;
}

/**
 * Componente conexo MAXIMO de celdas que dan miedo que contiene `start`.
 * Pide los bloques que falten, incluso si el grupo cruza varios.
 * Si el grupo supera maxGroupSize se corta temprano: ya es ruido.
 */
export async function findGroup(
  start: Cell,
  rules: Rules,
  src: CellSource,
  signal: AbortSignal,
): Promise<GroupResult | null> {
  const offsets = neighborOffsets(rules);
  const visited = new Set<number>();
  const cells: Cell[] = [];
  const digits: number[] = [];
  const queue: Cell[] = [start];
  let alreadyRefined = false;
  let exceeded = false;

  while (queue.length > 0) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const cell = queue.pop();
    if (cell === undefined) break;
    const { r, c } = cell;
    if (r < 0 || c < 0 || r >= src.rows || c >= src.cols) continue;
    const key = r * src.cols + c;
    if (visited.has(key)) continue;

    let info = src.peek(r, c);
    if (info === null) {
      await src.load(r, c, signal);
      info = src.peek(r, c);
      if (info === null) return null; // no se pudo cargar el bloque
    }

    visited.add(key);
    if (!isScary(info.tremor, rules)) continue;

    cells.push({ r, c });
    digits.push(info.digit);
    if (info.bin !== null) alreadyRefined = true;

    if (cells.length > rules.maxGroupSize) {
      exceeded = true;
      break;
    }

    for (const [dr, dc] of offsets) {
      queue.push({ r: r + dr, c: c + dc });
    }
  }

  if (cells.length === 0) return null;

  if (exceeded) {
    return { cells, size: cells.length, bin: null, noise: 'TOO_LARGE', alreadyRefined };
  }
  if (cells.length < rules.minGroupSize) {
    return { cells, size: cells.length, bin: null, noise: 'TOO_SMALL', alreadyRefined };
  }

  return {
    cells,
    size: cells.length,
    bin: binForGroup(digits, rules),
    noise: null,
    alreadyRefined,
  };
}

export function cellKey(r: number, c: number, cols: number): number {
  return r * cols + c;
}
