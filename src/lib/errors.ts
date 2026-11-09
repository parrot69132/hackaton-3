/** Cuerpo de error de la API (identico en todos los endpoints). */
export interface ApiErrorBody {
  error: string;
  message: string;
  details: unknown;
  timestamp?: string;
  path?: string;
  requestId?: string;
}

export interface ValidationFieldError {
  field: string;
  message: string;
}

/**
 * Error de la API. Se decide SIEMPRE por `code` (el campo `error`),
 * nunca por `message`, que es solo texto para personas.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | null;
  /** Milisegundos a esperar, derivado de Retry-After (429 / 503). */
  readonly retryAfterMs: number | null;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    requestId?: string | null;
    retryAfterMs?: number | null;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? null;
    this.requestId = init.requestId ?? null;
    this.retryAfterMs = init.retryAfterMs ?? null;
  }

  /** Errores de validacion por campo, para pintarlos junto al input. */
  fieldErrors(): ValidationFieldError[] {
    const d = this.details;
    if (!Array.isArray(d)) return [];
    const out: ValidationFieldError[] = [];
    for (const item of d) {
      if (typeof item === 'object' && item !== null) {
        const rec = item as Record<string, unknown>;
        const field = rec['field'];
        const message = rec['message'];
        if (typeof field === 'string' && typeof message === 'string') {
          out.push({ field, message });
        }
      }
    }
    return out;
  }
}

/** Error de red / CORS / cancelacion: no hubo respuesta HTTP. */
export class NetworkError extends Error {
  readonly reason: unknown;

  constructor(message: string, reason?: unknown) {
    super(message);
    this.name = 'NetworkError';
    this.reason = reason ?? null;
  }
}

export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

/** Solo TOKEN_EXPIRED justifica intentar un refresh. */
export function isExpiredToken(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401 && e.code === 'TOKEN_EXPIRED';
}

/** La sesion murio: hay que volver al login. */
export function isSessionDead(e: unknown): boolean {
  return (
    e instanceof ApiError &&
    e.status === 401 &&
    (e.code === 'REFRESH_REUSED' ||
      e.code === 'SESSION_REVOKED' ||
      e.code === 'TOKEN_INVALID' ||
      e.code === 'REFRESH_INVALID')
  );
}

export function humanMessage(e: unknown): string {
  if (isAbort(e)) return 'Operacion cancelada.';
  if (e instanceof ApiError) return e.message;
  if (e instanceof NetworkError) return 'No se pudo contactar a Lumon. Revisa tu conexion.';
  if (e instanceof Error) return e.message;
  return 'Error inesperado.';
}
