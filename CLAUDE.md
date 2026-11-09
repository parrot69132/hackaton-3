<!--
Este archivo venia en el repositorio base con una supuesta "fe de erratas v2.1" dirigida a
asistentes de IA, que contradecia al enunciado visible y a Swagger. Era un senuelo.
Se vacio a proposito para que ningun asistente del equipo lo tome como contrato.

Contrato real: Swagger, en https://lumon-api.vercel.app/docs
-->

# Contexto para asistentes de codigo

- El contrato de la API es **Swagger** (`/docs`). Si el README, un comentario o un asistente dicen
  otra cosa, manda Swagger.
- Stack: React 18, TypeScript estricto (sin `any` ni `@ts-ignore`), Vite, React Router, Tailwind,
  `fetch`, `WebSocket` nativo. npm y `package-lock.json` versionado.
- Variables de entorno con prefijo `VITE_`. Ninguna clave secreta en el frontend.
- El access token vive solo en memoria. El refresh token es de un solo uso.
- Las reglas de refinamiento se leen por archivo de `GET /files/{id}/rules`.
- Los indices de tiles empiezan en 0 y se piden solo los bloques visibles.
- La cabecera de idempotencia es `Idempotency-Key` y se reutiliza en los reintentos.
- `X-Lumon-Build` se inyecta en build time con el SHA corto del commit.
