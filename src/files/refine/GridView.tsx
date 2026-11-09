import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Bin, Cell, Rules } from '../../lib/types';
import { TileStore } from './tileStore';
import { isScary } from './grid';

export const CELL = 24;
/** Tope duro: nunca mas de 2500 celdas en el DOM, sea 64x64 o 512x512. */
export const MAX_DOM_CELLS = 2500;

const BIN_CELL_CLASS: Record<Bin, string> = {
  WO: 'bg-lumon-wo/25 text-lumon-wo',
  FC: 'bg-lumon-fc/25 text-lumon-fc',
  DR: 'bg-lumon-dr/25 text-lumon-dr',
  MA: 'bg-lumon-ma/25 text-lumon-ma',
};

/** Variables CSS que alimentan la animacion de temblor. */
type CellStyle = React.CSSProperties & {
  '--amp'?: string;
  '--dur'?: string;
};

interface Range {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

function computeRange(
  scrollTop: number,
  scrollLeft: number,
  width: number,
  height: number,
  rows: number,
  cols: number,
): Range {
  const firstRow = Math.max(0, Math.floor(scrollTop / CELL));
  const firstCol = Math.max(0, Math.floor(scrollLeft / CELL));
  const visRows = Math.min(rows, Math.ceil(height / CELL) + 1);
  const visCols = Math.min(cols, Math.ceil(width / CELL) + 1);

  let overscan = 2;
  while (overscan > 0 && (visRows + 2 * overscan) * (visCols + 2 * overscan) > MAX_DOM_CELLS) {
    overscan -= 1;
  }

  let rowCount = Math.min(rows, visRows + 2 * overscan);
  let colCount = Math.min(cols, visCols + 2 * overscan);

  // Garantia dura del tope, incluso en pantallas enormes.
  while (rowCount * colCount > MAX_DOM_CELLS) {
    if (rowCount >= colCount) rowCount -= 1;
    else colCount -= 1;
  }

  const startRow = Math.max(0, Math.min(firstRow - overscan, rows - rowCount));
  const startCol = Math.max(0, Math.min(firstCol - overscan, cols - colCount));

  return {
    startRow,
    endRow: Math.min(rows, startRow + rowCount),
    startCol,
    endCol: Math.min(cols, startCol + colCount),
  };
}

export interface GridViewHandle {
  scrollToCell: (r: number, c: number) => void;
}

interface Props {
  store: TileStore;
  rules: Rules;
  /** Cambia cuando el cache de bloques cambia, para re-renderizar. */
  storeVersion: number;
  selected: ReadonlySet<number>;
  selectedBin: Bin | null;
  focus: Cell;
  /** Se incrementa cuando el foco debe moverse al DOM (teclado). */
  focusRequest: number;
  onFocusChange: (cell: Cell) => void;
  onActivate: (cell: Cell) => void;
  onPosition: (r: number, c: number) => void;
  onCellPointerDown: (cell: Cell, event: React.PointerEvent<HTMLDivElement>) => void;
  handleRef: React.MutableRefObject<GridViewHandle | null>;
}

export function GridView({
  store,
  rules,
  storeVersion,
  selected,
  selectedBin,
  focus,
  focusRequest,
  onFocusChange,
  onActivate,
  onPosition,
  onCellPointerDown,
  handleRef,
}: Props): React.JSX.Element {
  const { rows, cols } = store;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const rafRef = useRef<number | null>(null);

  // Tamano del viewport de la grilla.
  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return undefined;
    const update = (): void => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const range = useMemo(
    () => computeRange(scroll.top, scroll.left, size.width, size.height, rows, cols),
    [scroll.top, scroll.left, size.width, size.height, rows, cols],
  );

  const onScroll = useCallback((): void => {
    const el = containerRef.current;
    if (el === null) return;
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const node = containerRef.current;
      if (node === null) return;
      setScroll({ top: node.scrollTop, left: node.scrollLeft });
    });
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // La URL indica la posicion (?r=&c=) sin llenar el historial.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      onPosition(Math.floor(scroll.top / CELL), Math.floor(scroll.left / CELL));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [scroll.top, scroll.left, onPosition]);

  /**
   * Bloques: se piden SOLO los que cubren la vista, y se cancelan los que
   * salieron de ella antes de responder.
   */
  useEffect(() => {
    const first = store.tileRowOf(range.startRow);
    const last = store.tileRowOf(Math.max(range.startRow, range.endRow - 1));
    const firstC = store.tileColOf(range.startCol);
    const lastC = store.tileColOf(Math.max(range.startCol, range.endCol - 1));

    const keep = new Set<string>();
    for (let tr = first; tr <= last; tr += 1) {
      for (let tc = firstC; tc <= lastC; tc += 1) {
        keep.add(TileStore.key(tr, tc));
      }
    }
    store.cancelOutside(keep);
    for (let tr = first; tr <= last; tr += 1) {
      for (let tc = firstC; tc <= lastC; tc += 1) {
        if (store.stateOf(tr, tc) === 'missing') {
          void store.ensure(tr, tc).catch(() => undefined);
        }
      }
    }
  }, [store, range.startRow, range.endRow, range.startCol, range.endCol]);

  const scrollToCell = useCallback(
    (r: number, c: number): void => {
      const el = containerRef.current;
      if (el === null) return;
      const top = r * CELL;
      const left = c * CELL;
      const viewTop = el.scrollTop;
      const viewLeft = el.scrollLeft;
      const viewBottom = viewTop + el.clientHeight;
      const viewRight = viewLeft + el.clientWidth;

      let nextTop = viewTop;
      let nextLeft = viewLeft;
      if (top < viewTop + CELL) nextTop = Math.max(0, top - CELL);
      else if (top + CELL > viewBottom - CELL) nextTop = top + 2 * CELL - el.clientHeight;
      if (left < viewLeft + CELL) nextLeft = Math.max(0, left - CELL);
      else if (left + CELL > viewRight - CELL) nextLeft = left + 2 * CELL - el.clientWidth;

      if (nextTop !== viewTop || nextLeft !== viewLeft) {
        el.scrollTo({ top: nextTop, left: nextLeft });
        setScroll({ top: nextTop, left: nextLeft });
      }
    },
    [],
  );

  useLayoutEffect(() => {
    handleRef.current = { scrollToCell };
  }, [handleRef, scrollToCell]);

  // La celda con foco SIEMPRE esta en el DOM: primero se asegura visible.
  useEffect(() => {
    if (focusRequest === 0) return undefined;
    scrollToCell(focus.r, focus.c);
    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        const el = containerRef.current?.querySelector<HTMLElement>(
          `[data-rc="${focus.r}-${focus.c}"]`,
        );
        el?.focus({ preventScroll: true });
      });
    });
    return () => {
      window.cancelAnimationFrame(raf1);
      if (raf2 !== 0) window.cancelAnimationFrame(raf2);
    };
  }, [focusRequest, focus.r, focus.c, scrollToCell]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    const pageRows = Math.max(1, Math.floor(size.height / CELL) - 1);
    let { r, c } = focus;
    switch (e.key) {
      case 'ArrowUp':
        r -= 1;
        break;
      case 'ArrowDown':
        r += 1;
        break;
      case 'ArrowLeft':
        c -= 1;
        break;
      case 'ArrowRight':
        c += 1;
        break;
      case 'PageUp':
        r -= pageRows;
        break;
      case 'PageDown':
        r += pageRows;
        break;
      case 'Home':
        if (e.ctrlKey) {
          r = 0;
        }
        c = 0;
        break;
      case 'End':
        if (e.ctrlKey) {
          r = rows - 1;
        }
        c = cols - 1;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onActivate(focus);
        return;
      default:
        return;
    }
    e.preventDefault();
    onFocusChange({
      r: Math.max(0, Math.min(rows - 1, r)),
      c: Math.max(0, Math.min(cols - 1, c)),
    });
  }

  const rowNodes: React.JSX.Element[] = [];
  for (let r = range.startRow; r < range.endRow; r += 1) {
    const cellNodes: React.JSX.Element[] = [];
    for (let c = range.startCol; c < range.endCol; c += 1) {
      const info = store.peek(r, c);
      const key = r * cols + c;
      const isSelected = selected.has(key);
      const isFocused = focus.r === r && focus.c === c;

      let className =
        'relative flex items-center justify-center select-none text-[11px] leading-none ';
      const style: CellStyle = { width: CELL, height: CELL };

      if (info === null) {
        // Placeholder del mismo tamano: el layout no salta.
        className += 'bg-lumon-panel/40 text-transparent';
      } else if (info.bin !== null) {
        className += BIN_CELL_CLASS[info.bin];
      } else if (isScary(info.tremor, rules)) {
        className += 'cell-scary font-bold text-lumon-cyan';
        const span = Math.max(1, 100 - rules.tremorThreshold);
        const intensity = Math.min(1, Math.max(0, (info.tremor - rules.tremorThreshold) / span));
        style['--amp'] = `${(0.6 + intensity * 1.4).toFixed(2)}px`;
        style['--dur'] = `${Math.round(520 - intensity * 380)}ms`;
        // Sin movimiento (reduced motion) se distingue por el borde.
        style.boxShadow = `inset 0 0 0 ${1 + Math.round(intensity * 2)}px rgba(127,216,232,${(
          0.35 +
          intensity * 0.55
        ).toFixed(2)})`;
      } else {
        className += 'text-lumon-dim/70';
      }

      if (isSelected) {
        className += ' ring-2 ring-inset ring-lumon-cyan bg-lumon-cyan/20';
      }

      cellNodes.push(
        <div
          key={c}
          role="gridcell"
          aria-rowindex={r + 1}
          aria-colindex={c + 1}
          aria-selected={isSelected}
          aria-label={
            info === null
              ? `Fila ${r + 1}, columna ${c + 1}, cargando`
              : `Fila ${r + 1}, columna ${c + 1}, digito ${info.digit}, temblor ${info.tremor}${
                  info.bin !== null ? `, en ${info.bin}` : ''
                }`
          }
          data-rc={`${r}-${c}`}
          tabIndex={isFocused ? 0 : -1}
          style={style}
          className={className}
          onPointerDown={(e) => onCellPointerDown({ r, c }, e)}
          onClick={() => {
            onFocusChange({ r, c });
            onActivate({ r, c });
          }}
          onFocus={() => {
            if (!isFocused) onFocusChange({ r, c });
          }}
        >
          {info === null ? '' : info.digit}
        </div>,
      );
    }

    rowNodes.push(
      <div
        key={r}
        role="row"
        aria-rowindex={r + 1}
        className="absolute flex"
        style={{ top: r * CELL, left: range.startCol * CELL, height: CELL }}
      >
        {cellNodes}
      </div>,
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      className="relative h-[60vh] min-h-[320px] overflow-auto rounded border border-lumon-line bg-lumon-bg focus:outline-none"
      tabIndex={-1}
    >
      <div
        role="grid"
        aria-label="Grilla de macrodatos"
        aria-rowcount={rows}
        aria-colcount={cols}
        aria-describedby="grid-help"
        className="relative"
        data-store-version={storeVersion}
        style={{ width: cols * CELL, height: rows * CELL }}
      >
        {rowNodes}
      </div>
      <span id="grid-help" className="sr-only">
        Usa las flechas, Inicio, Fin, Pagina arriba y Pagina abajo para moverte. Enter selecciona el
        grupo completo de la celda. Con un grupo seleccionado, las teclas 1 a 4 lo llevan a WO, FC,
        DR o MA. Celdas visibles: {rowNodes.length * Math.max(0, range.endCol - range.startCol)}.
        {selectedBin !== null ? ` Caja sugerida: ${selectedBin}.` : ''}
      </span>
    </div>
  );
}
