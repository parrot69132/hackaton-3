import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Un error de render en una ruta no deja la app en blanco (CP6):
 * se muestra el error con opcion de volver.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Error de render', error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-sm uppercase tracking-widest text-lumon-dim">Incidente en la consola</p>
        <h1 className="mt-3 text-2xl text-lumon-dr">Algo se rompio en esta pantalla</h1>
        <p className="mt-4 break-words text-sm text-lumon-dim">{error.message}</p>
        <div className="mt-8 flex justify-center gap-3">
          <button type="button" onClick={this.reset} className="lumon-btn">
            Reintentar
          </button>
          <a href="/files" className="lumon-btn-ghost">
            Volver a los archivos
          </a>
        </div>
      </main>
    );
  }
}
