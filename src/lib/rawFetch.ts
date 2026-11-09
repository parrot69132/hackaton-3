import { backoffDelay, parseRetryAfter, sleep } from './backoff';
import { API_BASE_URL, BUILD_SHA } from './env';
import { ApiError, NetworkError, type ApiErrorBody } from './errors';

export interface HttpResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

export interface RawOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  accessToken?: string | null;
  /** Reintentos automaticos para 503 y 429. 0 = el caller decide. */
  retries?: number;
}

function buildHeaders(opts: RawOptions): Headers {
  const h = new Headers(opts.headers);
  // TODAS las requests llevan el build, incluidas las de login.
  h.set('X-Lumon-Build', BUILD_SHA);
  h.set('Accept', 'application/json');
  if (opts.body !== undefined && !h.has('Content-Type')) {
    h.set('Content-Type', 'application/json');
  }
  if (opts.accessToken !== undefined && opts.accessToken !== null) {
    h.set('Authorization', `Bearer ${opts.accessToken}`);
  }
  return h;
}

async function readError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> = {};
  try {
    body = (await res.json()) as Partial<ApiErrorBody>;
  } catch {
    body = {};
  }
  return new ApiError({
    status: res.status,
    code: typeof body.error === 'string' ? body.error : `HTTP_${res.status}`,
    message:
      typeof body.message === 'string' && body.message !== ''
        ? body.message
        : `La API respondio ${res.status}.`,
    details: body.details,
    requestId: typeof body.requestId === 'string' ? body.requestId : null,
    retryAfterMs: parseRetryAfter(res.headers.get('Retry-After')),
  });
}

/**
 * Fetch de bajo nivel contra la API. No sabe nada de refresh: eso lo decide
 * la capa de sesion (ver api.ts). Reintenta 503 y 429 con espera creciente,
 * respetando Retry-After cuando viene.
 */
export async function rawFetch<T>(path: string, opts: RawOptions = {}): Promise<HttpResponse<T>> {
  const retries = opts.retries ?? 3;
  const url = `${API_BASE_URL}${path}`;

  for (let attempt = 0; ; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: buildHeaders(opts),
        body: opts.body === undefined ? null : JSON.stringify(opts.body),
        signal: opts.signal ?? null,
        credentials: 'omit',
        mode: 'cors',
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      if (attempt < retries) {
        await sleep(backoffDelay(attempt), opts.signal);
        continue;
      }
      throw new NetworkError('Fallo de red al contactar la API.', e);
    }

    if (res.ok) {
      if (res.status === 204) {
        return { data: undefined as T, status: res.status, headers: res.headers };
      }
      const text = await res.text();
      const data = (text === '' ? undefined : JSON.parse(text)) as T;
      return { data, status: res.status, headers: res.headers };
    }

    const err = await readError(res);
    const retriable = res.status === 503 || res.status === 429;
    if (retriable && attempt < retries) {
      const wait = err.retryAfterMs ?? backoffDelay(attempt);
      await sleep(wait, opts.signal);
      continue;
    }
    throw err;
  }
}
