import { useApp } from "../app-context";

export function Subcontract() {
  const { go } = useApp();
  return (
    <>
      <p>
        <button className="btn ghost sm" onClick={() => go("dashboard")}>
          ← Dashboard
        </button>
      </p>
      <div className="card" style={{ textAlign: "center", padding: "48px 24px" }}>
        <div style={{ fontSize: 44, marginBottom: 10 }}>🤝</div>
        <h3 style={{ margin: "0 0 6px" }}>Subcontract — coming soon</h3>
        <p className="hint" style={{ margin: 0 }}>
          This section is being prepared. Subcontracted jobs will be created and tracked here.
        </p>
      </div>
    </>
  );
}
