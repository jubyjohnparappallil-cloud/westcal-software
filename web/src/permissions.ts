import { SERVICES } from "./constants";
import type { Session } from "./types";

/** Matches the server: issued jobs need the "edit after issue" tick, closed jobs are Super Admin only. */
const ISSUED_STATUSES = ["Approved", "Issued"];
const CLOSED_STATUSES = ["Closed", "Cancelled"];

export function permissions(session: Session) {
  const has = (p: string) => (session.perms || []).includes(p);
  const role = (r: string) => session.roles.includes(r);
  const isSuper = () => role("role-super-admin");
  const isAdmin = () => role("role-super-admin") || role("role-admin-staff");
  const isAssistant = () => role("role-job-assistant");
  const isFrontDesk = () => role("role-front-desk");
  const isTrainer = () => role("role-trainer");
  const isSiteEngineer = () => role("role-site-engineer");
  const isFieldUser = () => isTrainer() || isSiteEngineer();

  const moduleAllowed = (id: string) => isSuper() || !session.modules?.length || session.modules.includes(id);
  const canCreateService = (id: string) =>
    moduleAllowed(id) && (isSuper() || has(id + ":create") || (id === "Training" && has("Training:create")));
  const canSeeService = (id: string) =>
    moduleAllowed(id) &&
    (isSuper() || has(id + ":create") || has(id + ":read") || has(id + ":edit") || has("Training:read"));
  const canViewCerts = () => isSuper() || has("Certificates:read") || has("Certificates:edit");
  const canIssueCerts = () => isSuper() || has("Certificates:edit");
  const canDownload = () => isSuper() || has("Training:documents");
  const canAttendance = () => isSuper() || has("Training:attendance");
  const canReports = () => isSuper() || has("Reports:read");
  const canAddTrainees = () => isSuper() || has("Training:add_attendees");
  const canEditTrainees = () => isSuper() || has("Training:add_attendees");
  const canDeleteJob = () => isSuper();
  const canEditJob = () => isSuper() || has("Training:edit");
  const canCancelJob = () => isSuper() || has("Training:cancel");
  const canChangeJob = (status: string) =>
    isSuper() || (!CLOSED_STATUSES.includes(status) && (!ISSUED_STATUSES.includes(status) || has("Training:edit_issued")));
  const canCreateAny = () => has("Training:create") || SERVICES.some((s) => canCreateService(s.id));

  return {
    has,
    moduleAllowed,
    isSuper,
    isAdmin,
    isAssistant,
    isFrontDesk,
    isTrainer,
    isSiteEngineer,
    isFieldUser,
    canCreateService,
    canSeeService,
    canViewCerts,
    canIssueCerts,
    canDownload,
    canAttendance,
    canReports,
    canAddTrainees,
    canEditTrainees,
    canDeleteJob,
    canEditJob,
    canCancelJob,
    canChangeJob,
    canCreateAny,
  };
}

export type Permissions = ReturnType<typeof permissions>;
