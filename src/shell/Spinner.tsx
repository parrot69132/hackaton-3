export function Spinner({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3" role="status">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-lumon-line border-t-lumon-cyan motion-reduce:animate-none"
        aria-hidden="true"
      />
      <p className="text-sm text-lumon-dim">{label}</p>
    </div>
  );
}
