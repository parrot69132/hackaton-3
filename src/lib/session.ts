import { rawFetch } from './rawFetch';
import { ApiError, isSessionDead } from './errors';
import type { LoginResponse, Me, TokenPair } from './types';

/**
 * Reglas de sesion (CP1):
 *  - El ACCESS token vive SOLO en memoria. Nunca localStorage/sessionStorage/IndexedDB/cookies.
 *  - El REFRESH token se puede persistir y es de UN SOLO USO.
 *  - Un solo POST /auth/refresh aunque varias requests fallen a la vez (single-flight).
 *  - Con varias pestanas, el vencimiento nunca produce REFRESH_REUSED: se coordina
 *    con Web Locks + relectura del refresh token dentro del lock + BroadcastChannel.
 */

const RT_KEY = 'lumon.rt';
const CHANNEL = 'lumon.session';
/** Margen para no usar un token que esta por vencer. */
const SKEW_MS = 5_000;

export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous'; reason: string | null }
  | { status: 'authenticated'; me: Me };

type Listener = (s: SessionState) => void;

interface TokensMessage {
  type: 'tokens';
  accessToken: string;
  expiresAt: number;
}
interface LogoutMessage {
  type: 'logout';
  reason: string | null;
}
type SessionMessage = TokensMessage | LogoutMessage;

// --- Estado en memoria (fuera de React) ---
let accessToken: string | null = null;
let expiresAt = 0;
let state: SessionState = { status: 'loading' };
const listeners = new Set<Listener>();

let channel: BroadcastChannel | null = null;
if (typeof BroadcastChannel !== 'undefined') {
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (ev: MessageEvent<SessionMessage>): void => {
    const msg = ev.data;
    if (msg.type === 'tokens') {
      accessToken = msg.accessToken;
      expiresAt = msg.expiresAt;
    } else {
      clearTokens();
      setState({ status: 'anonymous', reason: msg.reason });
    }
  };
}

function post(msg: SessionMessage): void {
  channel?.postMessage(msg);
}

function setState(next: SessionState): void {
  state = next;
  for (const l of listeners) l(state);
}

export function getState(): SessionState {
  return state;
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function readRefreshToken(): string | null {
  try {
    return window.localStorage.getItem(RT_KEY);
  } catch {
    return null;
  }
}

function writeRefreshToken(token: string): void {
  try {
    window.localStorage.setItem(RT_KEY, token);
  } catch {
    /* almacenamiento bloqueado: la sesion solo durara esta pestana */
  }
}

function clearTokens(): void {
  accessToken = null;
  expiresAt = 0;
  try {
    window.localStorage.removeItem(RT_KEY);
  } catch {
    /* ignorar */
  }
}

function storePair(pair: TokenPair): void {
  accessToken = pair.accessToken;
  expiresAt = Date.now() + pair.expiresIn * 1000;
  writeRefreshToken(pair.refreshToken);
  post({ type: 'tokens', accessToken: pair.accessToken, expiresAt });
}

/** Web Locks coordina entre pestanas; si no existe, se degrada a ejecucion directa. */
async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = navigator.locks;
  if (locks === undefined) return fn();
  return locks.request('lumon.refresh', fn) as Promise<T>;
}

let inflightRefresh: Promise<string> | null = null;

/**
 * Un solo refresh a la vez por pestana y, gracias al lock, uno a la vez
 * por navegador. Dentro del lock se vuelve a leer el refresh token: si otra
 * pestana ya roto el par, usamos el nuevo y nunca reenviamos uno usado.
 */
function refreshTokens(): Promise<string> {
  if (inflightRefresh !== null) return inflightRefresh;

  inflightRefresh = withRefreshLock(async (): Promise<string> => {
    // Otra pestana pudo haber refrescado mientras esperabamos el lock.
    if (accessToken !== null && Date.now() < expiresAt - SKEW_MS) {
      return accessToken;
    }
    const rt = readRefreshToken();
    if (rt === null) {
      throw new ApiError({
        status: 401,
        code: 'SESSION_REVOKED',
        message: 'No hay sesion guardada.',
      });
    }
    const res = await rawFetch<TokenPair>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: rt },
      retries: 2,
    });
    storePair(res.data);
    return res.data.accessToken;
  }).finally(() => {
    inflightRefresh = null;
  });

  return inflightRefresh;
}

/** Token valido para una request, refrescando si hace falta. */
export async function getAccessToken(): Promise<string> {
  if (accessToken !== null && Date.now() < expiresAt - SKEW_MS) return accessToken;
  return refreshTokens();
}

/** Fuerza un refresh (lo llama api.ts cuando una request recibe TOKEN_EXPIRED). */
export async function forceRefresh(usedToken: string | null): Promise<string> {
  // Si el token en memoria ya cambio, otra request/pestana lo renovo: reutilizar.
  if (accessToken !== null && accessToken !== usedToken && Date.now() < expiresAt - SKEW_MS) {
    return accessToken;
  }
  if (accessToken === usedToken) {
    accessToken = null;
    expiresAt = 0;
  }
  return refreshTokens();
}

export function currentAccessToken(): string | null {
  return accessToken;
}

export function setAuthenticated(me: Me): void {
  setState({ status: 'authenticated', me });
}

export function patchMe(me: Me): void {
  if (state.status === 'authenticated') setState({ status: 'authenticated', me });
}

/** La sesion murio (REFRESH_REUSED, SESSION_REVOKED, logout en otra pestana). */
export function killSession(reason: string | null): void {
  clearTokens();
  setState({ status: 'anonymous', reason });
  post({ type: 'logout', reason });
}

export async function login(email: string, password: string): Promise<void> {
  const res = await rawFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { email, password },
    retries: 1,
  });
  storePair(res.data);
  await loadMe();
}

export async function register(
  teamName: string,
  email: string,
  password: string,
): Promise<void> {
  const res = await rawFetch<LoginResponse>('/auth/register', {
    method: 'POST',
    body: { teamName, email, password },
    retries: 0,
  });
  storePair(res.data);
  await loadMe();
}

export async function loadMe(): Promise<Me> {
  const token = await getAccessToken();
  const res = await rawFetch<Me>('/auth/me', { accessToken: token, retries: 2 });
  setAuthenticated(res.data);
  return res.data;
}

export async function logout(): Promise<void> {
  const rt = readRefreshToken();
  // El logout revoca la sesion en el servidor, no solo en el cliente.
  if (rt !== null) {
    try {
      await rawFetch<void>('/auth/logout', {
        method: 'POST',
        body: { refreshToken: rt },
        accessToken: accessToken,
        retries: 1,
      });
    } catch {
      /* igual cerramos localmente */
    }
  }
  killSession(null);
}

/**
 * Restauracion al recargar: si hay refresh token, rotamos y pedimos /auth/me.
 * Mientras tanto el estado queda en 'loading' y la UI no muestra el login.
 */
export async function restore(): Promise<void> {
  if (readRefreshToken() === null) {
    setState({ status: 'anonymous', reason: null });
    return;
  }
  try {
    await loadMe();
  } catch (e) {
    if (isSessionDead(e)) {
      killSession('Tu sesion ya no es valida. Vuelve a entrar.');
    } else {
      // Error de red o 503: no borramos la sesion, dejamos reintentar.
      setState({ status: 'anonymous', reason: null });
    }
  }
}
