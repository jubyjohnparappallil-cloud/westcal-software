import { SERVICES, SUBCONTRACT } from "../constants";

export const ALL_MODULES = [...SERVICES, SUBCONTRACT];

/** An empty / missing list means "all modules". */
export const initialModules = (modules: string[] | undefined | null) =>
  new Set(modules?.length ? modules : ALL_MODULES.map((m) => m.id));

/** Sends [] when every module is ticked, so new modules are allowed automatically. */
export const modulesPayload = (set: Set<string>) =>
  ALL_MODULES.every((m) => set.has(m.id)) ? [] : ALL_MODULES.filter((m) => set.has(m.id)).map((m) => m.id);

export function ModuleAccess({ value, onChange }: { value: Set<string>; onChange: (next: Set<string>) => void }) {
  const toggle = (id: string) => {
    const next = new Set(value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  return (
    <div className="module-access">
      {ALL_MODULES.map((m) => (
        <label key={m.id} className={"module-chip" + (value.has(m.id) ? " on" : "")}>
          <input type="checkbox" checked={value.has(m.id)} onChange={() => toggle(m.id)} />
          <span className="ico">{m.icon}</span>
          {m.id}
        </label>
      ))}
    </div>
  );
}
