/**
 * Toda la configuracion sale de variables VITE_*. Nada de URLs, buckets
 * ni claves escritas en el codigo (CP6).
 */

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `Falta la variable de entorno ${name}. Copia .env.example a .env y completala.`,
    );
  }
  return value.trim().replace(/\/+$/, '');
}

function optional(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return null;
  return value.trim();
}

export const API_BASE_URL: string = required('VITE_API_BASE_URL', import.meta.env.VITE_API_BASE_URL);
export const WS_BASE_URL: string = required('VITE_WS_BASE_URL', import.meta.env.VITE_WS_BASE_URL);

/** SHA corto del commit desplegado, o 'dev' en local. */
export const BUILD_SHA: string = __LUMON_BUILD__;

export const TEAM_CODE: string | null = optional(import.meta.env.VITE_TEAM_CODE);

export const STORAGE = {
  provider: optional(import.meta.env.VITE_STORAGE_PROVIDER),
  supabaseUrl: optional(import.meta.env.VITE_SUPABASE_URL),
  supabaseKey: optional(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY),
  bucket: optional(import.meta.env.VITE_SUPABASE_BUCKET),
} as const;
