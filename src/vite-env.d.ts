/// <reference types="vite/client" />

/** Inyectado por Vite en tiempo de build (ver vite.config.ts). */
declare const __LUMON_BUILD__: string;

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_WS_BASE_URL?: string;
  readonly VITE_STORAGE_PROVIDER?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_BUCKET?: string;
  readonly VITE_TEAM_CODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
