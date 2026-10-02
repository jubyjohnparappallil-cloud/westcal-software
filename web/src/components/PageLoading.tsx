export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="page-loading">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function PageError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card">
      <h3>Could not load this page</h3>
      <p className="err">{message}</p>
      <button className="btn sec" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
