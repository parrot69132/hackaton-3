import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getRefiner, patchRefiner } from '../lib/api';
import { ApiError, humanMessage, isAbort } from '../lib/errors';
import type { Refiner, RefinerPatch } from '../lib/types';
import { eventStream, type LumonEvent } from '../lib/realtime/eventStream';
import { Spinner } from '../shell/Spinner';

type Draft = { title: string; extension: string; bio: string };

const FIELD_LABEL: Record<keyof Draft, string> = {
  title: 'Cargo',
  extension: 'Anexo',
  bio: 'Resena',
};

function toDraft(r: Refiner): Draft {
  return { title: r.title, extension: r.extension, bio: r.bio };
}

/**
 * Regla de Milchick (CP5): nunca se sobrescribe lo que no se ha leido.
 *  - El PATCH va con `If-Match` y el ETag EXACTO del GET. Nada de `If-Match: *`.
 *  - Si llega un `refiner.updated` de este expediente mientras se edita, se avisa
 *    ANTES de guardar.
 *  - Ante 412 se muestra el conflicto campo por campo y el usuario elige; recien
 *    entonces se reintenta con el ETag nuevo. Nunca en silencio.
 */
export function RefinerEditPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const refinerId = Number(id);

  const [server, setServer] = useState<Refiner | null>(null);
  const [etag, setEtag] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changedOutside, setChangedOutside] = useState(false);
  const [conflict, setConflict] = useState<{ current: Refiner; etag: string | null } | null>(null);
  const [resolution, setResolution] = useState<Record<keyof Draft, 'mine' | 'theirs'>>({
    title: 'mine',
    extension: 'mine',
    bio: 'mine',
  });
  const reload = useRef(0);

  useEffect(() => {
    if (!Number.isInteger(refinerId) || refinerId < 1) {
      setLoadError('Identificador de expediente invalido.');
      return undefined;
    }
    const ctrl = new AbortController();
    void (async () => {
      try {
        const { refiner, etag: tag } = await getRefiner(refinerId, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setServer(refiner);
        setEtag(tag);
        setDraft(toDraft(refiner));
        setChangedOutside(false);
      } catch (e) {
        if (isAbort(e)) return;
        setLoadError(humanMessage(e));
      }
    })();
    return () => ctrl.abort();
  }, [refinerId, reload.current]);

  // Aviso en vivo: alguien mas toco este expediente mientras editas.
  useEffect(() => {
    const onEvent = (event: LumonEvent): void => {
      if (event.type !== 'refiner.updated') return;
      if (event.data['id'] !== refinerId) return;
      const version = event.data['version'];
      if (typeof version === 'number' && server !== null && version <= server.version) return;
      setChangedOutside(true);
    };
    return eventStream.subscribe(onEvent);
  }, [refinerId, server]);

  async function save(useEtag: string, body: RefinerPatch): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { refiner, etag: tag } = await patchRefiner(refinerId, body, useEtag);
      setServer(refiner);
      setEtag(tag);
      setDraft(toDraft(refiner));
      setConflict(null);
      setChangedOutside(false);
      setNotice('Expediente guardado.');
    } catch (e) {
      if (e instanceof ApiError && e.status === 412) {
        // Alguien cambio el expediente desde que lo leimos: se muestra el conflicto.
        try {
          const fresh = await getRefiner(refinerId);
          setConflict({ current: fresh.refiner, etag: fresh.etag });
          setEtag(fresh.etag);
        } catch {
          setError('El expediente cambio en el servidor y no se pudo releer.');
        }
        setError('El expediente cambio mientras lo editabas. Revisa el conflicto antes de guardar.');
      } else if (e instanceof ApiError && e.status === 428) {
        setError('Falta el If-Match. Recarga el expediente e intenta de nuevo.');
      } else {
        setError(humanMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (draft === null || etag === null || server === null) return;
    const body: RefinerPatch = {};
    if (draft.title !== server.title) body.title = draft.title;
    if (draft.extension !== server.extension) body.extension = draft.extension;
    if (draft.bio !== server.bio) body.bio = draft.bio;
    if (Object.keys(body).length === 0) {
      setNotice('No hay cambios que guardar.');
      return;
    }
    void save(etag, body);
  }

  function applyResolution(): void {
    if (conflict === null || draft === null || conflict.etag === null) return;
    const merged: Draft = {
      title: resolution.title === 'mine' ? draft.title : conflict.current.title,
      extension: resolution.extension === 'mine' ? draft.extension : conflict.current.extension,
      bio: resolution.bio === 'mine' ? draft.bio : conflict.current.bio,
    };
    const body: RefinerPatch = {};
    if (merged.title !== conflict.current.title) body.title = merged.title;
    if (merged.extension !== conflict.current.extension) body.extension = merged.extension;
    if (merged.bio !== conflict.current.bio) body.bio = merged.bio;
    setDraft(merged);
    if (Object.keys(body).length === 0) {
      setServer(conflict.current);
      setConflict(null);
      setNotice('Te quedaste con la version del servidor: no hubo nada que escribir.');
      return;
    }
    void save(conflict.etag, body);
  }

  if (loadError !== null) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-xl text-lumon-dr">No se pudo abrir el expediente</h1>
        <p className="mt-3 text-sm text-lumon-dim">{loadError}</p>
        <Link to="/refiners" className="lumon-btn mt-6 inline-block">
          Volver al directorio
        </Link>
      </main>
    );
  }

  if (server === null || draft === null) return <Spinner label="Abriendo el expediente…" />;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl text-lumon-cyan">{server.fullName}</h1>
          <p className="text-xs text-lumon-dim">
            {server.department.name} · version {server.version}
            {etag !== null ? ` · ETag ${etag}` : ''}
          </p>
        </div>
        <Link to="/refiners" className="lumon-btn-ghost">
          Volver
        </Link>
      </div>

      {changedOutside && conflict === null ? (
        <p
          role="alert"
          className="mt-4 rounded border border-lumon-ma px-3 py-2 text-sm text-lumon-ma"
        >
          Alguien cambio este expediente mientras lo editabas. Si guardas ahora, Lumon rechazara el
          cambio y te mostrara el conflicto.
        </p>
      ) : null}

      {conflict !== null ? (
        <section className="lumon-panel mt-4 border-lumon-dr p-4">
          <h2 className="text-lumon-dr">Conflicto de version</h2>
          <p className="mt-1 text-xs text-lumon-dim">
            El servidor tiene la version {conflict.current.version}. Elige campo por campo que se
            guarda. Nada se sobrescribe sin que lo decidas.
          </p>

          <div className="mt-4 space-y-4">
            {(Object.keys(FIELD_LABEL) as Array<keyof Draft>).map((field) => {
              const mine = draft[field];
              const theirs = conflict.current[field];
              const same = mine === theirs;
              return (
                <div key={field} className={same ? 'opacity-50' : ''}>
                  <p className="text-sm text-lumon-text">{FIELD_LABEL[field]}</p>
                  <div className="mt-1 grid gap-2 sm:grid-cols-2">
                    <label className="flex gap-2 rounded border border-lumon-line p-2 text-xs">
                      <input
                        type="radio"
                        name={`res-${field}`}
                        checked={resolution[field] === 'mine'}
                        onChange={() => setResolution((r) => ({ ...r, [field]: 'mine' }))}
                      />
                      <span>
                        <span className="block text-lumon-dim">Lo que escribiste</span>
                        <span className="break-words text-lumon-text">{mine}</span>
                      </span>
                    </label>
                    <label className="flex gap-2 rounded border border-lumon-line p-2 text-xs">
                      <input
                        type="radio"
                        name={`res-${field}`}
                        checked={resolution[field] === 'theirs'}
                        onChange={() => setResolution((r) => ({ ...r, [field]: 'theirs' }))}
                      />
                      <span>
                        <span className="block text-lumon-dim">Lo que hay en el servidor</span>
                        <span className="break-words text-lumon-text">{theirs}</span>
                      </span>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={applyResolution}
            disabled={busy}
            className="lumon-btn mt-4"
          >
            {busy ? 'Guardando…' : 'Guardar lo elegido'}
          </button>
        </section>
      ) : null}

      <form onSubmit={onSubmit} className="lumon-panel mt-4 space-y-4 p-4">
        <div>
          <label htmlFor="title" className="block text-sm text-lumon-dim">
            Cargo
          </label>
          <input
            id="title"
            value={draft.title}
            maxLength={200}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            className="lumon-input mt-1"
          />
        </div>
        <div>
          <label htmlFor="extension" className="block text-sm text-lumon-dim">
            Anexo (3 a 6 digitos)
          </label>
          <input
            id="extension"
            value={draft.extension}
            pattern="[0-9]{3,6}"
            onChange={(e) => setDraft({ ...draft, extension: e.target.value })}
            className="lumon-input mt-1"
          />
        </div>
        <div>
          <label htmlFor="bio" className="block text-sm text-lumon-dim">
            Resena
          </label>
          <textarea
            id="bio"
            value={draft.bio}
            maxLength={2000}
            rows={5}
            onChange={(e) => setDraft({ ...draft, bio: e.target.value })}
            className="lumon-input mt-1"
          />
        </div>

        {error !== null ? (
          <p role="alert" className="text-sm text-lumon-dr">
            {error}
          </p>
        ) : null}
        {notice !== null ? (
          <p role="status" className="text-sm text-lumon-wo">
            {notice}
          </p>
        ) : null}

        <button type="submit" disabled={busy || conflict !== null} className="lumon-btn">
          {busy ? 'Guardando…' : 'Guardar con If-Match'}
        </button>
      </form>
    </main>
  );
}
