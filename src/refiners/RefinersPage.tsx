import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listDepartments, listRefiners, type RefinersQuery } from '../lib/api';
import { humanMessage, isAbort } from '../lib/errors';
import { PAGE_SIZES, type Department, type PageSize, type Refiner, type RefinerPage } from '../lib/types';
import { eventStream, type LumonEvent } from '../lib/realtime/eventStream';
import { Spinner } from '../shell/Spinner';
import { useAuth } from '../auth/AuthContext';

function parseSize(raw: string | null): PageSize {
  const n = Number(raw);
  return PAGE_SIZES.find((s) => s === n) ?? 10;
}
function parsePage(raw: string | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, 10_000) : 0;
}
function parseDept(raw: string | null): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Directorio de expedientes. Todo el estado en la URL.
 * Los textos vienen del exterior: React los escapa, nunca se interpretan
 * como HTML (no hay dangerouslySetInnerHTML en ningun punto de la app).
 */
export function RefinersPage(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const query: RefinersQuery = {
    page: parsePage(params.get('page')),
    size: parseSize(params.get('size')),
    departmentId: parseDept(params.get('departmentId')),
    q: (params.get('q') ?? '').slice(0, 60),
  };

  const [page, setPage] = useState<RefinerPage | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(query.q);
  const seq = useRef(0);

  function update(patch: Partial<RefinersQuery>, replace = false): void {
    const next = { ...query, ...patch };
    if (patch.page === undefined) next.page = 0;
    const sp = new URLSearchParams();
    if (next.page !== 0) sp.set('page', String(next.page));
    if (next.size !== 10) sp.set('size', String(next.size));
    if (next.departmentId !== null) sp.set('departmentId', String(next.departmentId));
    if (next.q !== '') sp.set('q', next.q);
    setParams(sp, { replace });
  }

  useEffect(() => {
    const ctrl = new AbortController();
    void listDepartments(ctrl.signal).then(setDepartments, () => undefined);
    return () => ctrl.abort();
  }, []);

  // Busqueda con debounce: no una request por tecla.
  useEffect(() => {
    if (search === query.q) return undefined;
    const t = window.setTimeout(() => update({ q: search }, true), 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, query.q]);

  const key = `${query.page}|${query.size}|${query.departmentId ?? ''}|${query.q}`;
  useEffect(() => {
    const mine = ++seq.current;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result = await listRefiners(query, ctrl.signal);
        if (mine !== seq.current) return; // una respuesta vieja nunca pisa a una nueva
        setPage(result);
        setLoading(false);
      } catch (e) {
        if (isAbort(e) || mine !== seq.current) return;
        setError(humanMessage(e));
        setLoading(false);
      }
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // El directorio refleja los eventos sin recargar, y una version vieja
  // nunca pisa a una mas nueva.
  useEffect(() => {
    const onEvent = (event: LumonEvent): void => {
      if (event.type !== 'refiner.updated') return;
      const id = event.data['id'];
      const version = event.data['version'];
      if (typeof id !== 'number' || typeof version !== 'number') return;
      setPage((prev) => {
        if (prev === null) return prev;
        let changed = false;
        const content = prev.content.map((r) => {
          if (r.id !== id || version <= r.version) return r;
          changed = true;
          const patch: Partial<Refiner> = { version };
          if (typeof event.data['title'] === 'string') patch.title = event.data['title'];
          if (typeof event.data['bio'] === 'string') patch.bio = event.data['bio'];
          if (typeof event.data['extension'] === 'string') {
            patch.extension = event.data['extension'];
          }
          return { ...r, ...patch };
        });
        return changed ? { ...prev, content } : prev;
      });
    };
    return eventStream.subscribe(onEvent);
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-xl text-lumon-cyan">Expedientes del personal</h1>

      <section className="lumon-panel mt-4 grid gap-3 p-4 sm:grid-cols-3">
        <div>
          <label htmlFor="rq" className="block text-xs text-lumon-dim">
            Buscar
          </label>
          <input
            id="rq"
            type="search"
            value={search}
            maxLength={60}
            onChange={(e) => setSearch(e.target.value)}
            className="lumon-input mt-1"
          />
        </div>
        <div>
          <label htmlFor="rd" className="block text-xs text-lumon-dim">
            Departamento
          </label>
          <select
            id="rd"
            value={query.departmentId ?? ''}
            onChange={(e) =>
              update({ departmentId: e.target.value === '' ? null : Number(e.target.value) })
            }
            className="lumon-input mt-1"
          >
            <option value="">Todos</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rs" className="block text-xs text-lumon-dim">
            Por pagina
          </label>
          <select
            id="rs"
            value={query.size}
            onChange={(e) => update({ size: Number(e.target.value) as PageSize })}
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

      <p aria-live="polite" className="mt-3 text-xs text-lumon-dim">
        {loading
          ? 'Cargando expedientes…'
          : page !== null
            ? `${page.totalElements} expedientes · pagina ${page.page + 1} de ${Math.max(page.totalPages, 1)}`
            : ''}
      </p>

      {error !== null ? (
        <p role="alert" className="lumon-panel mt-2 border-lumon-dr p-4 text-sm text-lumon-dr">
          {error}
        </p>
      ) : null}

      {loading && page === null ? <Spinner label="Cargando expedientes…" /> : null}

      {page !== null ? (
        <ul className={`mt-2 grid gap-3 sm:grid-cols-2 ${loading ? 'opacity-60' : ''}`}>
          {page.content.map((r) => (
            <li key={r.id} className="lumon-panel flex gap-3 p-4">
              {/* width/height fijos: la imagen no mueve el layout al cargar */}
              {r.badge !== null ? (
                <img
                  src={r.badge.url}
                  alt=""
                  width={64}
                  height={64}
                  loading="lazy"
                  decoding="async"
                  className="h-16 w-16 flex-none rounded border border-lumon-line object-cover"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="h-16 w-16 flex-none rounded border border-lumon-line bg-lumon-bg"
                />
              )}
              <div className="min-w-0">
                <h2 className="truncate text-lumon-cyan">{r.fullName}</h2>
                <p className="text-xs text-lumon-dim">
                  {r.department.name} · {r.title} · anexo {r.extension}
                </p>
                <p className="mt-1 line-clamp-3 text-xs text-lumon-dim">{r.bio}</p>
                {can('refiners:write') ? (
                  <Link
                    to={`/refiners/${r.id}/edit`}
                    className="mt-2 inline-block text-xs text-lumon-cyan underline"
                  >
                    Editar expediente
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {page !== null && page.totalPages > 1 ? (
        <nav aria-label="Paginacion" className="mt-6 flex items-center justify-center gap-2">
          <button
            type="button"
            className="lumon-btn-ghost"
            disabled={query.page <= 0}
            onClick={() => update({ page: query.page - 1 })}
          >
            Anterior
          </button>
          <span className="text-sm text-lumon-dim">
            {page.page + 1} / {page.totalPages}
          </span>
          <button
            type="button"
            className="lumon-btn-ghost"
            disabled={query.page >= page.totalPages - 1}
            onClick={() => update({ page: query.page + 1 })}
          >
            Siguiente
          </button>
        </nav>
      ) : null}
    </main>
  );
}
