/**
 * HTTP server exposing the Westcal training workflow + a web UI.
 * Every API route (except sign-in and courses) requires a valid session token
 * and checks the caller's role permissions. This is real access control.
 *   npm run start  ->  http://localhost:3000
 */
import "./env.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createNetServer } from "node:net";
import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize } from "node:path";
import os from "node:os";
import QRCode from "qrcode";
import PDFDocument from "pdfkit";
import { createPlatform, Platform, ROLES } from "./app.js";
import { DATA_FILE, MYSQL_DATABASE, MYSQL_HOST, MYSQL_PORT, loadPlatformState, savePlatformState } from "./persist.js";
import { AppError, AuthenticationError, AuthorizationError, NotFoundError, ValidationError } from "./shared/errors.js";
import { parseEmiratesId } from "./modules/training/idFetch.js";
import { RegistrationService } from "./modules/auth/registration.js";
import { createOtpMailer, parseAllowList } from "./modules/auth/mailer.js";
import type { TrainingCertificate, TrainingJob } from "./modules/training/training.js";
import type { PermissionKey } from "./modules/permission/permission.js";
import { attendancePublicHtml, sendAttendanceSheetPdf } from "./modules/training/attendanceSheet.js";
import { sendAssignedJobSheetPdf, sendContractReviewPdf, sendWorkPermitPdf } from "./modules/training/trainingForms.js";
import { sendMappingProtocol } from "./modules/training/mappingProtocol.js";
import { sendTrainingCertificatePdf, sendTrainingCertificateContentPdf, sendTrainingCertificateLayoutPdf, listCertificateDesigns, CERTIFICATE_DESIGNS_DIR, printedCertificateVerifyHtml } from "./modules/training/certificateTemplate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

const platform: Platform = createPlatform();
seedRolePermissions(platform);
const registration = new RegistrationService(
  platform.users,
  parseAllowList(process.env.SUPER_ADMIN_REGISTER_ALLOW),
  createOtpMailer(),
  ROLES.SUPER_ADMIN,
  (process.env.COMPANY_EMAIL_DOMAIN ?? "").trim().toLowerCase().replace(/^@/, ""),
);

function seedRolePermissions(p: Platform): void {
  const allActions = ["create", "read", "edit", "assign", "delete"] as const;
  const allModules = ["Users", "Permissions", "Jobs", "Training", "Certificates", "Testing", "Calibration", "Inspection", "Mapping"];

  // Super Admin: everything
  p.permissions.setRolePermissions(ROLES.SUPER_ADMIN, [
    ...allModules.flatMap((m) => allActions.map((a) => ({ module: m, action: a }))),
    { module: "Training", action: "attendance" },
    { module: "Training", action: "add_attendees" },
    { module: "Training", action: "edit_issued" },
    { module: "Training", action: "assign" },
    { module: "Training", action: "documents" },
    { module: "Invoice", action: "create" },
    { module: "Invoice", action: "monitor" },
    { module: "Reports", action: "read" },
  ]);
  p.permissions.fullAccessRoles.add(ROLES.SUPER_ADMIN);
  const officeTraining = [
    { module: "Training", action: "cancel" },
    { module: "Training", action: "attendance" },
    { module: "Training", action: "add_attendees" },
    { module: "Training", action: "assign" },
    { module: "Reports", action: "read" },
  ] as const;

  // Sales: can CREATE and read training jobs (your requirement)
  p.permissions.setRolePermissions(ROLES.SALES, [
    { module: "Training", action: "create" },
    { module: "Training", action: "read" },
    { module: "Training", action: "edit" },
    { module: "Testing", action: "create" },
    { module: "Testing", action: "read" },
    { module: "Calibration", action: "create" },
    { module: "Calibration", action: "read" },
    { module: "Inspection", action: "create" },
    { module: "Inspection", action: "read" },
    { module: "Mapping", action: "create" },
    { module: "Mapping", action: "read" },
    ...officeTraining,
  ]);

  // Office Admin: adds and assigns jobs, job forms, cancel requests, invoicing; only views certificates.
  // Trainees, attendance sheets and issuing certificates belong to the Office Coordinator.
  p.permissions.setRolePermissions(ROLES.ADMIN_STAFF, [
    { module: "Training", action: "create" },
    { module: "Training", action: "read" },
    { module: "Training", action: "edit" },
    { module: "Training", action: "assign" },
    { module: "Training", action: "cancel" },
    { module: "Certificates", action: "read" },
    { module: "Training", action: "documents" },
    { module: "Invoice", action: "create" },
    { module: "Mapping", action: "create" },
    { module: "Mapping", action: "read" },
    { module: "Mapping", action: "edit" },
    { module: "Reports", action: "read" },
  ]);

  // Office Coordinator: attendance, trainees, issues certificates
  p.permissions.setRolePermissions(ROLES.JOB_ASSISTANT, [
    { module: "Training", action: "read" },
    { module: "Training", action: "edit" },
    { module: "Certificates", action: "read" },
    { module: "Certificates", action: "edit" },
    { module: "Training", action: "edit_issued" },
    { module: "Testing", action: "read" },
    { module: "Calibration", action: "read" },
    { module: "Inspection", action: "read" },
    { module: "Mapping", action: "read" },
    { module: "Mapping", action: "edit" },
    ...officeTraining,
  ]);

  // Front Desk Staff: book new jobs at reception
  p.permissions.setRolePermissions(ROLES.FRONT_DESK, [
    { module: "Training", action: "create" },
    { module: "Training", action: "read" },
    { module: "Testing", action: "create" },
    { module: "Testing", action: "read" },
    { module: "Calibration", action: "create" },
    { module: "Calibration", action: "read" },
    { module: "Inspection", action: "create" },
    { module: "Inspection", action: "read" },
    { module: "Mapping", action: "create" },
    { module: "Mapping", action: "read" },
    { module: "Training", action: "cancel" },
    { module: "Training", action: "attendance" },
    { module: "Reports", action: "read" },
  ]);

  // Trainer: read + edit their jobs (add attendees, submit). NO create.
  p.permissions.setRolePermissions(ROLES.TRAINER, [
    { module: "Training", action: "read" },
    { module: "Training", action: "edit" },
    { module: "Training", action: "attendance" },
    { module: "Training", action: "add_attendees" },
    { module: "Certificates", action: "read" },
  ]);

  // Site Engineer: same as Trainer — works only the jobs assigned to them.
  p.permissions.setRolePermissions(ROLES.SITE_ENGINEER, [
    { module: "Training", action: "read" },
    { module: "Training", action: "edit" },
    { module: "Training", action: "add_attendees" },
  ]);

}

function ensureDemoUsers(p: Platform): void {
  const demos: Array<{ identifier: string; displayName: string; credential: string; roleIds: string[] }> = [
    { identifier: "admin", displayName: "Super Admin", credential: "admin", roleIds: [ROLES.SUPER_ADMIN] },
    { identifier: "office", displayName: "Office Admin", credential: "pw", roleIds: [ROLES.ADMIN_STAFF] },
    { identifier: "sales1", displayName: "Sales Person", credential: "pw", roleIds: [ROLES.SALES] },
    { identifier: "assistant1", displayName: "Office Coordinator", credential: "pw", roleIds: [ROLES.JOB_ASSISTANT] },
    { identifier: "frontdesk1", displayName: "Front Desk Staff", credential: "pw", roleIds: [ROLES.FRONT_DESK] },
    { identifier: "trainer1", displayName: "Trainer One", credential: "pw", roleIds: [ROLES.TRAINER] },
    { identifier: "engineer1", displayName: "Site Engineer One", credential: "pw", roleIds: [ROLES.SITE_ENGINEER] },
  ];
  // Only seed a brand-new install, so staff the admin deleted do not come back on restart.
  if (p.users.listUsers().length > 0) return;
  for (const u of demos) p.users.createUser(u);
}

let persistChain = Promise.resolve();
let persistMutating = false;
function schedulePersist(): void {
  persistChain = persistChain
    .then(() => savePlatformState(platform))
    .catch((err) => console.error("Could not save data:", err));
}

/** Cap request bodies. ID card photos arrive as data URLs, so this is generous
 *  but still bounded, to stop a huge upload exhausting server memory. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new ValidationError("request body too large", "body");
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new ValidationError("request body must be valid JSON", "body");
  }
}
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
  if (persistMutating && status < 400) schedulePersist();
}
function html(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]!);
}

function dataUrlBuffer(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

async function sendTrainingCardPdf(
  res: ServerResponse,
  job: TrainingJob,
  c: TrainingCertificate,
  verifyUrl?: string,
  designOnly = false
): Promise<void> {
  const trainee = job.attendees.find((item) => item.id === c.attendeeId);
  const logo = await readFile(join(__dirname, "ui", "logo.jpg"));
  const art = await readFile(join(__dirname, "ui", "id-card-blank.png"));
  const W = 465;
  const H = 293;
  const fileTag = designOnly ? "card-design" : "card";
  const doc = new PDFDocument({
    size: [W, H],
    margin: 0,
    info: { Title: designOnly ? `${c.certificateNo} ID card design` : `${c.certificateNo} ID card` },
  });
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${c.certificateNo.replace(/[^a-zA-Z0-9_-]/g, "_")}-${fileTag}.pdf"`,
  });
  doc.pipe(res);
  doc.image(art, 0, 0, { width: W, height: H });
  if (designOnly) {
    doc.end();
    return;
  }

  const navy = "#1e4b8f";
  try { doc.image(logo, W * 0.62, H * 0.025, { fit: [W * 0.28, H * 0.14], align: "right" }); } catch { /* logo optional */ }

  const nameX = W * 0.24;
  const nameW = W * 0.36;
  const name = (c.name || "").toUpperCase();
  doc.font("Helvetica-Bold");
  let nameSize = 13;
  while (nameSize > 7 && doc.fontSize(nameSize).widthOfString(name) > nameW) nameSize -= 0.4;
  const nameLines = doc.fontSize(nameSize).widthOfString(name) > nameW ? 2 : 1;
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(nameSize)
    .text(name, nameX, H * 0.25, { width: nameW, align: "center", height: nameLines === 1 ? 18 : 32 });
  const trade = (c.course || "").trim();
  doc.font("Helvetica");
  let tradeSize = 10;
  while (tradeSize > 7 && doc.fontSize(tradeSize).widthOfString(trade) > nameW) tradeSize -= 0.4;
  doc.fillColor("#111").font("Helvetica").fontSize(tradeSize)
    .text(trade, nameX, H * 0.38, { width: nameW, align: "center", height: 16 });

  const attendeeCompany = trainee?.company || "";
  const company = (c.company && c.company.trim().length > 1 ? c.company : "")
    || (job.certificateUnder && job.certificateUnder.trim().length > 1 ? job.certificateUnder : "")
    || attendeeCompany
    || job.customerName
    || "";
  const rows: Array<[string, string]> = [
    ["Certificate No", c.certificateNo || ""],
    ["Company", company],
    ["Training Date", c.trainingDate || ""],
    ["Expires on", c.expiresOn || ""],
  ];
  let y = H * 0.47;
  for (const [label, value] of rows) {
    doc.font("Helvetica").fontSize(8.5).fillColor("#4b5563")
      .text(label, nameX, y, { width: 86, height: 12, lineBreak: false });
    const valueText = `: ${value}`;
    doc.font("Helvetica-Bold");
    let size = 8.5;
    while (size > 6.5 && doc.fontSize(size).widthOfString(valueText) > nameW - 90) size -= 0.4;
    doc.fillColor("#111").font("Helvetica-Bold").fontSize(size)
      .text(valueText, nameX + 88, y, { width: nameW - 90, height: 12, lineBreak: false });
    y += 15;
  }

  const photoR = 58;
  const photoCx = 384;
  const photoCy = 132;
  const photoSrc = trainee?.photoDataUrl || "";
  doc.save();
  doc.circle(photoCx, photoCy, photoR).clip();
  if (photoSrc) {
    try {
      const side = photoR * 2;
      doc.image(dataUrlBuffer(photoSrc), photoCx - photoR, photoCy - photoR, {
        cover: [side, side * 1.75],
        align: "center",
        valign: "center",
      });
    } catch { /* cleared circle */ }
  }
  doc.restore();

  if (verifyUrl) {
    const qrPng = await QRCode.toBuffer(verifyUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 280,
      color: { dark: "#000000", light: "#ffffff" },
    });
    doc.rect(W * 0.30, H * 0.72, W * 0.26, H * 0.26).fill("#ffffff");
    doc.image(qrPng, W * 0.36, H * 0.76, { width: 52, height: 52 });
  }
  doc.end();
}

function sendJobDataPdf(res: ServerResponse, job: TrainingJob): void {
  const doc = new PDFDocument({ size: "A4", margin: 45, info: { Title: `${job.jobNo} submitted data` } });
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${job.jobNo.replace(/[^a-zA-Z0-9_-]/g, "_")}-submitted-data.pdf"`,
  });
  doc.pipe(res);
  const navy = "#29366d";
  const ensureSpace = (height = 60) => {
    if (doc.y + height > 790) doc.addPage();
  };
  const section = (title: string) => {
    ensureSpace(50);
    doc.moveDown(0.6).fillColor(navy).font("Helvetica-Bold").fontSize(15).text(title);
    doc.moveTo(45, doc.y + 3).lineTo(550, doc.y + 3).lineWidth(1).stroke("#d5a928");
    doc.moveDown(0.6);
  };
  const field = (label: string, value: unknown) => {
    ensureSpace(25);
    doc.fillColor("#333").font("Helvetica-Bold").fontSize(10).text(`${label}: `, { continued: true });
    doc.font("Helvetica").text(String(value || "-"));
  };

  doc.fillColor(navy).font("Helvetica-Bold").fontSize(22).text("WESTCAL Submitted Job Data", { align: "center" });
  doc.font("Helvetica").fontSize(10).text(`Generated ${new Date().toLocaleString("en-GB")}`, { align: "center" });
  section("Job details");
  field("Job number", job.jobNo); field("Service", job.serviceType); field("Status", job.status);
  field("Customer", job.customerName); field("Site address", job.address);
  field("Course / scope", job.course); field("Date and time", `${job.trainingDate} ${job.trainingTime || ""}`);
  field("Contact", job.contactNameNumber); field("Assigned to", job.assigneeName || job.trainerName);
  field("Job order number", job.jobOrderNo);
  field("Standard reference", job.standardReference); field("Client requirements", job.clientRequirements);

  section(`Trainees / attendance (${job.attendees.length})`);
  if (!job.attendees.length) field("Attendance", "No trainees recorded");
  job.attendees.forEach((a, index) => {
    ensureSpace(105);
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(11).text(`${index + 1}. ${a.name}`);
    field("Company", a.company); field("Emirates ID / Visa", a.idOrVisaNo);
    field("Date of birth", a.dateOfBirth); field("Nationality", a.nationality);
    field("Mobile", a.mobileNumber); field("Capture source", a.autoFetched ? "ID auto-fetch" : "Manual");
  });

  const review = job.contractReview;
  section("Customer feedback and review");
  field("Prepared by", review?.crPreparedBy); field("Training method", review?.trainingMethodUsed);
  field("Type of training", review?.typeOfTraining); field("Feedback", review?.customerFeedback || "Not recorded");
  field("Feedback notes", review?.customerFeedbackNotes);

  section("Supporting document checklist");
  const labels: Record<string, string> = {
    workPermit: "Work permit", trainingReports: "Training reports", do_: "DO",
    trainingRequestForm: "Training Request Form", trainingCertificates: "Training certificates",
    invoice: "Invoice", quotation: "Quotation", finalCertificatesCopy: "Final certificate copy",
    scanned: "Scanned", lpo: "LPO",
  };
  for (const [key, label] of Object.entries(labels)) {
    field(label, review?.attached?.[key as keyof typeof review.attached] ? "Attached / checked" : "Not provided");
  }
  section(`Uploaded files (${job.attachments.length})`);
  if (!job.attachments.length) field("Files", "No files uploaded");
  job.attachments.forEach((a, index) => field(`${index + 1}. ${a.type}`, a.fileName));
  doc.end();
}


function publicBase(req: IncomingMessage): string {
  const host = req.headers.host || `localhost:${PORT}`;
  const proto = String(req.headers["x-forwarded-proto"] || "http");
  return `${proto}://${host}`;
}

/** Wi-Fi address the phone can open. 127.0.0.1 / localhost never work from a camera. */
function lanBase(): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      const v4 = a.family === "IPv4" || (a.family as unknown) === 4;
      if (v4 && !a.internal) return `http://${a.address}:${PORT}`;
    }
  }
  return `http://127.0.0.1:${PORT}`;
}

function reachableBase(_req?: IncomingMessage): string {
  return lanBase();
}

function handleError(res: ServerResponse, err: unknown): void {
  if (err instanceof AppError) sendJson(res, err.httpStatus, err.toBody());
  else sendJson(res, 500, { code: "InternalError", message: String(err) });
}

/** Resolve the session from the Authorization header. Throws if invalid. */
function requireUser(req: IncomingMessage): { userId: string; roles: string[] } {
  const auth = req.headers["authorization"] ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new AuthenticationError("Sign in required");
  const { userId } = platform.auth.resolveSession(token);
  return { userId, roles: platform.permissions.getUserRoleIds(userId) };
}
/** Enforce a (module, action) permission for the caller. */
function requirePerm(userId: string, module: string, action: PermissionKey["action"]): void {
  if (!platform.permissions.authorize(userId, module, action)) {
    throw new AuthorizationError(`You do not have permission to ${action} ${module}`);
  }
}
function canAddTraineeNames(userId: string): boolean {
  return platform.permissions.getEffectivePermissions(userId).has("Training:add_attendees");
}
function requireAddTrainee(userId: string): void {
  if (!canAddTraineeNames(userId)) {
    throw new AuthorizationError("You do not have permission to add trainees");
  }
}
function requireSuper(userId: string): void {
  if (!platform.permissions.getUserRoleIds(userId).includes(ROLES.SUPER_ADMIN)) {
    throw new AuthorizationError("Only Super Admin can do this");
  }
}
/**
 * Once certificates are issued only users the Super Admin ticked for Training:edit_issued
 * may change the job; closed and cancelled jobs are Super Admin only.
 */
const ISSUED_STATUSES = new Set(["Approved", "Issued"]);
const CLOSED_STATUSES = new Set(["Closed", "Cancelled"]);
function requireEditable(userId: string, jobId: string): void {
  if (platform.permissions.getUserRoleIds(userId).includes(ROLES.SUPER_ADMIN)) return;
  const status = platform.training.getJob(jobId).status;
  const afterIssue = platform.permissions.authorize(userId, "Training", "edit_issued");
  if (CLOSED_STATUSES.has(status) || (ISSUED_STATUSES.has(status) && !afterIssue)) {
    throw new AuthorizationError(`This job is ${status} and can no longer be edited`);
  }
}
/** True for Trainers / Site Engineers who are not also office staff. */
function isFieldOnly(userId: string): boolean {
  const roles = platform.permissions.getUserRoleIds(userId);
  if (roles.includes(ROLES.SUPER_ADMIN) || roles.includes(ROLES.ADMIN_STAFF)) return false;
  return roles.includes(ROLES.TRAINER) || roles.includes(ROLES.SITE_ENGINEER);
}
/**
 * Field users may only touch the job assigned to them. Without this, holding
 * Training:edit would let any trainer or site engineer alter someone else's job
 * just by knowing its id.
 */
function requireAssignedIfFieldUser(userId: string, jobId: string): void {
  if (!isFieldOnly(userId)) return;
  const job = platform.training.getJob(jobId);
  if (job.assignedToId !== userId) {
    throw new AuthorizationError("This job is not assigned to you");
  }
}

/**
 * Module access the Super Admin ticks per user, stored as "Access:<Service>"
 * per-user grants. No Access grants means the user may use every module.
 */
const ACCESS_MODULE = "Access";
const SERVICE_MODULES = ["Testing", "Calibration", "Inspection", "Training", "Mapping", "Subcontract"];
function userModules(userId: string): string[] {
  return platform.permissions.getUserPermissions(userId)
    .filter((p) => p.module === ACCESS_MODULE)
    .map((p) => String(p.action));
}
function allowedServices(userId: string): string[] | null {
  if (platform.permissions.getUserRoleIds(userId).includes(ROLES.SUPER_ADMIN)) return null;
  const mods = userModules(userId);
  return mods.length ? mods : null;
}
function requireService(userId: string, serviceType: string | undefined): void {
  const allowed = allowedServices(userId);
  const svc = serviceType || "Training";
  if (allowed && !allowed.includes(svc)) {
    throw new AuthorizationError(`You do not have access to ${svc}`);
  }
}
const META_MODULE = "Meta";
const CUSTOM_MARKER = { module: META_MODULE, action: "custom" };
/** Replaces a user's ticked permissions and/or module list; whichever is undefined is kept. */
function setUserGrants(
  userId: string,
  perms: Array<{ module: string; action: string }> | undefined,
  modules: string[] | undefined,
): void {
  const current = platform.permissions.getUserPermissions(userId);
  const isGrant = (p: { module: string }) => p.module !== ACCESS_MODULE && p.module !== META_MODULE;
  const next = [
    ...(perms === undefined ? current.filter((p) => p.module !== ACCESS_MODULE) : [...perms.filter(isGrant), CUSTOM_MARKER]),
    ...(modules === undefined
      ? current.filter((p) => p.module === ACCESS_MODULE)
      : modules.filter((m) => SERVICE_MODULES.includes(m)).map((m) => ({ module: ACCESS_MODULE, action: m }))),
  ];
  platform.permissions.setUserPermissions(userId, next as PermissionKey[]);
}

/** Training permissions added later; users whose ticks were saved before get their role's defaults once. */
const NEW_TRAINING_KEYS = ["Training:cancel", "Training:attendance", "Training:add_attendees", "Reports:read"];
function migrateUserGrants(): void {
  for (const u of platform.users.listUsers()) {
    const own = platform.permissions.getUserPermissions(u.id);
    const keys = new Set(own.map((p) => `${p.module}:${p.action}`));
    if (keys.has("Meta:custom") || !own.some((p) => p.module !== ACCESS_MODULE)) continue;
    const roleKeys = new Set(
      u.roleIds.flatMap((r) => platform.permissions.getRolePermissions(r).map((p) => `${p.module}:${p.action}`)),
    );
    for (const k of NEW_TRAINING_KEYS) if (roleKeys.has(k)) keys.add(k);
    if (keys.has("Training:edit") && roleKeys.has("Training:add_attendees")) keys.add("Training:add_attendees");
    keys.add("Meta:custom");
    platform.permissions.setUserPermissions(
      u.id,
      [...keys].map((k) => {
        const [module, action] = k.split(":");
        return { module, action } as PermissionKey;
      }),
    );
  }
}
/** Job sheet, review form and work permit: the assigned field user, or office staff with Training:documents. */
function requireJobForms(userId: string, jobId: string): void {
  requirePerm(userId, "Training", "read");
  if (isFieldOnly(userId)) requireAssignedIfFieldUser(userId, jobId);
  else requirePerm(userId, "Training", "documents");
}
function requireAnyPerm(userId: string, keys: Array<[string, PermissionKey["action"]]>): void {
  if (!keys.some(([m, a]) => platform.permissions.authorize(userId, m, a))) {
    throw new AuthorizationError("You do not have permission to do this");
  }
}

/**
 * Origins allowed to call the API from a browser context.
 *
 * The packaged Android/iOS app runs its web layer from the device itself, so
 * its requests carry one of the Capacitor origins rather than our own. The list
 * is explicit — no wildcard — because these requests carry session tokens.
 * Add your production web origin here when the console gets a real domain.
 */
const ALLOWED_ORIGINS = new Set([
  "capacitor://localhost",   // iOS native shell
  "http://localhost",        // Android native shell
  "https://localhost",       // Android native shell (https scheme)
  "ionic://localhost",       // older Capacitor/Ionic shells
]);

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (typeof origin === "string" && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "600");
  }
}

/** Set LOG_REQUESTS=1 to log every request. Handy when a phone or emulator
 *  says it cannot reach the server and you need to know if it got here. */
const LOG_REQUESTS = process.env.LOG_REQUESTS === "1";

const WEB_DIST = join(__dirname, "..", "web", "dist");
const WEB_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

async function sendWebApp(path: string, res: ServerResponse): Promise<void> {
  const rel = normalize(decodeURIComponent(path.replace(/^\/app\/?/, ""))).replace(/^([/\\]|\.\.[/\\]?)+/, "");
  const file = rel && extname(rel) ? join(WEB_DIST, rel) : join(WEB_DIST, "index.html");
  if (!file.startsWith(WEB_DIST)) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const body = await readFile(file);
    const isAsset = rel.startsWith("assets");
    res.writeHead(200, {
      "Content-Type": WEB_TYPES[extname(file)] ?? "application/octet-stream",
      "Cache-Control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found. Build the web app with: cd web && npm run build");
  }
}

/** Serves the React build for a page route. */

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const path = url.pathname;
    const method = req.method ?? "GET";
    persistMutating = method === "POST" || method === "PATCH" || method === "DELETE";

    if (LOG_REQUESTS) {
      const origin = req.headers.origin ?? "-";
      console.log(`${new Date().toISOString().slice(11, 19)} ${method} ${path} origin=${origin}`);
    }

    applyCors(req, res);
    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // --- public: UI + sign-in + course list ---
    if (method === "GET" && (path === "/app" || path.startsWith("/app/"))) {
      await sendWebApp(path, res);
      return;
    }
    if (method === "GET" && (path === "/" || path === "/index.html")) {
      await sendWebApp("/app/", res);
      return;
    }
    const verifyQrMatch = path.match(/^\/verify\/([^/]+)\/qr\.png$/);
    if (method === "GET" && verifyQrMatch) {
      const ref = decodeURIComponent(verifyQrMatch[1]);
      const found = platform.training.findCertificateByVerificationRef(ref);
      if (!found) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("certificate not found");
        return;
      }
      const verifyUrl = `${reachableBase(req)}/verify/${encodeURIComponent(ref)}`;
      const png = await QRCode.toBuffer(verifyUrl, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 640,
        color: { dark: "#000000", light: "#ffffff" },
      });
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
      res.end(png);
      return;
    }
    const verifyMatch = path.match(/^\/verify\/([^/]+)$/);
    if (method === "GET" && verifyMatch) {
      const found = platform.training.findCertificateByVerificationRef(
        decodeURIComponent(verifyMatch[1])
      );
      if (!found) {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>Certificate not found</h1><p>This QR code is invalid or the document is no longer available.</p>");
        return;
      }
      const { job, certificate: c } = found;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(printedCertificateVerifyHtml(c, job));
      return;
    }
    const publicTrainingMatch = path.match(/^\/public\/training\/([^/]+)$/);
    if (method === "GET" && publicTrainingMatch) {
      try {
        const job = platform.training.getJob(decodeURIComponent(publicTrainingMatch[1]));
        const publicUrl = `${publicBase(req)}/public/training/${job.id}`;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(attendancePublicHtml(job, publicUrl));
      } catch {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>Training not found</h1>");
      }
      return;
    }
    if (method === "POST" && path.match(/^\/api\/public\/training\/([^/]+)\/id-fetch$/)) {
      try {
        const jobId = decodeURIComponent(path.split("/")[4]);
        platform.training.getJob(jobId);
        const b = await readBody(req);
        sendJson(res, 200, parseEmiratesId(b.ocrText ?? ""));
      } catch (err) { handleError(res, err); }
      return;
    }
    if (method === "PATCH" && path.match(/^\/api\/public\/training\/([^/]+)\/attendees\/([^/]+)\/signature$/)) {
      try {
        const parts = path.split("/");
        const att = platform.training.signPublicAttendee(decodeURIComponent(parts[4]), decodeURIComponent(parts[6]), (await readBody(req)).signature ?? "");
        sendJson(res, 200, { id: att.id, signed: !!att.signature });
      } catch (err) { handleError(res, err); }
      return;
    }
    if (method === "POST" && path.match(/^\/api\/public\/training\/([^/]+)\/attendees$/)) {
      try {
        const jobId = decodeURIComponent(path.split("/")[4]);
        const att = platform.training.joinViaPublicSheet(jobId, await readBody(req));
        sendJson(res, 201, { id: att.id, name: att.name, editToken: att.editToken, idOrVisaNo: att.idOrVisaNo });
      } catch (err) { handleError(res, err); }
      return;
    }
    const publicTrainingPdf = path.match(/^\/public\/training\/([^/]+)\/pdf$/);
    if (method === "GET" && publicTrainingPdf) {
      try {
        const job = platform.training.getJob(decodeURIComponent(publicTrainingPdf[1]));
        const publicUrl = `${publicBase(req)}/public/training/${job.id}`;
        await sendAttendanceSheetPdf(res, job, publicUrl);
      } catch {
        sendJson(res, 404, { code: "NotFoundError", message: "training not found" });
      }
      return;
    }
    const joinPage = path.match(/^\/join\/([^/]+)(?:\/([^/]+))?$/);
    if (method === "GET" && joinPage) {
      await sendWebApp(path, res);
      return;
    }
    if (method === "GET" && path.match(/^\/api\/public\/join\/([^/]+)\/slot\/([^/]+)$/)) {
      const parts = path.split("/");
      try { sendJson(res, 200, platform.training.publicSlotInfo(parts[4], parts[6])); }
      catch (err) { handleError(res, err); }
      return;
    }
    if (method === "GET" && path.match(/^\/api\/public\/join\/([^/]+)$/)) {
      const token = path.split("/")[4];
      try { sendJson(res, 200, platform.training.publicJoinInfo(token)); }
      catch (err) { handleError(res, err); }
      return;
    }
    if (method === "POST" && path.match(/^\/api\/public\/join\/([^/]+)\/id-fetch$/)) {
      try {
        const b = await readBody(req);
        platform.training.getJobByInviteToken(path.split("/")[4]);
        sendJson(res, 200, parseEmiratesId(b.ocrText ?? ""));
      } catch (err) { handleError(res, err); }
      return;
    }
    if (method === "POST" && path.match(/^\/api\/public\/join\/([^/]+)\/attendees$/)) {
      try {
        const token = path.split("/")[4];
        const att = platform.training.joinViaTraineeLink(token, await readBody(req));
        sendJson(res, 201, { id: att.id, name: att.name, editToken: att.editToken, idOrVisaNo: att.idOrVisaNo });
      } catch (err) { handleError(res, err); }
      return;
    }
    if (method === "PATCH" && path.match(/^\/api\/public\/join\/([^/]+)\/attendees\/([^/]+)$/)) {
      try {
        const parts = path.split("/");
        const att = platform.training.updateAttendeeByEditToken(parts[4], parts[6], await readBody(req));
        sendJson(res, 200, { id: att.id, name: att.name, editToken: att.editToken, idOrVisaNo: att.idOrVisaNo });
      } catch (err) { handleError(res, err); }
      return;
    }
    // --- the separate mobile app for Site Engineers / Trainers ---
    if (method === "GET" && (path === "/m" || path === "/m/" || path === "/mobile")) {
      await sendWebApp(path, res);
      return;
    }
    // PWA manifest + service worker so the mobile app installs to the home screen
    if (method === "GET" && path === "/m/manifest.webmanifest") {
      await sendWebApp("/app/manifest.webmanifest", res);
      return;
    }
    if (method === "GET" && path === "/m/sw.js") {
      await sendWebApp("/app/sw.js", res);
      return;
    }
    // Serve the company logo (used in sidebar, sign-in, favicon)
    if (method === "GET" && (path === "/logo.jpg" || path === "/favicon.ico")) {
      await sendWebApp("/app/logo.jpg", res);
      return;
    }
    if (method === "GET" && path === "/certificate-bg.png") {
      const img = await readFile(join(__dirname, "ui", "certificate-bg.png"));
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "max-age=86400" });
      res.end(img);
      return;
    }
    if (method === "GET" && path === "/certificate-achievement.png") {
      const img = await readFile(join(__dirname, "ui", "certificate-achievement.png"));
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "max-age=86400" });
      res.end(img);
      return;
    }
    if (method === "GET" && path === "/certificate-marks.png") {
      const img = await readFile(join(__dirname, "ui", "certificate-marks.png"));
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
      res.end(img);
      return;
    }
    if (method === "GET" && path === "/certificate-achievement-blank.png") {
      const img = await readFile(join(__dirname, "ui", "certificate-achievement-blank.png"));
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
      res.end(img);
      return;
    }
    const extraCert = path.match(/^\/certificates\/([^/]+)$/);
    if (method === "GET" && extraCert) {
      const name = decodeURIComponent(extraCert[1]).replace(/[/\\]/g, "");
      if (!/\.(png|jpe?g)$/i.test(name)) {
        res.writeHead(404);
        res.end();
        return;
      }
      try {
        const img = await readFile(join(CERTIFICATE_DESIGNS_DIR, name));
        res.writeHead(200, { "Content-Type": name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg", "Cache-Control": "max-age=86400" });
        res.end(img);
      } catch {
        res.writeHead(404);
        res.end();
      }
      return;
    }
    if (method === "POST" && path === "/api/sign-in") {
      const { identifier, credential } = await readBody(req);
      const { token } = platform.auth.signIn(identifier, credential);
      const userId = platform.auth.resolveSession(token).userId;
      const roles = platform.permissions.getUserRoleIds(userId);
      const perms = [...platform.permissions.getEffectivePermissions(userId)];
      const user = platform.users.getUser(userId);
      sendJson(res, 200, { token, userId, displayName: user.displayName, roles, perms, modules: allowedServices(userId) });
      return;
    }
    // --- public: Super Admin self-registration with email OTP ---
    if (method === "GET" && path === "/api/register/status") {
      sendJson(res, 200, { enabled: registration.enabled, domain: registration.companyDomain, email: registration.fixedEmail });
      return;
    }
    if (method === "POST" && path === "/api/register/start") {
      const b = await readBody(req);
      try {
        sendJson(res, 200, await registration.start(b));
      } catch (err) {
        if (err instanceof AppError) throw err;
        console.error("[register] could not send OTP email:", err);
        throw new ValidationError("Could not send the code email. Check the email address or try again later.");
      }
      return;
    }
    if (method === "POST" && path === "/api/register/resend") {
      const b = await readBody(req);
      try {
        sendJson(res, 200, await registration.resend(b.registrationId));
      } catch (err) {
        if (err instanceof AppError) throw err;
        console.error("[register] could not send OTP email:", err);
        throw new ValidationError("Could not send the code email. Try again later.");
      }
      return;
    }
    if (method === "POST" && path === "/api/register/verify") {
      const b = await readBody(req);
      const user = registration.verify(b.registrationId, b.code);
      console.log(`[register] new Super Admin ${user.identifier} <${user.email}>`);
      sendJson(res, 201, user);
      return;
    }
    if (method === "GET" && path === "/api/courses") {
      sendJson(res, 200, platform.courses.list());
      return;
    }
    if (method === "GET" && path === "/api/certificate-designs") {
      sendJson(res, 200, await listCertificateDesigns());
      return;
    }

    // --- everything below requires a valid session ---
    const { userId } = requireUser(req);

    const jobRoute = path.match(/^\/api\/training\/([^/]+)/);
    if (jobRoute && jobRoute[1] !== "next-job-order") {
      let job: TrainingJob | undefined;
      try { job = platform.training.getJob(jobRoute[1]); } catch { job = undefined; }
      if (job) requireService(userId, job.serviceType);
      if (isFieldOnly(userId) && /\/certificates(\/|$)/.test(path)) {
      throw new AuthorizationError("Certificates are handled by the office");
    }
    if (job && method !== "GET" && ["Submitted", "Approved", "Issued", "Closed"].includes(job.status) && isFieldOnly(userId)) {
        throw new AuthorizationError("This job was sent to admin and can no longer be edited");
      }
    }

    if (method === "GET" && path === "/api/me") {
      const user = platform.users.getUser(userId);
      sendJson(res, 200, {
        userId,
        displayName: user.displayName,
        roles: platform.permissions.getUserRoleIds(userId),
        perms: [...platform.permissions.getEffectivePermissions(userId)],
        modules: allowedServices(userId),
      });
      return;
    }

    // Users admin — Super Admin only
    if (method === "GET" && path === "/api/users") {
      requirePerm(userId, "Users", "read");
      sendJson(res, 200, platform.users.listUsers().map((u) => ({
        id: u.id, identifier: u.identifier, email: u.email ?? "", displayName: u.displayName, status: u.status,
        roleIds: u.roleIds,
        createdAt: u.createdAt,
        // effective (module, action) permissions this user holds
        permissions: [...platform.permissions.getEffectivePermissions(u.id)],
        modules: userModules(u.id),
      })));
      return;
    }
    if (method === "POST" && path === "/api/users") {
      requirePerm(userId, "Users", "create");
      const b = await readBody(req);
      const u = platform.users.createUser({
        identifier: b.identifier, displayName: b.displayName, credential: b.credential ?? "pw", roleIds: b.roleIds ?? [],
      });
      // Super Admin can assign granular create/read/edit/delete per module
      if (Array.isArray(b.permissions) || Array.isArray(b.modules)) {
        setUserGrants(u.id, Array.isArray(b.permissions) ? b.permissions : undefined, Array.isArray(b.modules) ? b.modules : undefined);
      }
      sendJson(res, 201, { id: u.id, identifier: u.identifier });
      return;
    }
    // Update a user's granular permissions
    const userPermMatch = path.match(/^\/api\/users\/([^/]+)\/permissions$/);
    if (method === "POST" && userPermMatch) {
      requirePerm(userId, "Users", "edit");
      const b = await readBody(req);
      setUserGrants(
        userPermMatch[1],
        Array.isArray(b.permissions) ? b.permissions : undefined,
        Array.isArray(b.modules) ? b.modules : undefined,
      );
      sendJson(res, 200, { ok: true });
      return;
    }

    // Update basic user information
    const userUpdateMatch = path.match(/^\/api\/users\/([^/]+)$/);
    if (method === "PUT" && userUpdateMatch) {
      requirePerm(userId, "Users", "edit");
      const b = await readBody(req);
      const user = platform.users.getUser(userUpdateMatch[1]);
      if (!user) {
        throw new NotFoundError("User not found");
      }
      
      // Update user properties
      if (b.displayName) user.displayName = String(b.displayName).trim();
      if (b.identifier) user.identifier = String(b.identifier).trim();
      if (b.email !== undefined) user.email = String(b.email).trim() || undefined;
      if (Array.isArray(b.roleIds)) user.roleIds = b.roleIds;
      
      sendJson(res, 200, { ok: true });
      return;
    }

    const userPwMatch = path.match(/^\/api\/users\/([^/]+)\/password$/);
    if (method === "POST" && userPwMatch) {
      requireSuper(userId);
      const pw = String((await readBody(req)).password ?? "");
      if (pw.length < 6 || !/[a-z]/i.test(pw) || !/[^a-z0-9]/i.test(pw)) {
        throw new ValidationError("Password needs 6+ characters with a letter and a special character", "password");
      }
      platform.users.setCredential(userPwMatch[1], pw);
      sendJson(res, 200, { ok: true });
      return;
    }
    // Delete a user
    const userDelMatch = path.match(/^\/api\/users\/([^/]+)$/);
    if (method === "DELETE" && userDelMatch) {
      requirePerm(userId, "Users", "delete");
      if (userDelMatch[1] === userId) throw new AuthorizationError("You cannot delete your own account");
      platform.users.deleteUser(userDelMatch[1]);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && path === "/api/courses") {
      if (!platform.permissions.getUserRoleIds(userId).includes(ROLES.SUPER_ADMIN)) {
        requirePerm(userId, "Training", "create");
      }
      const b = await readBody(req);
      sendJson(res, 201, platform.courses.add(b.name ?? "", b.description ?? ""));
      return;
    }
    const courseDel = path.match(/^\/api\/courses\/([^/]+)$/);
    if (method === "DELETE" && courseDel) {
      requireSuper(userId);
      platform.courses.remove(courseDel[1]);
      sendJson(res, 200, { ok: true });
      return;
    }

    // Notifications for the signed-in user (drives the mobile notification)
    if (method === "GET" && path === "/api/notifications") {
      sendJson(res, 200, platform.training.getNotifications(userId));
      return;
    }
    if (method === "POST" && path === "/api/notifications/read") {
      platform.training.markNotificationsRead(userId);
      sendJson(res, 200, { ok: true });
      return;
    }

    // Training list — anyone with Training:read
    if (method === "GET" && path === "/api/training") {
      requirePerm(userId, "Training", "read");
      let jobs = platform.training.listJobs();
      const roles = platform.permissions.getUserRoleIds(userId);
      // Trainers and Site Engineers only see jobs assigned to them
      const isFieldUser = roles.includes(ROLES.TRAINER) || roles.includes(ROLES.SITE_ENGINEER);
      if (isFieldUser && !roles.includes(ROLES.SUPER_ADMIN) && !roles.includes(ROLES.ADMIN_STAFF)) {
        jobs = platform.training.listForAssignee(userId);
      }
      const allowed = allowedServices(userId);
      if (allowed) jobs = jobs.filter((j) => allowed.includes(j.serviceType || "Training"));
      // Field staff only learn that a job was submitted, never whether certificates were issued.
      if (isFieldOnly(userId)) {
        const afterSubmit = new Set(["Approved", "Issued", "Closed"]);
        jobs = jobs.map((j) => ({
          ...j,
          status: afterSubmit.has(j.status) ? "Submitted" : j.status,
          certificates: [],
          invoiceNo: undefined,
        })) as typeof jobs;
      }
      sendJson(res, 200, jobs);
      return;
    }
    if (method === "GET" && path === "/api/training/next-job-order") {
      requirePerm(userId, "Training", "create");
      const serviceType = (url.searchParams.get("serviceType") || "Training") as
        "Calibration" | "Inspection" | "Testing" | "Training" | "Mapping";
      requireService(userId, serviceType);
      sendJson(res, 200, { jobOrderNo: platform.training.peekNextJobOrderNo(serviceType) });
      return;
    }
    const certificateEdit = path.match(/^\/api\/training\/([^/]+)\/certificates\/([^/]+)$/);
    if (method === "PATCH" && certificateEdit) {
      requirePerm(userId, "Certificates", "edit");
      sendJson(res, 200, platform.training.editCertificate(certificateEdit[1], certificateEdit[2], await readBody(req)));
      return;
    }
    const certificatePdfMatch = path.match(/^\/api\/training\/([^/]+)\/certificates\/([^/]+)\/pdf$/);
    if (method === "GET" && certificatePdfMatch) {
      requireAnyPerm(userId, [["Certificates", "read"], ["Certificates", "edit"]]);
      requireAssignedIfFieldUser(userId, certificatePdfMatch[1]);
      const job = platform.training.getJob(certificatePdfMatch[1]);
      const certificate = job.certificates.find((item) => item.id === certificatePdfMatch[2]);
      if (!certificate) {
        sendJson(res, 404, { code: "NotFoundError", message: "certificate not found" });
        return;
      }
      await sendTrainingCertificatePdf(
        res,
        job,
        certificate,
        `${reachableBase(req)}/verify/${encodeURIComponent(certificate.verificationRef)}`
      );
      return;
    }
    const certificateNoPhotoPdfMatch = path.match(/^\/api\/training\/([^/]+)\/certificates\/([^/]+)\/nophoto-pdf$/);
    if (method === "GET" && certificateNoPhotoPdfMatch) {
      requireAnyPerm(userId, [["Certificates", "read"], ["Certificates", "edit"]]);
      requireAssignedIfFieldUser(userId, certificateNoPhotoPdfMatch[1]);
      const job = platform.training.getJob(certificateNoPhotoPdfMatch[1]);
      const certificate = job.certificates.find((item) => item.id === certificateNoPhotoPdfMatch[2]);
      if (!certificate) {
        sendJson(res, 404, { code: "NotFoundError", message: "certificate not found" });
        return;
      }
      await sendTrainingCertificatePdf(
        res,
        job,
        certificate,
        `${reachableBase(req)}/verify/${encodeURIComponent(certificate.verificationRef)}`,
        true
      );
      return;
    }
    const certificateLayoutPdfMatch = path.match(/^\/api\/training\/([^/]+)\/certificates\/([^/]+)\/layout-pdf$/);
    if (method === "GET" && certificateLayoutPdfMatch) {
      requireAnyPerm(userId, [["Certificates", "read"], ["Certificates", "edit"]]);
      requireAssignedIfFieldUser(userId, certificateLayoutPdfMatch[1]);
      const job = platform.training.getJob(certificateLayoutPdfMatch[1]);
      const certificate = job.certificates.find((item) => item.id === certificateLayoutPdfMatch[2]);
      if (!certificate) {
        sendJson(res, 404, { code: "NotFoundError", message: "certificate not found" });
        return;
      }
      await sendTrainingCertificateLayoutPdf(res, job, certificate);
      return;
    }
    const certificateContentPdfMatch = path.match(/^\/api\/training\/([^/]+)\/certificates\/([^/]+)\/content-pdf$/);
    if (method === "GET" && certificateContentPdfMatch) {
      requireAnyPerm(userId, [["Certificates", "read"], ["Certificates", "edit"]]);
      requireAssignedIfFieldUser(userId, certificateContentPdfMatch[1]);
      const job = platform.training.getJob(certificateContentPdfMatch[1]);
      const certificate = job.certificates.find((item) => item.id === certificateContentPdfMatch[2]);
      if (!certificate) {
        sendJson(res, 404, { code: "NotFoundError", message: "certificate not found" });
        return;
      }
      await sendTrainingCertificateContentPdf(
        res,
        job,
        certificate,
        `${reachableBase(req)}/verify/${encodeURIComponent(certificate.verificationRef)}`
      );
      return;
    }
    const cardPdfMatch = path.match(/^\/api\/training\/([^/]+)\/certificates\/([^/]+)\/card-pdf$/);
    if (method === "GET" && cardPdfMatch) {
      requireAnyPerm(userId, [["Certificates", "read"], ["Certificates", "edit"]]);
      requireAssignedIfFieldUser(userId, cardPdfMatch[1]);
      const job = platform.training.getJob(cardPdfMatch[1]);
      const certificate = job.certificates.find((item) => item.id === cardPdfMatch[2]);
      if (!certificate) {
        sendJson(res, 404, { code: "NotFoundError", message: "certificate not found" });
        return;
      }
      await sendTrainingCardPdf(
        res,
        job,
        certificate,
        `${reachableBase(req)}/verify/${encodeURIComponent(certificate.verificationRef)}`
      );
      return;
    }
    const cardLayoutPdfMatch = path.match(/^\/api\/training\/([^/]+)\/certificates\/([^/]+)\/card-layout-pdf$/);
    if (method === "GET" && cardLayoutPdfMatch) {
      requireAnyPerm(userId, [["Certificates", "read"], ["Certificates", "edit"]]);
      requireAssignedIfFieldUser(userId, cardLayoutPdfMatch[1]);
      const job = platform.training.getJob(cardLayoutPdfMatch[1]);
      const certificate = job.certificates.find((item) => item.id === cardLayoutPdfMatch[2]);
      if (!certificate) {
        sendJson(res, 404, { code: "NotFoundError", message: "certificate not found" });
        return;
      }
      await sendTrainingCardPdf(res, job, certificate, undefined, true);
      return;
    }
    const protocolMatch = path.match(/^\/api\/training\/([^/]+)\/protocol$/);
    if (method === "GET" && protocolMatch) {
      requirePerm(userId, "Training", "read");
      requireAssignedIfFieldUser(userId, protocolMatch[1]);
      const job = platform.training.getJob(protocolMatch[1]);
      if (job.serviceType !== "Mapping") {
        sendJson(res, 400, { code: "ValidationError", message: "protocol is only for mapping jobs" });
        return;
      }
      await sendMappingProtocol(res, job);
      return;
    }
    const jobSheetPdfMatch = path.match(/^\/api\/training\/([^/]+)\/job-sheet-pdf$/);
    if (method === "GET" && jobSheetPdfMatch) {
      requireJobForms(userId, jobSheetPdfMatch[1]);
      await sendAssignedJobSheetPdf(res, platform.training.getJob(jobSheetPdfMatch[1]));
      return;
    }
    const jobDataPdfMatch = path.match(/^\/api\/training\/([^/]+)\/data-pdf$/);
    if (method === "GET" && jobDataPdfMatch) {
      requirePerm(userId, "Training", "read");
      requireAssignedIfFieldUser(userId, jobDataPdfMatch[1]);
      sendJobDataPdf(res, platform.training.getJob(jobDataPdfMatch[1]));
      return;
    }
    const attendancePdfMatch = path.match(/^\/api\/training\/([^/]+)\/attendance-pdf$/);
    if (method === "GET" && attendancePdfMatch) {
      requirePerm(userId, "Training", "attendance");
      requireAssignedIfFieldUser(userId, attendancePdfMatch[1]);
      const job = platform.training.getJob(attendancePdfMatch[1]);
      await sendAttendanceSheetPdf(res, job, `${publicBase(req)}/public/training/${job.id}`);
      return;
    }
    const workPermitPdfMatch = path.match(/^\/api\/training\/([^/]+)\/work-permit-pdf$/);
    if (method === "GET" && workPermitPdfMatch) {
      requireJobForms(userId, workPermitPdfMatch[1]);
      await sendWorkPermitPdf(res, platform.training.getJob(workPermitPdfMatch[1]));
      return;
    }
    const reviewPdfMatch = path.match(/^\/api\/training\/([^/]+)\/review-pdf$/);
    if (method === "GET" && reviewPdfMatch) {
      requireJobForms(userId, reviewPdfMatch[1]);
      await sendContractReviewPdf(res, platform.training.getJob(reviewPdfMatch[1]));
      return;
    }
    // Create job — Sales & Admin only (Training:create)
    if (method === "POST" && path === "/api/training") {
      requirePerm(userId, "Training", "create");
      const b = await readBody(req);
      requireService(userId, b.serviceType);
      const job = platform.training.createJob({
        serviceType: b.serviceType, location: b.location,
        course: b.course, courses: b.courses, customerName: b.customerName, companies: b.companies,
        certificateUnder: b.certificateUnder, certifiedBy: b.certifiedBy,
        trainingDate: b.trainingDate,
        trainingDateTo: b.trainingDateTo,
        trainingTime: b.trainingTime,
        mode: b.mode ?? "Onsite", trainerName: b.trainerName, createdById: userId,
        address: b.address, trnNo: b.trnNo, contactNameNumber: b.contactNameNumber,
        salesPerson: b.salesPerson, standardReference: b.standardReference,
        typeOfTraining: b.typeOfTraining, clientRequirements: b.clientRequirements,
        workStatus: b.workStatus,
        requiredDateForService: b.requiredDateForService, handedOverTo: b.handedOverTo,
        workCodeTraining: b.workCodeTraining, workCodeCertification: b.workCodeCertification,
        workCodeCalibration: b.workCodeCalibration, workCodeSupply: b.workCodeSupply, workCodeRepairing: b.workCodeRepairing,
        mappingType: b.mappingType, mappingRange: b.mappingRange, protocolNotes: b.protocolNotes,
        assetName: b.assetName, seasonYear: b.seasonYear, engineerDesignation: b.engineerDesignation,
        protocolEngineerName: b.protocolEngineerName, protocolNumber: b.protocolNumber,
        protocolPreparedDate: b.protocolPreparedDate, protocolPerson1: b.protocolPerson1,
        protocolDesignationP1: b.protocolDesignationP1, protocolCompanyName: b.protocolCompanyName,
        protocolPerson2: b.protocolPerson2, protocolDesignationP2: b.protocolDesignationP2,
        protocolPerson3: b.protocolPerson3, protocolDesignationP3: b.protocolDesignationP3,
        mappingHeadName: b.mappingHeadName, assetDimension: b.assetDimension,
        resultsAddedDate: b.resultsAddedDate, dataAddedDate: b.dataAddedDate, testEndTime: b.testEndTime,
        loggerProductName: b.loggerProductName, softwareProductName: b.softwareProductName,
        minTempRange: b.minTempRange, maxTempRange: b.maxTempRange, maxHumRange: b.maxHumRange,
        layoutImageDataUrl: b.layoutImageDataUrl,
        mappingDays: b.mappingDays, mappingStartDate: b.mappingStartDate, mappingEndDate: b.mappingEndDate,
        assetSetPoint: b.assetSetPoint, loggerTotal: b.loggerTotal, loggerMinimum: b.loggerMinimum,
        loggerLocations: b.loggerLocations,
        tempResults: b.tempResults,
        humResults: b.humResults,
        protocolChanges: b.protocolChanges,
        lineItems: b.lineItems,
      });
      sendJson(res, 201, job);
      return;
    }

    // Edit a job (Training:edit)
    const editMatch = path.match(/^\/api\/training\/([^/]+)$/);
    if (method === "PATCH" && editMatch) {
      requirePerm(userId, "Training", "edit");
      const b = await readBody(req);
      requireAssignedIfFieldUser(userId, editMatch[1]);
      requireEditable(userId, editMatch[1]);
      sendJson(res, 200, platform.training.editJob(editMatch[1], b));
      return;
    }
    // Delete a job (Training:delete)
    if (method === "DELETE" && editMatch) {
      requirePerm(userId, "Training", "delete");
      const roles = platform.permissions.getUserRoleIds(userId);
      if (!roles.includes(ROLES.SUPER_ADMIN)) {
        throw new AuthorizationError("Only Super Admin can delete a job");
      }
      platform.training.deleteJob(editMatch[1]);
      sendJson(res, 200, { ok: true });
      return;
    }
    const cancelMatch = path.match(/^\/api\/training\/([^/]+)\/cancel$/);
    // Only the Super Admin cancels; it uses the staff member's reason unless a new one is given.
    if (method === "POST" && cancelMatch) {
      requireSuper(userId);
      const b = await readBody(req);
      const actor = platform.users.getUser(userId);
      const pending = platform.training.getJob(cancelMatch[1]).cancelRequest;
      const reason = String(b.reason ?? "").trim() || pending?.reason || "";
      const job = platform.training.cancelJob(cancelMatch[1], reason, actor.displayName);
      if (pending && pending.requestedById !== actor.id) {
        platform.training.notifyUser(pending.requestedById, `Cancel request for ${job.jobNo} was approved`, job.id);
      }
      sendJson(res, 200, job);
      return;
    }
    const cancelRequestMatch = path.match(/^\/api\/training\/([^/]+)\/cancel-request$/);
    if (method === "POST" && cancelRequestMatch) {
      requirePerm(userId, "Training", "cancel");
      const b = await readBody(req);
      const actor = platform.users.getUser(userId);
      const job = platform.training.requestCancel(cancelRequestMatch[1], b.reason ?? "", actor.displayName, actor.id);
      for (const u of platform.users.listUsers()) {
        if (u.id !== actor.id && platform.permissions.getUserRoleIds(u.id).includes(ROLES.SUPER_ADMIN)) {
          platform.training.notifyUser(
            u.id,
            `${actor.displayName} asked to cancel ${job.jobNo}: ${job.cancelRequest?.reason}`,
            job.id
          );
        }
      }
      sendJson(res, 200, job);
      return;
    }
    const cancelRejectMatch = path.match(/^\/api\/training\/([^/]+)\/cancel-request\/reject$/);
    if (method === "POST" && cancelRejectMatch) {
      requireSuper(userId);
      const actor = platform.users.getUser(userId);
      sendJson(res, 200, platform.training.rejectCancelRequest(cancelRejectMatch[1], actor.displayName));
      return;
    }

    const resultMatch = path.match(/^\/api\/training\/([^/]+)\/results$/);
    if (method === "POST" && resultMatch) {
      const service = platform.training.getJob(resultMatch[1]).serviceType || "Training";
      requireAnyPerm(userId, [[service, "edit"], ["Training", "edit"]]);
      requireAssignedIfFieldUser(userId, resultMatch[1]);
      requireEditable(userId, resultMatch[1]);
      sendJson(res, 200, platform.training.recordItemResult(resultMatch[1], await readBody(req)));
      return;
    }

    const assignMatch = path.match(/^\/api\/training\/([^/]+)\/assign$/);
    
    // Office staff pick who to assign — trainers and site engineers only.
    if (method === "GET" && path === "/api/assignees") {
      requireAnyPerm(userId, [["Training", "create"], ["Training", "assign"], ["Training", "edit"]]);
      if (isFieldOnly(userId)) throw new AuthorizationError("Office staff only");
      
      const allUsers = platform.users.listUsers();
      const assignees = allUsers
        .filter((u) => {
          const roles = platform.permissions.getUserRoleIds(u.id);
          const isActive = u.status === "Active";
          const hasTrainerRole = roles.includes(ROLES.TRAINER);
          const hasSiteEngineerRole = roles.includes(ROLES.SITE_ENGINEER);
          return isActive && (hasTrainerRole || hasSiteEngineerRole);
        })
        .map((u) => {
          const roles = platform.permissions.getUserRoleIds(u.id);
          const roleName = roles.includes(ROLES.TRAINER) ? "Trainer" : "Site Engineer";
          return {
            id: u.id,
            displayName: u.displayName,
            roleName: roleName,
          };
        });
      
      sendJson(res, 200, assignees);
      return;
    }
    
    if (method === "POST" && assignMatch) {
      requireAnyPerm(userId, [["Training", "create"], ["Training", "assign"]]);
      requireEditable(userId, assignMatch[1]);
      const b = await readBody(req);
      // `trainerId` kept for older callers; `assigneeId` is the current name
      const assigneeId = b.assigneeId ?? b.trainerId;
      const assignee = platform.users.listUsers().find((u) => u.id === assigneeId);
      sendJson(res, 200, platform.training.assignJob(assignMatch[1], assigneeId, assignee?.displayName ?? ""));
      return;
    }
    const idFetchMatch = path.match(/^\/api\/training\/([^/]+)\/id-fetch$/);
    if (method === "POST" && idFetchMatch) {
      requireAddTrainee(userId);
      requireAssignedIfFieldUser(userId, idFetchMatch[1]);
      requireEditable(userId, idFetchMatch[1]);
      const b = await readBody(req);
      sendJson(res, 200, parseEmiratesId(b.ocrText ?? ""));
      return;
    }
    const attendeeMatch = path.match(/^\/api\/training\/([^/]+)\/attendees$/);
    if (method === "POST" && attendeeMatch) {
      requireAddTrainee(userId);
      requireAssignedIfFieldUser(userId, attendeeMatch[1]);
      requireEditable(userId, attendeeMatch[1]);
      const added = platform.training.addAttendeeFromId(attendeeMatch[1], await readBody(req));
      await platform.training.issueMissingCertificates(attendeeMatch[1]);
      sendJson(res, 201, added);
      const addedJob = platform.training.getJob(attendeeMatch[1]);
      const actor = platform.users.getUser(userId);
      const last = addedJob.attendees[addedJob.attendees.length - 1];
      if (addedJob.assignedToId && addedJob.assignedToId !== userId) {
        platform.training.notifyUser(
          addedJob.assignedToId,
          `${last?.name || "A trainee"} was added to attendance for ${addedJob.jobNo} by ${actor.displayName}`,
          addedJob.id
        );
      }
      return;
    }
    const attendeeEdit = path.match(/^\/api\/training\/([^/]+)\/attendees\/([^/]+)$/);
    if (method === "PATCH" && attendeeEdit) {
      requireAddTrainee(userId);
      requireAssignedIfFieldUser(userId, attendeeEdit[1]);
      requireEditable(userId, attendeeEdit[1]);
      sendJson(res, 200, platform.training.updateAttendee(attendeeEdit[1], attendeeEdit[2], await readBody(req)));
      return;
    }
    if (method === "POST" && path.match(/^\/api\/training\/([^/]+)\/attendance-meta$/)) {
      const jobId = path.split("/")[3];
      if (!canAddTraineeNames(userId)) {
        throw new AuthorizationError("You do not have permission to fill the attendance sheet");
      }
      requireAssignedIfFieldUser(userId, jobId);
      requireEditable(userId, jobId);
      sendJson(res, 200, platform.training.saveAttendanceMeta(jobId, await readBody(req)));
      return;
    }
    const reviewMatch = path.match(/^\/api\/training\/([^/]+)\/review$/);
    if (method === "POST" && reviewMatch) {
      requirePerm(userId, "Training", "edit");
      requireAssignedIfFieldUser(userId, reviewMatch[1]);
      requireEditable(userId, reviewMatch[1]);
      sendJson(res, 200, platform.training.saveContractReview(reviewMatch[1], await readBody(req)));
      return;
    }
    const attachmentMatch = path.match(/^\/api\/training\/([^/]+)\/attachments$/);
    if (method === "POST" && attachmentMatch) {
      requirePerm(userId, "Training", "edit");
      requireAssignedIfFieldUser(userId, attachmentMatch[1]);
      requireEditable(userId, attachmentMatch[1]);
      const b = await readBody(req);
      sendJson(res, 201, platform.training.addAttachment(attachmentMatch[1], {
        type: b.type,
        fileName: b.fileName,
        dataUrl: b.dataUrl,
        uploadedById: userId,
      }));
      return;
    }
    const submitMatch = path.match(/^\/api\/training\/([^/]+)\/submit$/);
    if (method === "POST" && submitMatch) {
      if (!canAddTraineeNames(userId)) {
        throw new AuthorizationError("You do not have permission to submit training jobs");
      }
      // For field users (trainers), check if job is assigned to them, but be more lenient
      const job = platform.training.getJob(submitMatch[1]);
      if (isFieldOnly(userId) && job.assignedToId && job.assignedToId !== userId) {
        throw new AuthorizationError("This job is not assigned to you");
      }
      const submittedJob = platform.training.submitForApproval(submitMatch[1]);
      // notify every admin that a job is waiting for approval
      for (const u of platform.users.listUsers()) {
        const roles = platform.permissions.getUserRoleIds(u.id);
        if (roles.includes(ROLES.SUPER_ADMIN) || roles.includes(ROLES.ADMIN_STAFF)) {
          platform.training.notifyUser(u.id, `Job ${submittedJob.jobNo} submitted for approval`, submittedJob.id);
        }
      }
      sendJson(res, 200, submittedJob);
      return;
    }
    // Approve/reject — Admin only (Certificates:read is admin/super here; use Users perm as admin marker)
    const approveMatch = path.match(/^\/api\/training\/([^/]+)\/approve$/);
    if (method === "POST" && approveMatch) {
      if (!platform.permissions.authorize(userId, "Certificates", "edit")) {
        throw new AuthorizationError("You do not have permission to issue certificates");
      }
      sendJson(res, 200, await platform.training.approve(approveMatch[1], userId, (await readBody(req)).design));
      return;
    }
    const rejectMatch = path.match(/^\/api\/training\/([^/]+)\/reject$/);
    if (method === "POST" && rejectMatch) {
      if (!platform.permissions.authorize(userId, "Certificates", "edit")) {
        throw new AuthorizationError("You do not have permission to return this job");
      }
      const b = await readBody(req);
      sendJson(res, 200, platform.training.reject(rejectMatch[1], b.reason ?? ""));
      return;
    }

    // Add Invoice Number and Close Job - Office Admin only
    const invoiceMatch = path.match(/^\/api\/training\/([^/]+)\/invoice$/);
    if (method === "POST" && invoiceMatch) {
      requirePerm(userId, "Invoice", "create");
      if (isFieldOnly(userId)) throw new AuthorizationError("Office staff only");
      const b = await readBody(req);
      sendJson(res, 200, platform.training.addInvoiceAndClose(invoiceMatch[1], b.invoiceNumber, userId));
      return;
    }

    // Invoice Statistics - Super Admin monitoring
    if (method === "GET" && path === "/api/training/invoice-stats") {
      requirePerm(userId, "Invoice", "monitor");
      sendJson(res, 200, platform.training.getInvoiceStats());
      return;
    }

    sendJson(res, 404, { code: "NotFoundError", message: "route not found" });
  } catch (err) {
    handleError(res, err);
  }
}

const httpsServer = createHttpsServer(
  {
    pfx: readFileSync(join(__dirname, "..", "data", "dev-https.pfx")),
    passphrase: "westcal",
  },
  (req, res) => { void handleRequest(req, res); }
);
const httpServer = createServer((req, res) => { void handleRequest(req, res); });
/** Phone cameras open https. Office PCs still use http. Same port serves both. */
const server = createNetServer((socket) => {
  const remote = socket.remoteAddress ?? "";
  socket.once("data", (buffer) => {
    const secure = buffer[0] === 22;
    if (!remote.endsWith("127.0.0.1") && remote !== "::1") {
      console.log(`Phone connected ${remote} ${secure ? "https" : "http"}`);
    }
    socket.pause();
    socket.unshift(buffer);
    (secure ? httpsServer : httpServer).emit("connection", socket);
    process.nextTick(() => socket.resume());
  });
  socket.on("error", () => { /* phone closed mid-handshake */ });
});

async function start(): Promise<void> {
  const restored = await loadPlatformState(platform);
  ensureDemoUsers(platform);
  migrateUserGrants();
  const relinked = platform.training.relinkMissingAssignees(platform.users.listUsers());
  if (relinked) console.log(`Re-linked ${relinked} job(s) to current trainer / engineer logins.`);
  schedulePersist();
  if (restored) console.log(`Restored ${restored} job(s) from previous session.`);
  else console.log("No saved jobs yet. New jobs, trainees and certificates are written to disk.");
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`\nWestcal Platform running at http://127.0.0.1:${PORT}`);
    for (const addrs of Object.values(os.networkInterfaces())) {
      for (const a of addrs ?? []) {
        const v4 = a.family === "IPv4" || (a.family as unknown) === 4;
        if (v4 && !a.internal) console.log(`Phone / QR scan URL:            http://${a.address}:${PORT}`);
      }
    }
    console.log("Field PWA (Site Engineer):       http://localhost:3000/m  engineer1 / pw");
    console.log("Field PWA (Trainer):             http://localhost:3000/m  trainer1 / pw");
    console.log(`MySQL database:                  ${MYSQL_DATABASE} on ${MYSQL_HOST}:${MYSQL_PORT}`);
    console.log(`Data file (kept on restart):     ${DATA_FILE}\n`);
  });
}

function flushAndExit(): void {
  savePlatformState(platform)
    .catch((err) => console.error("Could not save data:", err))
    .finally(() => process.exit(0));
}
process.on("SIGINT", flushAndExit);
process.on("SIGTERM", flushAndExit);

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
