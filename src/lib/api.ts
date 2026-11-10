import { rawFetch, type HttpResponse, type RawOptions } from './rawFetch';
import { ApiError, isExpiredToken, isSessionDead } from './errors';
import { forceRefresh, getAccessToken, killSession } from './session';
import type {
  Clearance,
  ClearanceCheckResult,
  DataFile,
  DeployChallenge,
  FilePage,
  Health,
  IntegrationStatus,
  PageSize,
  RefineResult,
  Roster,
  Rules,
  SortOption,
  Tile,
  Bin,
  Cell,
  FileStatus,
  Department,
  Refiner,
  RefinerPage,
  RefinerPatch,
} from './types';

export type ApiOptions = Omit<RawOptions, 'accessToken'>;

/**
 * Request autenticada. Si recibe TOKEN_EXPIRED pide UN refresh (compartido
 * con las demas requests) y reintenta UNA sola vez con el token nuevo.
 */
export async function apiFetch<T>(path: string, opts: ApiOptions = {}): Promise<HttpResponse<T>> {
  let token: string;
  try {
    token = await getAccessToken();
  } catch (e) {
    if (isSessionDead(e)) killSession(sessionDeadMessage(e));
    throw e;
  }

  try {
    return await rawFetch<T>(path, { ...opts, accessToken: token });
  } catch (first) {
    if (!isExpiredToken(first)) {
      if (isSessionDead(first)) killSession(sessionDeadMessage(first));
      throw first;
    }
    // Un unico refresh compartido; el resto de requests espera el mismo.
    let fresh: string;
    try {
      fresh = await forceRefresh(token);
    } catch (refreshError) {
      killSession(sessionDeadMessage(refreshError));
      throw refreshError;
    }
    try {
      return await rawFetch<T>(path, { ...opts, accessToken: fresh });
    } catch (second) {
      if (isSessionDead(second) || isExpiredToken(second)) {
        killSession(sessionDeadMessage(second));
      }
      throw second;
    }
  }
}

function sessionDeadMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'REFRESH_REUSED') {
      return 'Se detecto un uso repetido del token de sesion y Lumon la revoco por seguridad. Vuelve a entrar.';
    }
    if (e.code === 'SESSION_REVOKED') return 'Tu sesion fue revocada. Vuelve a entrar.';
    return 'Tu sesion ya no es valida. Vuelve a entrar.';
  }
  return 'Tu sesion ya no es valida. Vuelve a entrar.';
}

// ---------- Endpoints sin token ----------

export async function getHealth(signal?: AbortSignal): Promise<Health> {
  const res = await rawFetch<Health>('/meta/health', { retries: 0, signal });
  return res.data;
}

// ---------- Archivos ----------

export interface FilesQuery {
  page: number;
  size: PageSize;
  status: FileStatus | null;
  q: string;
  sort: SortOption;
}

export function filesQueryString(query: FilesQuery): string {
  const p = new URLSearchParams();
  p.set('page', String(query.page));
  p.set('size', String(query.size));
  p.set('sort', query.sort);
  if (query.status !== null) p.set('status', query.status);
  if (query.q !== '') p.set('q', query.q);
  return p.toString();
}

export async function listFiles(query: FilesQuery, signal?: AbortSignal): Promise<FilePage> {
  const res = await apiFetch<FilePage>(`/files?${filesQueryString(query)}`, { signal });
  return res.data;
}

export async function getFile(id: number, signal?: AbortSignal): Promise<DataFile> {
  const res = await apiFetch<DataFile>(`/files/${id}`, { signal });
  return res.data;
}

/** Las reglas CAMBIAN por archivo: siempre se leen, nunca se hardcodean. */
export async function getRules(id: number, signal?: AbortSignal): Promise<Rules> {
  const res = await apiFetch<Rules>(`/files/${id}/rules`, { signal });
  return res.data;
}

/** Indices de bloque desde 0. Sin reintento automatico: el caller maneja 429/503. */
export async function getTile(
  fileId: number,
  tileRow: number,
  tileCol: number,
  signal?: AbortSignal,
): Promise<Tile> {
  const res = await apiFetch<Tile>(`/files/${fileId}/tiles/${tileRow}/${tileCol}`, {
    signal,
    retries: 0,
  });
  return res.data;
}

export interface RefineOutcome {
  result: RefineResult;
  replayed: boolean;
}

/**
 * La cabecera es `Idempotency-Key` (sin prefijo X-) y se mantiene IGUAL en los
 * reintentos de la misma intencion del usuario: asi un doble clic o un corte de
 * red no refinan dos veces ni suman dos errores.
 */
export async function refineGroup(
  fileId: number,
  bin: Bin,
  cells: Cell[],
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<RefineOutcome> {
  const res = await apiFetch<RefineResult>(`/files/${fileId}/refinements`, {
    method: 'POST',
    body: { bin, cells },
    headers: { 'Idempotency-Key': idempotencyKey },
    signal,
    retries: 2,
  });
  return {
    result: res.data,
    replayed: res.headers.get('Idempotent-Replayed') === 'true',
  };
}

// ---------- Integraciones, clearance, roster (CP3 / CP6) ----------

export async function getIntegrationStatus(signal?: AbortSignal): Promise<IntegrationStatus> {
  const res = await apiFetch<IntegrationStatus>('/integrations/status', { signal });
  return res.data;
}

export async function getClearance(signal?: AbortSignal): Promise<Clearance> {
  const res = await apiFetch<Clearance>('/clearance', { signal });
  return res.data;
}

/** Solo funciona desde la app desplegada: desde localhost responde 403. */
export async function runClearanceCheck(signal?: AbortSignal): Promise<ClearanceCheckResult> {
  const res = await apiFetch<ClearanceCheckResult>('/clearance/check', {
    method: 'POST',
    signal,
    retries: 0,
  });
  return res.data;
}

export async function requestDeployChallenge(
  origin: string,
  signal?: AbortSignal,
): Promise<DeployChallenge> {
  const res = await apiFetch<DeployChallenge>('/integrations/deploy/challenge', {
    method: 'POST',
    body: { origin },
    signal,
    retries: 0,
  });
  return res.data;
}

export async function verifyDeploy(signal?: AbortSignal): Promise<unknown> {
  const res = await apiFetch<unknown>('/integrations/deploy/verify', {
    method: 'POST',
    signal,
    retries: 0,
  });
  return res.data;
}

export async function getRoster(signal?: AbortSignal): Promise<Roster> {
  const res = await apiFetch<Roster>('/team/roster', { signal });
  return res.data;
}

export async function setChaos(level: 0 | 1 | 2, signal?: AbortSignal): Promise<unknown> {
  const res = await apiFetch<unknown>('/workspace/chaos', {
    method: 'PUT',
    body: { level },
    signal,
    retries: 0,
  });
  return res.data;
}

// ---------- Expedientes (CP4 directorio / CP5 Regla de Milchick) ----------

export interface RefinersQuery {
  page: number;
  size: PageSize;
  departmentId: number | null;
  q: string;
}

export async function listDepartments(signal?: AbortSignal): Promise<Department[]> {
  const res = await apiFetch<Department[]>('/departments', { signal });
  return res.data;
}

export async function listRefiners(
  query: RefinersQuery,
  signal?: AbortSignal,
): Promise<RefinerPage> {
  const p = new URLSearchParams();
  p.set('page', String(query.page));
  p.set('size', String(query.size));
  if (query.departmentId !== null) p.set('departmentId', String(query.departmentId));
  if (query.q !== '') p.set('q', query.q);
  const res = await apiFetch<RefinerPage>(`/refiners?${p.toString()}`, { signal });
  return res.data;
}

export interface RefinerWithTag {
  refiner: Refiner;
  /** Valor exacto del ETag: hace falta para el If-Match del PATCH. */
  etag: string | null;
}

export async function getRefiner(id: number, signal?: AbortSignal): Promise<RefinerWithTag> {
  const res = await apiFetch<Refiner>(`/refiners/${id}`, { signal });
  return { refiner: res.data, etag: res.headers.get('ETag') };
}

/**
 * Regla de Milchick: nunca se sobrescribe lo que no se ha leido.
 * El PATCH exige `If-Match` con el ETag EXACTO que devolvio el GET.
 * Nada de `If-Match: *` (la API responde 400) ni de reintentos silenciosos
 * con el ETag nuevo: ante 412 se le muestra el conflicto al usuario.
 */
export async function patchRefiner(
  id: number,
  patch: RefinerPatch,
  etag: string,
  signal?: AbortSignal,
): Promise<RefinerWithTag> {
  const res = await apiFetch<Refiner>(`/refiners/${id}`, {
    method: 'PATCH',
    body: patch,
    headers: { 'If-Match': etag },
    signal,
    retries: 0,
  });
  return { refiner: res.data, etag: res.headers.get('ETag') };
}
