import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { login } from '../lib/session';
import { ApiError, humanMessage } from '../lib/errors';
import { useAuth } from './AuthContext';

interface LocationReason {
  reason?: string | null;
}

function safeNext(raw: string | null): string {
  if (raw === null || raw === '') return '/files';
  // Solo rutas internas: nada de redirecciones abiertas.
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/files';
  if (raw.startsWith('/login') || raw.startsWith('/register')) return '/files';
  return raw;
}

export function LoginPage(): React.JSX.Element {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { state } = useAuth();

  const next = safeNext(params.get('next'));
  const revokedReason = (location.state as LocationReason | null)?.reason ?? null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Si ya hay sesion (por ejemplo, otra pestana entro), ir al destino.
  useEffect(() => {
    if (state.status === 'authenticated') navigate(next, { replace: true });
  }, [state.status, next, navigate]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await login(email.trim(), password);
      navigate(next, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        const byField: Record<string, string> = {};
        for (const fe of err.fieldErrors()) byField[fe.field] = fe.message;
        setFieldErrors(byField);
        setError(Object.keys(byField).length > 0 ? null : err.message);
      } else {
        setError(humanMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <h1 className="text-center text-2xl text-lumon-cyan">Lumon Industries</h1>
      <p className="mt-1 text-center text-xs uppercase tracking-widest text-lumon-dim">
        Macrodata Refinement · Piso separado
      </p>

      {revokedReason !== null ? (
        <p
          role="alert"
          className="mt-6 rounded border border-lumon-dr bg-lumon-dr/10 px-3 py-2 text-sm text-lumon-dr"
        >
          {revokedReason}
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="lumon-panel mt-6 space-y-4 p-6" noValidate>
        <div>
          <label htmlFor="email" className="block text-sm text-lumon-dim">
            Correo
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={fieldErrors['email'] !== undefined}
            aria-describedby={fieldErrors['email'] !== undefined ? 'email-error' : undefined}
            className="lumon-input mt-1"
          />
          {fieldErrors['email'] !== undefined ? (
            <p id="email-error" className="mt-1 text-sm text-lumon-dr">
              {fieldErrors['email']}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="password" className="block text-sm text-lumon-dim">
            Contrasena
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={fieldErrors['password'] !== undefined}
            aria-describedby={fieldErrors['password'] !== undefined ? 'password-error' : undefined}
            className="lumon-input mt-1"
          />
          {fieldErrors['password'] !== undefined ? (
            <p id="password-error" className="mt-1 text-sm text-lumon-dr">
              {fieldErrors['password']}
            </p>
          ) : null}
        </div>

        {error !== null ? (
          <p role="alert" className="text-sm text-lumon-dr">
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={busy} className="lumon-btn w-full">
          {busy ? 'Entrando…' : 'Entrar al piso'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-lumon-dim">
        ¿Primera vez?{' '}
        <Link to="/register" className="text-lumon-cyan underline">
          Registrar la cuadrilla
        </Link>
      </p>
    </main>
  );
}
