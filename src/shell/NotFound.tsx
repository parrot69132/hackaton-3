import { Link } from 'react-router-dom';

export function NotFound(): React.JSX.Element {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center">
      <p className="text-sm uppercase tracking-widest text-lumon-dim">Error 404</p>
      <h1 className="mt-3 text-2xl text-lumon-cyan">Este pasillo no existe</h1>
      <p className="mt-4 text-lumon-dim">
        La ruta que buscas no esta en el piso separado. Revisa la direccion.
      </p>
      <Link to="/" className="lumon-btn mt-8 inline-block">
        Volver al inicio
      </Link>
    </main>
  );
}
