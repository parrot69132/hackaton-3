import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { register } from '../lib/session';
import { ApiError, humanMessage } from '../lib/errors';

/**
 * El registro crea la cuenta y entra DIRECTO con la sesion iniciada.
 * Los errores del servidor (nombre o email ya tomados, datos invalidos)
 * se muestran junto al campo que corresponde.
 */
export function RegisterPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [teamName, setTeamName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function mapConflict(err: ApiError): Record<string, string> {
    // El codigo es estable; el mensaje es solo texto.
    switch (err.code) {
      case 'TEAM_NAME_TAKEN':
        return { teamName: err.message };
      case 'EMAIL_TAKEN':
      case 'EMAIL_ALREADY_REGISTERED':
        return { email: err.message };
      default:
        return {};
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await register(teamName.trim(), email.trim(), password);
      navigate('/files', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        const byField: Record<string, string> = {};
        for (const fe of err.fieldErrors()) byField[fe.field] = fe.message;
        const mapped = Object.keys(byField).length > 0 ? byField : mapConflict(err);
        setFieldErrors(mapped);
        setError(Object.keys(mapped).length > 0 ? null : err.message);
      } else {
        setError(humanMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <h1 className="text-center text-2xl text-lumon-cyan">Registrar la cuadrilla</h1>
      <p className="mt-1 text-center text-xs uppercase tracking-widest text-lumon-dim">
        Lumon asignara su TEAM_CODE
      </p>

      <form onSubmit={onSubmit} className="lumon-panel mt-6 space-y-4 p-6" noValidate>
        <div>
          <label htmlFor="teamName" className="block text-sm text-lumon-dim">
            Nombre de la cuadrilla
          </label>
          <input
            id="teamName"
            name="teamName"
            required
            minLength={3}
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            aria-invalid={fieldErrors['teamName'] !== undefined}
            aria-describedby={fieldErrors['teamName'] !== undefined ? 'teamName-error' : undefined}
            className="lumon-input mt-1"
          />
          {fieldErrors['teamName'] !== undefined ? (
            <p id="teamName-error" className="mt-1 text-sm text-lumon-dr">
              {fieldErrors['teamName']}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="reg-email" className="block text-sm text-lumon-dim">
            Correo
          </label>
          <input
            id="reg-email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={fieldErrors['email'] !== undefined}
            aria-describedby={fieldErrors['email'] !== undefined ? 'reg-email-error' : undefined}
            className="lumon-input mt-1"
          />
          {fieldErrors['email'] !== undefined ? (
            <p id="reg-email-error" className="mt-1 text-sm text-lumon-dr">
              {fieldErrors['email']}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="reg-password" className="block text-sm text-lumon-dim">
            Contrasena
          </label>
          <input
            id="reg-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={fieldErrors['password'] !== undefined}
            aria-describedby={
              fieldErrors['password'] !== undefined ? 'reg-password-error' : undefined
            }
            className="lumon-input mt-1"
          />
          {fieldErrors['password'] !== undefined ? (
            <p id="reg-password-error" className="mt-1 text-sm text-lumon-dr">
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
          {busy ? 'Registrando…' : 'Crear cuadrilla y entrar'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-lumon-dim">
        ¿Ya tienen cuenta?{' '}
        <Link to="/login" className="text-lumon-cyan underline">
          Entrar
        </Link>
      </p>
    </main>
  );
}
