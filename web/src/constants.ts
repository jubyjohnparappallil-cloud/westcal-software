export interface ServiceDef {
  id: string;
  icon: string;
  hint?: string;
}

export const SERVICES: ServiceDef[] = [
  { id: "Testing", icon: "🔬", hint: "Create a testing job, assign the engineer, collect results." },
  { id: "Calibration", icon: "⚖️", hint: "Create a calibration job for instruments on site or in the lab." },
  { id: "Inspection", icon: "🔎", hint: "Create an inspection job and issue the report / certificate." },
  { id: "Training", icon: "🎓", hint: "Create a training job, assign a trainer, issue trainee certificates." },
  { id: "Mapping", icon: "🗺️", hint: "Create a mapping job. Choose the type, then prepare the protocol." },
];

export const SUBCONTRACT: ServiceDef = { id: "Subcontract", icon: "🤝" };

export const ROLE_NAMES: Record<string, string> = {
  "role-super-admin": "Super Admin",
  "role-admin-staff": "Office Admin",
  "role-sales": "Sales",
  "role-job-assistant": "Office Coordinator",
  "role-front-desk": "Front Desk Staff",
  "role-trainer": "Trainer",
  "role-site-engineer": "Site Engineer",
};

export const initials = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
