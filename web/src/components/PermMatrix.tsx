import { PACTS, PMODS } from "../lib/roles";

/** Training permissions as offered on the staff screens. */
export const STAFF_TRAINING_PERMS: [string, string][] = [
  ["Training:read", "View training jobs"],
  ["Training:create", "Add job & assign trainer"],
  ["Training:edit", "Edit job"],
  ["Training:cancel", "Request job cancellation (with reason)"],
  ["Training:add_attendees", "Add & edit trainees"],
  ["Training:attendance", "Attendance sheet"],
  ["Training:edit_issued", "Edit trainees & attendance after issue"],
  ["Training:documents", "Job sheet & review form"],
  ["Certificates:read", "View & download certificates"],
  ["Certificates:edit", "Issue & edit certificates"],
  ["Invoice:create", "Add invoice number & close job"],
  ["Invoice:monitor", "See invoice summary in Reports"],
  ["Reports:read", "Reports"],
];

export const STAFF_PERM_KEYS = [...PMODS.flatMap((m) => PACTS.map((a) => m + ":" + a)), ...STAFF_TRAINING_PERMS.map(([k]) => k)];

const OFFICE_TRAINING = ["Training:cancel", "Training:attendance", "Training:add_attendees", "Reports:read"];

export const STAFF_PRESET: Record<string, string[]> = {
  "role-super-admin": STAFF_PERM_KEYS,
  "role-admin-staff": [
    "Testing:create", "Testing:read", "Calibration:create", "Calibration:read", "Inspection:create", "Inspection:read",
    "Mapping:create", "Mapping:read", "Mapping:edit", "Training:create", "Training:read", "Training:assign", "Training:edit",
    "Training:cancel", "Certificates:read", "Training:documents", "Invoice:create", "Invoice:monitor", "Reports:read",
  ],
  "role-sales": [
    "Testing:create", "Testing:read", "Calibration:create", "Calibration:read", "Inspection:create", "Inspection:read",
    "Mapping:create", "Mapping:read", "Training:create", "Training:read", "Training:assign", ...OFFICE_TRAINING,
  ],
  "role-job-assistant": [
    "Training:read", "Training:edit", "Training:edit_issued", "Certificates:read", "Certificates:edit", "Testing:read", "Calibration:read", "Inspection:read",
    "Mapping:read", "Mapping:edit", ...OFFICE_TRAINING,
  ],
  "role-front-desk": [
    "Testing:create", "Testing:read", "Calibration:create", "Calibration:read", "Inspection:create", "Inspection:read",
    "Mapping:create", "Mapping:read", "Training:create", "Training:read", "Training:assign", "Training:cancel",
    "Training:attendance", "Reports:read",
  ],
  "role-trainer": ["Training:read", "Training:edit", "Training:attendance", "Training:add_attendees", "Certificates:read"],
  "role-site-engineer": [
    "Training:read", "Training:add_attendees", "Testing:read", "Testing:edit", "Calibration:read", "Calibration:edit",
    "Inspection:read", "Inspection:edit",
  ],
};

export const STAFF_ROLES = [
  { id: "role-super-admin", name: "Super Admin", who: "Adds people and chooses their role. Full control." },
  { id: "role-admin-staff", name: "Office Admin", who: "Adds jobs, assigns trainers, requests cancel, adds the invoice number to close. Downloads job sheet and review form. Only views issued certificates." },
  { id: "role-sales", name: "Sales", who: "Creates jobs for customers." },
  { id: "role-job-assistant", name: "Office Coordinator", who: "Fills attendance, adds trainees, issues certificates, downloads attendance sheets, certificates and ID cards." },
  { id: "role-front-desk", name: "Front Desk Staff", who: "Books new jobs at reception. Simple create and view." },
  { id: "role-trainer", name: "Trainer", who: "Runs training on site. Signs in on the phone at /m." },
  { id: "role-site-engineer", name: "Site Engineer", who: "Does testing, calibration and inspection on site." },
];

const ACTION_LABEL: Record<string, string> = { create: "Add", read: "View", edit: "Edit" };

export function initialPermSet(perms: string[] | undefined) {
  return new Set((perms || []).filter((p) => STAFF_PERM_KEYS.includes(p)));
}

export function permSetToPayload(set: Set<string>) {
  return STAFF_PERM_KEYS.filter((k) => set.has(k)).map((k) => {
    const [module, action] = k.split(":");
    return { module, action };
  });
}

export function PermMatrix({ value, onChange }: { value: Set<string>; onChange: (next: Set<string>) => void }) {
  const toggle = (key: string) => {
    const next = new Set(value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };
  return (
    <div className="perm-box">
      <div className="perm-group">
        <b>Training</b>
        <div className="perm-list">
          {STAFF_TRAINING_PERMS.map(([key, label]) => (
            <label key={key} className={"perm-item" + (value.has(key) ? " on" : "")}>
              <input type="checkbox" checked={value.has(key)} onChange={() => toggle(key)} />
              {label}
            </label>
          ))}
        </div>
      </div>
      <div className="perm-group">
        <b>Other modules</b>
        <table className="perm-tbl">
          <thead>
            <tr>
              <th />
              {PACTS.map((a) => (
                <th key={a}>{ACTION_LABEL[a]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PMODS.map((m) => (
              <tr key={m}>
                <td>{m}</td>
                {PACTS.map((a) => {
                  const key = m + ":" + a;
                  return (
                    <td key={a}>
                      <input type="checkbox" checked={value.has(key)} onChange={() => toggle(key)} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        Only the ticked items work for this person. Deleting jobs stays Super Admin only.
      </p>
    </div>
  );
}
