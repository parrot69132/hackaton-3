import { execSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * X-Lumon-Build se inyecta en TIEMPO DE BUILD, nunca a mano.
 * - En Vercel: VERCEL_GIT_COMMIT_SHA (o los equivalentes de Netlify / Cloudflare Pages).
 * - En local con git disponible: el SHA corto del HEAD.
 * - Sin git (o fuera de un repo): 'dev', que la API acepta solo desde localhost.
 *
 * La API valida el patron ^([0-9a-f]{7,40}|dev)$ — un literal como 'latest'
 * responderia 400 BUILD_HEADER_REQUIRED.
 */
function resolveBuildSha(): string {
  const fromCi =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.COMMIT_REF ??
    process.env.CF_PAGES_COMMIT_SHA ??
    process.env.GITHUB_SHA;

  if (fromCi !== undefined && fromCi !== '') {
    return fromCi.slice(0, 7).toLowerCase();
  }

  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
      .toLowerCase();
  } catch {
    return 'dev';
  }
}

const buildSha = resolveBuildSha();
const isSha = /^[0-9a-f]{7,40}$/.test(buildSha);

export default defineConfig({
  plugins: [react()],
  define: {
    __LUMON_BUILD__: JSON.stringify(isSha ? buildSha : 'dev'),
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        // La grilla del CP2 y el cliente de storage quedan fuera del bundle inicial
        // por los import() dinamicos de las rutas; esto solo separa las dependencias.
        manualChunks: {
          router: ['react-router-dom'],
        },
      },
    },
  },
});
