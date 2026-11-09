import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { listFiles } from '../lib/api';
import { humanMessage, isAbort } from '../lib/errors';
import { BINS, PAGE_SIZES, SORT_OPTIONS, type DataFile, type FilePage } from '../lib/types';
import { useFilesQuery } from './useFilesQuery';
import { Spinner } from '../shell/Spinner';

const SORT_LABEL: Record<string, string> = {
  'updatedAt,desc': 'Mas recientes',
  'name,asc': 'Nombre (A-Z)',
  'progress,desc': 'Mas avanzados',
};

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function FileCard({ file }: { file: DataFile }): React.JSX.Element {
  return (
    <li className="lumon-panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lumon-cyan">
          <Link to={`/files/${file.id}/refine`} className="underline-offset-2 hover:underline">
            {file.name}
          </Link>
        </h2>
        <span
          className={
            file.status === 'COMPLETE'
              ? 'rounded border border-lumon-wo px-2 py-0.5 text-xs text-lumon-wo'
              : 'rounded border border-lumon-line px-2 py-0.5 text-xs text-lumon-dim'
          }
        >
          {file.status === 'COMPLETE' ? 'Completo' : 'Activo'}
        </span>
      </div>

      <p className="mt-1 text-xs text-lumon-dim">
        {file.rows} × {file.cols} · bloques de {file.tileSize} · {file.refinedGroups}/
        {file.totalGroups} grupos · {file.mistakes} errores
      </p>

      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-lumon-dim">
          <span>Avance total</span>
          <span>{pct(file.progress.overall)}</span>
        </div>
        <div
          className="mt-1 h-2 w-full overflow-hidden rounded bg-lumon-bg"
          role="progressbar"
          aria-valuenow={Math.round(file.progress.overall * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Avance de ${file.name}`}
        >
          <div
            className="h-full bg-lumon-cyan"
            style={{ width: `${file.progress.overall * 100}%` }}
          />
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
        {BINS.map((bin) => (
          <div key={bin} className="rounded border border-lumon-line py-1">
            <dt className="text-lumon-dim">{bin}</dt>
            <dd className="text-lumon-text">{pct(file.progress[bin])}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

export function FilesListPage(): React.JSX.Element {
  const { query, setQuery } = useFilesQuery();
  const [page, setPage] = useState<FilePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Texto del buscador: se escribe libre y se manda a la URL con debounce,
  // para no hacer una request por tecla.
  const [searchText, setSearchText] = useState(query.q);
  const lastAppliedQ = useRef(query.q);

  useEffect(() => {
    if (query.q !== lastAppliedQ.current) {
      lastAppliedQ.current = query.q;
      setSearchText(query.q);
    }
  }, [query.q]);

  useEffect(() => {
    if (searchText === query.q) return undefined;
    const timer = window.setTimeout(() => {
      lastAppliedQ.current = searchText;
      setQuery({ q: searchText }, { replace: true });
    }, 350);
    return () => window.clearTimeout(timer);
    // setQuery se recrea cada render; la dependencia real es el texto y el query aplicado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText, query.q]);

  /**
   * Guardia contra respuestas desordenadas (modo caos): cada request lleva un
   * numero y solo la MAS NUEVA puede escribir en el estado. Ademas se cancela
   * la anterior.
   */
  const requestSeq = useRef(0);

  useEffect(() => {
    const seq = ++requestSeq.current;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const result = await listFiles(query, ctrl.signal);
        if (seq !== requestSeq.current) return; // respuesta vieja: se descarta
        setPage(result);
        setLoading(false);
      } catch (e) {
        if (isAbort(e) || seq !== requestSeq.current) return;
        setError(humanMessage(e));
        setLoading(false);
      }
    })();

    return () => ctrl.abort();
  }, [query]);

  const totalPages = page?.totalPages ?? 0;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-xl text-lumon-cyan">Archivos de datos</h1>
      <p className="mt-1 text-sm text-lumon-dim">
        Encuentra los numeros que dan miedo y llevalos a su caja.
      </p>

      <section className="lumon-panel mt-5 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="q" className="block text-xs text-lumon-dim">
            Buscar
          </label>
          <input
            id="q"
            type="search"
            value={searchText}
            maxLength={60}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Nombre del archivo"
            className="lumon-input mt-1"
          />
        </div>

        <div>
          <label htmlFor="status" className="block text-xs text-lumon-dim">
            Estado
          </label>
          <select
            id="status"
            value={query.status ?? ''}
            onChange={(e) =>
              setQuery({
                status: e.target.value === '' ? null : (e.target.value as 'ACTIVE' | 'COMPLETE'),
              })
            }
            className="lumon-input mt-1"
          >
            <option value="">Todos</option>
            <option value="ACTIVE">Activos</option>
            <option value="COMPLETE">Completos</option>
          </select>
        </div>

        <div>
          <label htmlFor="sort" className="block text-xs text-lumon-dim">
            Orden
          </label>
          <select
            id="sort"
            value={query.sort}
            onChange={(e) => setQuery({ sort: e.target.value as (typeof SORT_OPTIONS)[number] })}
            className="lumon-input mt-1"
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s] ?? s}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="size" className="block text-xs text-lumon-dim">
            Por pagina
          </label>
          <select
            id="size"
            value={query.size}
            onChange={(e) => setQuery({ size: Number(e.target.value) as (typeof PAGE_SIZES)[number] })}
            className="lumon-input mt-1"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </section>

      <div aria-live="polite" className="mt-4 min-h-[1.25rem] text-xs text-lumon-dim">
        {loading ? 'Cargando archivos…' : null}
        {!loading && page !== null
          ? `${page.totalElements} archivos · pagina ${page.page + 1} de ${Math.max(totalPages, 1)}`
          : null}
      </div>

      {error !== null ? (
        <div role="alert" className="lumon-panel mt-2 border-lumon-dr p-4 text-sm text-lumon-dr">
          <p>{error}</p>
          <button
            type="button"
            className="lumon-btn-ghost mt-3"
            onClick={() => setQuery({ page: query.page }, { replace: true })}
          >
            Reintentar
          </button>
        </div>
      ) : null}

      {loading && page === null ? <Spinner label="Cargando archivos…" /> : null}

      {page !== null ? (
        page.content.length === 0 ? (
          <p className="lumon-panel mt-2 p-6 text-center text-lumon-dim">
            No hay archivos con esos filtros.
          </p>
        ) : (
          <ul className={`mt-2 grid gap-3 sm:grid-cols-2 ${loading ? 'opacity-60' : ''}`}>
            {page.content.map((file) => (
              <FileCard key={file.id} file={file} />
            ))}
          </ul>
        )
      ) : null}

      {page !== null && totalPages > 1 ? (
        <nav aria-label="Paginacion" className="mt-6 flex items-center justify-center gap-2">
          <button
            type="button"
            className="lumon-btn-ghost"
            disabled={query.page <= 0}
            onClick={() => setQuery({ page: query.page - 1 })}
          >
            Anterior
          </button>
          <span className="text-sm text-lumon-dim">
            {page.page + 1} / {totalPages}
          </span>
          <button
            type="button"
            className="lumon-btn-ghost"
            disabled={query.page >= totalPages - 1}
            onClick={() => setQuery({ page: query.page + 1 })}
          >
            Siguiente
          </button>
        </nav>
      ) : null}
    </main>
  );
}
