/** Emirates ID or passport. The certificate label follows this choice. */
export function IdKindChoice({
  kind,
  onChange,
}: {
  kind: "eid" | "passport";
  onChange: (kind: "eid" | "passport") => void;
}) {
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
      <button type="button" className={kind === "eid" ? "btn sec sm" : "btn ghost sm"} onClick={() => onChange("eid")}>
        Emirates ID
      </button>
      <button type="button" className={kind === "passport" ? "btn sec sm" : "btn ghost sm"} onClick={() => onChange("passport")}>
        Passport No
      </button>
    </div>
  );
}
