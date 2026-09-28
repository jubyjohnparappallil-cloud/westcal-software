/**
 * Application composition: wires the modules together and exposes a Platform
 * facade. This is the modular monolith assembled behind the Module Registry.
 */
import { SystemClock, Clock } from "./shared/clock.js";
import { PermissionService } from "./modules/permission/permission.js";
import { AuthService } from "./modules/auth/auth.js";
import { UsersService } from "./modules/users/users.js";
import { JobsService } from "./modules/jobs/jobs.js";
import { FieldService } from "./modules/field/field.js";
import { DocumentCodes } from "./modules/documents/documentCodes.js";
import { CertificateService } from "./modules/certificates/certificates.js";
import { TrainingService } from "./modules/training/training.js";
import { CourseCatalog } from "./modules/training/courses.js";

export interface Platform {
  clock: Clock;
  permissions: PermissionService;
  auth: AuthService;
  users: UsersService;
  jobs: JobsService;
  field: FieldService;
  certificates: CertificateService;
  training: TrainingService;
  courses: CourseCatalog;
}

export const ROLES = {
  SUPER_ADMIN: "role-super-admin",
  SALES: "role-sales",
  ADMIN_STAFF: "role-admin-staff",
  JOB_ASSISTANT: "role-job-assistant",
  FRONT_DESK: "role-front-desk",
  TRAINER: "role-trainer",
  SITE_ENGINEER: "role-site-engineer",
} as const;

const ROLE_NAMES: Record<string, string> = {
  [ROLES.SUPER_ADMIN]: "Super_Admin",
  [ROLES.SALES]: "Sales_Person",
  [ROLES.ADMIN_STAFF]: "Admin_Staff",
  [ROLES.JOB_ASSISTANT]: "Office_Coordinator",
  [ROLES.FRONT_DESK]: "Front_Desk_Staff",
  [ROLES.TRAINER]: "Trainer",
  [ROLES.SITE_ENGINEER]: "Site_Engineer",
};

export function createPlatform(clock: Clock = new SystemClock()): Platform {
  const permissions = new PermissionService();
  for (const [id, name] of Object.entries(ROLE_NAMES)) {
    permissions.registerRole({ id, name });
  }

  const codes = new DocumentCodes();
  const jobs = new JobsService((userId) =>
    permissions.getUserRoleIds(userId).includes(ROLES.SITE_ENGINEER)
  );
  const field = new FieldService(jobs);
  const certificates = new CertificateService(jobs, field, codes);
  const training = new TrainingService(
    codes,
    (userId) => permissions.getUserRoleIds(userId).includes(ROLES.TRAINER),
    (userId) => permissions.getUserRoleIds(userId).includes(ROLES.SITE_ENGINEER)
  );

  let auth: AuthService;
  const users = new UsersService(permissions, (userId) =>
    auth.terminateAllSessions(userId)
  );
  auth = new AuthService(clock, (identifier) => users.lookupForAuth(identifier));
  const courses = new CourseCatalog();

  return { clock, permissions, auth, users, jobs, field, certificates, training, courses };
}
