/** Modules shown as a create / view / edit grid. */
export const PMODS = ["Testing", "Calibration", "Inspection", "Mapping"];
export const PACTS = ["create", "read", "edit"];

/** Training permissions, each switched on or off by the Super Admin. */
export const TRAINING_PERMS: [string, string][] = [
  ["Training:read", "View training jobs"],
  ["Training:create", "Add job"],
  ["Training:assign", "Assign trainer to job"],
  ["Training:edit", "Edit job details"],
  ["Training:cancel", "Cancel job"],
  ["Training:add_attendees", "Add & edit trainees"],
  ["Training:attendance", "Attendance sheet"],
  ["Training:edit_issued", "Edit trainees & attendance after issue"],
  ["Certificates:read", "View & download certificates"],
  ["Certificates:edit", "Issue & edit certificates"],
  ["Invoice:create", "Add invoice number & close job"],
  ["Invoice:monitor", "Monitor invoicing (Super Admin)"],
  ["Reports:read", "Reports"],
];

export const ALL_PERM_KEYS = [...PMODS.flatMap((m) => PACTS.map((a) => m + ":" + a)), ...TRAINING_PERMS.map(([k]) => k)];

const OFFICE_TRAINING = ["Training:cancel", "Training:attendance", "Training:add_attendees", "Reports:read"];

export const PRESET: Record<string, string[]> = {
  "role-super-admin": ALL_PERM_KEYS,
  "role-admin-staff": ["Testing:create", "Testing:read", "Calibration:create", "Calibration:read", "Inspection:create", "Inspection:read", "Mapping:create", "Mapping:read", "Mapping:edit", "Training:create", "Training:read", "Training:assign", "Training:edit", "Training:cancel", "Certificates:read", "Training:documents", "Invoice:create", "Invoice:monitor", "Reports:read"],
  "role-sales": ["Testing:create", "Testing:read", "Calibration:create", "Calibration:read", "Inspection:create", "Inspection:read", "Mapping:create", "Mapping:read", "Training:create", "Training:read", "Training:assign", ...OFFICE_TRAINING],
  "role-job-assistant": ["Training:read", "Training:edit", "Training:edit_issued", "Certificates:read", "Certificates:edit", "Testing:read", "Calibration:read", "Inspection:read", "Mapping:read", "Mapping:edit", ...OFFICE_TRAINING],
  "role-front-desk": ["Testing:create", "Testing:read", "Calibration:create", "Calibration:read", "Inspection:create", "Inspection:read", "Mapping:create", "Mapping:read", "Training:create", "Training:read", "Training:assign", "Training:cancel", "Training:attendance", "Reports:read"],
  "role-trainer": ["Training:read", "Training:edit", "Training:attendance", "Training:add_attendees", "Certificates:read"],
  "role-site-engineer": ["Training:read", "Training:add_attendees", "Testing:read", "Testing:edit", "Calibration:read", "Calibration:edit", "Inspection:read", "Inspection:edit"],
};

export const ROLE_HELP = [
  { id: "role-super-admin", name: "Super Admin", who: "Adds people and chooses their role. Full control." },
  { id: "role-admin-staff", name: "Office Admin", who: "Adds jobs, assigns trainers, requests cancel, adds the invoice number to close. Downloads job sheet and review form. Only views issued certificates." },
  { id: "role-sales", name: "Sales", who: "Creates jobs for customers." },
  { id: "role-job-assistant", name: "Office Coordinator", who: "Fills attendance, adds trainees, issues certificates, downloads attendance sheets, certificates and ID cards." },
  { id: "role-front-desk", name: "Front Desk Staff", who: "Books new jobs at reception. Simple create and view." },
  { id: "role-trainer", name: "Trainer", who: "Runs training on site. Signs in on the phone at /m." },
  { id: "role-site-engineer", name: "Site Engineer", who: "Does testing, calibration and inspection on site." },
];

export const presetPermissions = (role: string) =>
  (PRESET[role] || []).map((k) => {
    const [module, action] = k.split(":");
    return { module, action };
  });

export interface User {
  id: string;
  identifier: string;
  email?: string;
  displayName: string;
  roleIds: string[];
  status: string;
  permissions?: string[];
  modules?: string[];
  createdAt?: string;
}

export interface Assignee {
  id: string;
  displayName: string;
  roleName: string;
}
