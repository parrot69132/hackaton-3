import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { FilesQuery } from '../lib/api';
import { PAGE_SIZES, SORT_OPTIONS, type FileStatus, type PageSize, type SortOption } from '../lib/types';

/**
 * Todo el estado del listado vive en la URL. Una URL invalida NO rompe la
 * vista: cada parametro cae a su valor por defecto.
 */
function parseSize(raw: string | null): PageSize {
  const n = Number(raw);
  const found = PAGE_SIZES.find((s) => s === n);
  return found ?? 10;
}

function parsePage(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return 0;
  return Math.min(n, 10_000);
}

function parseStatus(raw: string | null): FileStatus | null {
  return raw === 'ACTIVE' || raw === 'COMPLETE' ? raw : null;
}

function parseSort(raw: string | null): SortOption {
  const found = SORT_OPTIONS.find((s) => s === raw);
  return found ?? 'updatedAt,desc';
}

export interface FilesQueryControls {
  query: FilesQuery;
  /** Texto crudo del input (puede ir adelantado al query ya aplicado). */
  setQuery: (patch: Partial<FilesQuery>, options?: { replace?: boolean }) => void;
}

export function useFilesQuery(): FilesQueryControls {
  const [params, setParams] = useSearchParams();

  const query = useMemo<FilesQuery>(
    () => ({
      page: parsePage(params.get('page')),
      size: parseSize(params.get('size')),
      status: parseStatus(params.get('status')),
      q: (params.get('q') ?? '').slice(0, 60),
      sort: parseSort(params.get('sort')),
    }),
    [params],
  );

  function setQuery(patch: Partial<FilesQuery>, options?: { replace?: boolean }): void {
    const next: FilesQuery = { ...query, ...patch };
    // Cambiar filtros, busqueda, orden o tamano vuelve a la primera pagina.
    if (patch.page === undefined) next.page = 0;

    const sp = new URLSearchParams();
    if (next.page !== 0) sp.set('page', String(next.page));
    if (next.size !== 10) sp.set('size', String(next.size));
    if (next.sort !== 'updatedAt,desc') sp.set('sort', next.sort);
    if (next.status !== null) sp.set('status', next.status);
    if (next.q !== '') sp.set('q', next.q);

    setParams(sp, { replace: options?.replace ?? false });
  }

  return { query, setQuery };
}
