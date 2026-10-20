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
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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
import { TrainingService, type TrainingCertificate, type TrainingJob } from "./modules/training/training.js";
import type { PermissionKey } from "./modules/permission/permission.js";
import { attendancePublicHtml, sendAttendanceSheetPdf } from "./modules/training/attendanceSheet.js";
import { sendAssignedJobSheetPdf, sendContractReviewPdf, sendWorkPermitPdf } from "./modules/training/trainingForms.js";
import { sendMappingProtocol } from "./modules/training/mappingProtocol.js";
import { sendTrainingCertificatePdf, sendTrainingCertificateContentPdf, sendTrainingCertificateLayoutPdf, listCertificateDesigns, CERTIFICATE_DESIGNS_DIR, printedCertificateVerifyHtml } from "./modules/training/certificateTemplate.js";
import { sendOldCertificateDocx } from "./modules/training/oldCertificateDocx.js";
import { sendQannatiCertificateDocx } from "./modules/training/qannatiCertificateDocx.js";
import { sendOldTrainingCardPdf } from "./modules/training/oldIdCard.js";

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
    { module: "Mapping", action: "add_rows" },
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
    { module: "Mapping", action: "add_rows" },
    ...officeTraining,
  ]);

  // Office Admin: adds and assigns jobs, job forms, cancel requests, invoicing.
  // After certificates are issued, this role only watches / downloads them.
  // Trainees, attendance and issuing belong to the Certificate Coordinator.
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
    { module: "Mapping", action: "add_rows" },
    { module: "Reports", action: "read" },
  ]);

  // Certificate Coordinator: receives trainer submissions, attendance, trainees, issues certificates
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
    { module: "Mapping", action: "add_rows" },
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
    { module: "Mapping", action: "add_rows" },
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
    { identifier: "assistant1", displayName: "Certificate Coordinator", credential: "pw", roleIds: [ROLES.JOB_ASSISTANT] },
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
let persistTimer: ReturnType<typeof setTimeout> | undefined;
function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    persistChain = persistChain
      .then(() => savePlatformState(platform))
      .catch((err) => console.error("Could not save data:", err));
  }, 400);
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

function imagePixelSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o < buf.length - 8) {
      if (buf[o] !== 0xff) { o++; continue; }
      const marker = buf[o + 1];
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
      }
      const len = buf.readUInt16BE(o + 2);
      if (!len) break;
      o += 2 + len;
    }
  }
  return null;
}

/** Print the whole photo in its own shape. A wide Emirates ID uses only the face. */
function drawIdPhoto(doc: PDFDocument, buf: Buffer, photoX: number, photoY: number, photoW: number, photoH: number): void {
  const size = imagePixelSize(buf);
  const idCard = size && size.w > size.h * 1.15;
  doc.save();
  doc.rect(photoX, photoY, photoW, photoH).fill("#ffffff");
  doc.rect(photoX, photoY, photoW, photoH).clip();
  if (idCard && size) {
    const fx = 0.05;
    const fy = 0.22;
    const fw = 0.26;
    const fh = 0.52;
    const regionW = size.w * fw;
    const regionH = size.h * fh;
    const scale = Math.min(photoW / regionW, photoH / regionH);
    const dx = photoX + (photoW - regionW * scale) / 2 - fx * size.w * scale;
    const dy = photoY + (photoH - regionH * scale) / 2 - fy * size.h * scale;
    doc.image(buf, dx, dy, { width: size.w * scale, height: size.h * scale });
  } else {
    const img = doc.openImage(buf);
    const cover = Math.max(photoW / img.width, photoH / img.height);
    const scale = cover * 0.9;
    const dw = img.width * scale;
    const dh = img.height * scale;
    const dx = photoX + (photoW - dw) / 2;
    const dy = photoY;
    doc.image(buf, dx, dy, { width: dw, height: dh });
  }
  doc.restore();
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
  const ink = "#243044";
  const labelInk = "#5a6874";
  try { doc.image(logo, 262, 4, { fit: [172, 62], align: "right" }); } catch { /* logo optional */ }

  const photoW = 68;
  const photoH = 90;
  const photoX = 362;
  const photoY = 112;
  const textLeft = W * 0.24;
  const textRight = photoX - 10;
  const textW = textRight - textLeft;
  const name = (c.name || "").toUpperCase();
  doc.font("Helvetica-Bold");
  let nameSize = 12;
  const nameW = 230;
  const nameLeft = (W - nameW) / 2;
  while (nameSize > 7 && doc.fontSize(nameSize).heightOfString(name, { width: nameW, align: "center" }) > nameSize * 2.2) {
    nameSize -= 0.25;
  }
  const nameY = 84;
  const nameHeight = doc.fontSize(nameSize).heightOfString(name, { width: nameW, align: "center" }) + 2;
  doc.fillColor(ink).font("Helvetica-Bold").fontSize(nameSize);
  doc.text(name, nameLeft, nameY, { width: nameW, align: "center", lineGap: 1, height: nameHeight });
  const trade = (c.course || "").trim();
  doc.font("Helvetica-Bold");
  let tradeSize = 14;
  while (tradeSize > 10 && doc.fontSize(tradeSize).widthOfString(trade) > textW) tradeSize -= 0.5;
  const nameBottom = nameY + nameHeight;
  const tradeY = Math.max(H * 0.35, nameBottom + 4);
  doc.fillColor(ink).font("Helvetica-Bold").fontSize(tradeSize)
    .text(trade, textLeft, tradeY, { width: textW, align: "center", height: tradeSize + 4 });

  const company = [job.certificateUnder, c.company, trainee?.company, job.customerName]
    .map((name) => (name || "").trim())
    .find((name) => name.length > 1) || "";
  const rows: Array<[string, string]> = [
    ["Certificate No", c.certificateNo || ""],
    ["Company", company],
    ["Training Date", c.trainingDate || ""],
    ["Expires on", c.expiresOn || ""],
  ];
  const labelSize = 11;
  const colonW = 14;
  doc.font("Helvetica-Bold").fontSize(labelSize);
  const labelW = Math.ceil(doc.widthOfString("Certificate No")) + 8;
  const valueX = textLeft + labelW + colonW;
  const valueW = textRight - valueX;
  let y = Math.max(H * 0.47, tradeY + tradeSize + 10);
  for (const [label, value] of rows) {
    doc.font("Helvetica-Bold").fontSize(labelSize).fillColor(ink);
    const rowLabelW = label === "Company" ? Math.ceil(doc.widthOfString("Company")) + 6 : labelW;
    const rowValueX = textLeft + rowLabelW + colonW;
    const rowValueW = (label === "Company" ? photoX - 14 : textRight) - rowValueX;
    const size = labelSize;
    let companyLines = 1;
    if (label === "Company") {
      doc.font("Helvetica-Bold").fontSize(size);
      if (doc.widthOfString(value) > rowValueW) companyLines = 2;
    }
    const rowH = companyLines === 2 ? doc.font("Helvetica-Bold").fontSize(size).heightOfString(value, { width: rowValueW }) + 1 : 14;
    doc.font("Helvetica").fontSize(labelSize).fillColor(labelInk)
      .text(label, textLeft, y, { width: rowLabelW, height: 14, lineBreak: false });
    doc.text(":", textLeft + rowLabelW, y, { width: colonW, height: 14, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(size).fillColor(ink).text(value, rowValueX, y + (companyLines === 1 ? (labelSize - size) * 0.15 : 0), {
      width: rowValueW,
      height: rowH,
      lineBreak: companyLines === 2,
    });
    y += companyLines === 2 ? Math.max(16, rowH + 2) : 16;
  }

  const photoSrc = trainee?.photoDataUrl || trainee?.extraPhotoDataUrl || "";
  if (photoSrc) {
    try { drawIdPhoto(doc, dataUrlBuffer(photoSrc), photoX, photoY, photoW, photoH); } catch { /* photo skipped */ }
  }
  doc.rect(photoX, photoY, photoW, photoH).lineWidth(1.8).strokeColor("#d4a017").stroke();

  const qrSize = 48;
  const qrX = 124;
  const qrY = 216;
  if (verifyUrl) {
    const qrPng = await QRCode.toBuffer(verifyUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 280,
      color: { dark: "#000000", light: "#ffffff" },
    });
    doc.rect(qrX - 2, qrY - 2, qrSize + 4, qrSize + 4).fill("#ffffff");
    doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });
  }
  const addressLines = [
    "Westcal Instrumentation and",
    "Calibration Services LLC",
    "Morocco Cluster, International City",
    "Dubai, UAE",
    "+971 56 665 4326, +971 4 576 2773",
    "training@westcal.ae",
    "https://westcal.ae/",
  ];
  const addressRight = photoX + photoW - 2;
  const addressW = 188;
  const addressX = addressRight - addressW;
  doc.font("Helvetica-Bold");
  let addrSize = 8;
  const widest = addressLines.reduce((a, b) => (a.length >= b.length ? a : b));
  while (addrSize > 7.5 && doc.fontSize(addrSize).widthOfString(widest) > addressW) addrSize -= 0.25;
  const lineH = addrSize + 1.7;
  const addressY = photoY + photoH + 5;
  doc.rect(addressX - 4, photoY + photoH - 2, addressRight - addressX + 10, H - (photoY + photoH) + 2).fill("#f7fbfd");
  doc.fillColor("#3a4654").font("Helvetica-Bold").fontSize(addrSize);
  const addrOpts = { width: addressW, align: "left" as const, height: lineH, lineBreak: false };
  addressLines.forEach((line, i) => {
    const lineY = addressY + i * lineH;
    doc.text(line, addressX, lineY, addrOpts);
    doc.text(line, addressX + 0.35, lineY, addrOpts);
  });
  doc.end();
}

function classicCardDate(value: string | undefined): string {
  const raw = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : raw;
}

/** Older Word ID card. The verify QR sits in the open space left of the photo. */
async function sendClassicCardPdf(
  res: ServerResponse,
  job: TrainingJob,
  c: TrainingCertificate,
  verifyUrl?: string,
): Promise<void> {
  const trainee = job.attendees.find((item) => item.id === c.attendeeId);
  const logo = await readFile(join(__dirname, "ui", "logo.jpg"));
  const W = 450;
  const H = 252;
  const doc = new PDFDocument({ size: [W, H], margin: 0, info: { Title: `${c.certificateNo} classic ID card` } });
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${c.certificateNo.replace(/[^a-zA-Z0-9_-]/g, "_")}-classic-card.pdf"`,
  });
  doc.pipe(res);
  doc.rect(0, 0, W, H).fill("#ffffff");

  const blue = "#4f81bc";
  const gold = "#e8a427";
  const ink = "#111111";
  const footerH = 48;
  const footerY = H - footerH - 6;
  const photoW = 68;
  const photoH = 74;
  const photoX = W - 18 - photoW;
  const photoY = footerY - photoH - 6;

  doc.fillColor(ink).font("Helvetica-Bold").fontSize(9);
  ["T: +971 4 576 2773", "M: +971 56 665 4326", "E: training@westcal.ae", "W: www.westcal.ae"].forEach((line, i) => {
    const lineY = 12 + i * 13;
    doc.text(line, 18, lineY, { lineBreak: false });
    doc.text(line, 18.35, lineY, { lineBreak: false });
  });
  const logoX = W - 16 - 128;
  const logoY = 6;
  const logoH = 50;
  try { doc.image(logo, logoX, logoY, { fit: [128, logoH], align: "right" }); } catch { /* logo optional */ }

  const companyChoices = [trainee?.company, job.certificateUnder, c.company, job.customerName, ...(job.companies || [])]
    .map((name) => (name || "").trim())
    .filter((name) => name.length > 1)
    .sort((a, b) => b.length - a.length);
  const rows: Array<[string, string]> = [
    ["Name:", (c.name || "").toUpperCase()],
    ["Company:", (companyChoices[0] || "").toUpperCase()],
    ["Course:", (c.course || "").toUpperCase()],
    ["Training Date:", classicCardDate(c.trainingDate)],
    ["Expires On:", classicCardDate(c.expiresOn)],
    ["Certificate No:", c.certificateNo || ""],
  ];
  const labelX = 18;
  const valueX = 118;
  const qrSize = 54;
  const qrX = photoX - qrSize - 8;
  const qrY = footerY - qrSize - 6;
  const fullW = photoX - valueX - 10;
  const besideQrW = qrX - valueX - 8;
  const rowWidths = rows.map((_, index) => (index >= 2 ? besideQrW : fullW));
  const rowHeights = rows.map(([, value], index) => {
    doc.font("Helvetica-Bold").fontSize(9);
    return doc.widthOfString(value) > rowWidths[index] ? 20 : 16;
  });
  const blockH = rowHeights.reduce((sum, height) => sum + height, 0);
  let y = Math.max(78, footerY - 8 - blockH);
  rows.forEach(([label, value], index) => {
    const rowH = rowHeights[index];
    const size = rowH > 16 ? 7.5 : 9;
    const valueOpts = { width: rowWidths[index], height: rowH, lineBreak: rowH > 16 };
    doc.fillColor(ink).font("Helvetica-Bold").fontSize(9);
    doc.text(label, labelX, y, { width: 96, height: 14, lineBreak: false });
    doc.text(label, labelX + 0.3, y, { width: 96, height: 14, lineBreak: false });
    doc.fontSize(size);
    doc.text(value, valueX, y, valueOpts);
    doc.text(value, valueX + 0.3, y, valueOpts);
    y += rowH;
  });

  const photoSrc = trainee?.photoDataUrl || trainee?.extraPhotoDataUrl || "";
  if (photoSrc) {
    try { drawIdPhoto(doc, dataUrlBuffer(photoSrc), photoX, photoY, photoW, photoH); } catch { /* photo skipped */ }
  }
  doc.rect(photoX, photoY, photoW, photoH).lineWidth(1.2).strokeColor(gold).stroke();

  if (verifyUrl) {
    const qrPng = await QRCode.toBuffer(verifyUrl, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 420,
      color: { dark: "#000000", light: "#ffffff" },
    });
    doc.rect(qrX - 3, qrY - 3, qrSize + 6, qrSize + 6).fill("#ffffff");
    doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });
  }

  doc.roundedRect(14, footerY, W - 28, footerH, 6).fill(blue);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8.5)
    .text("WESTCAL INSTRUMENTATION AND CALIBRATION SERVICES LLC", 20, footerY + 12, { width: W - 40, align: "center", lineBreak: false });
  doc.fontSize(8.5).text("DUBAI – UNITED ARAB EMIRATES", 20, footerY + 26, { width: W - 40, align: "center", lineBreak: false });
  doc.rect(0, 0, 9, H).fill(blue);
  doc.rect(W - 9, 0, 9, H).fill(gold);
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

/** Short scan link. A long address makes the QR too fine for a phone camera. */
function verifyLink(verificationRef: string): string {
  return `${lanBase()}/v/${encodeURIComponent(verificationRef.slice(0, 12))}`;
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

/** Keep login roles in sync with the People list, and give a new role its real permissions. */
function applyRecordedRoles(userId: string, roleIds: string[], dropCustom: boolean): void {
  const own = platform.permissions.getUserPermissions(userId);
  const access = own.filter((p) => p.module === ACCESS_MODULE);
  const extra = dropCustom ? [] : own.filter((p) => p.module !== ACCESS_MODULE);
  platform.permissions.clearUserRoles(userId);
  for (const roleId of roleIds) platform.permissions.assignUserRole(userId, roleId);
  platform.permissions.setUserPermissions(userId, [...extra, ...access] as PermissionKey[]);
}

function notifyCertificateRequest(job: TrainingJob, fromUserId?: string): void {
  let who = job.assigneeName || job.trainerName || "the field team";
  if (fromUserId) {
    try {
      const u = platform.users.getUser(fromUserId);
      who = u.displayName || u.identifier;
    } catch {
      /* keep assignee name */
    }
  }
  const kind = job.serviceType && job.serviceType !== "Training" ? job.serviceType.toLowerCase() : "training";
  const message = `Certificate requested for ${job.jobNo} (${kind}) by ${who}`;
  for (const u of platform.users.listUsers()) {
    const roles = platform.permissions.getUserRoleIds(u.id);
    if (roles.includes(ROLES.TRAINER) || roles.includes(ROLES.SITE_ENGINEER)) continue;
    if (roles.includes(ROLES.JOB_ASSISTANT) || platform.permissions.authorize(u.id, "Certificates", "edit")) {
      platform.training.notifyUser(u.id, message, job.id);
    }
  }
}

function syncStoredRoles(): boolean {
  let changed = false;
  for (const u of platform.users.listUsers()) {
    const permRoles = [...platform.permissions.getUserRoleIds(u.id)].sort().join(",");
    const recRoles = [...u.roleIds].sort().join(",");
    const own = platform.permissions.getUserPermissions(u.id);
    const custom = own.some((p) => p.module === META_MODULE && p.action === "custom");
    const roleKeys = new Set(
      u.roleIds.flatMap((r) => platform.permissions.getRolePermissions(r).map((p) => `${p.module}:${p.action}`)),
    );
    const ownKeys = new Set(own.map((p) => `${p.module}:${p.action}`));
    const roleCanIssue = roleKeys.has("Certificates:edit");
    const ownCanIssue = ownKeys.has("Certificates:edit");
    const leftoverOffice =
      u.roleIds.includes(ROLES.JOB_ASSISTANT) &&
      (ownKeys.has("Training:create") || ownKeys.has("Invoice:create")) &&
      !roleKeys.has("Training:create");
    const dropCustom = (custom && roleCanIssue && !ownCanIssue) || leftoverOffice;
    if (permRoles !== recRoles || dropCustom) {
      applyRecordedRoles(u.id, u.roleIds, dropCustom);
      changed = true;
      if (roleCanIssue) {
        for (const job of platform.training.listJobs()) {
          if (job.status === "Submitted") {
            platform.training.notifyUser(u.id, `Certificate requested for ${job.jobNo}`, job.id);
          }
        }
      }
    }
  }
  return changed;
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
  ".js": "application/javascript",
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
      "Cache-Control": isAsset ? "public, max-age=31536000, immutable" : "no-store, no-cache, must-revalidate",
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
    persistMutating = method === "POST" || method === "PATCH" || method === "DELETE" || method === "PUT";

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
    const verifyQrMatch = path.match(/^\/(?:verify|v)\/([^/]+)\/qr\.png$/);
    if (method === "GET" && verifyQrMatch) {
      const ref = decodeURIComponent(verifyQrMatch[1]);
      const found = platform.training.findCertificateByVerificationRef(ref);
      if (!found) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("certificate not found");
        return;
      }
      const verifyUrl = verifyLink(found.certificate.verificationRef);
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
    const verifyMatch = path.match(/^\/(?:verify|v)\/([^/]+)$/);
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
      sendJson(res, 404, { code: "NotFoundError", message: "attendance download is for signed-in staff" });
      return;
    }
    const joinPage = path.match(/^\/join\/([^/]+)(?:\/([^/]+))?$/);
    if (method === "GET" && joinPage) {
      try {
        const job = platform.training.getJobByInviteToken(joinPage[1]);
        res.writeHead(302, { Location: `/public/training/${job.id}` });
        res.end();
      } catch {
        await sendWebApp(path, res);
      }
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
      await sendWebApp("/app/", res);
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
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" });
      res.end(img);
      return;
    }
    if (method === "GET" && path === "/certificate-achievement.png") {
      const img = await readFile(join(__dirname, "ui", "certificate-achievement.png"));
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" });
      res.end(img);
      return;
    }
    if (method === "GET" && path === "/certificate-marks.png") {
      const img = await readFile(join(__dirname, "ui", "certificate-marks.png"));
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" });
      res.end(img);
      return;
    }
    if (method === "GET" && (path === "/certificate-signature.png" || path === "/certificate-company-seal.png")) {
      const name = path.slice(1);
      const img = await readFile(join(__dirname, "ui", name));
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" });
      res.end(img);
      return;
    }
    if (method === "GET" && path === "/certificate-achievement-blank-screen.jpg") {
      const img = await readFile(join(__dirname, "ui", "certificate-achievement-blank-screen.jpg"));
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" });
      res.end(img);
      return;
    }
    if (method === "GET" && path === "/certificate-achievement-blank.png") {
      const img = await readFile(join(__dirname, "ui", "certificate-achievement-blank.png"));
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" });
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
      sendJson(res, 200, { token, userId, identifier: user.identifier, displayName: user.displayName, roles, perms, modules: allowedServices(userId) });
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
        throw new AuthorizationError("This job was sent to the Certificate Coordinator and can no longer be edited");
      }
    }

    if (method === "GET" && path === "/api/me") {
      const user = platform.users.getUser(userId);
      sendJson(res, 200, {
        userId,
        identifier: user.identifier,
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
      if (b.identifier) platform.users.setIdentifier(user.id, String(b.identifier));
      if (b.email !== undefined) platform.users.setEmail(user.id, String(b.email));
      if (Array.isArray(b.roleIds)) {
        const prev = [...user.roleIds].sort().join(",");
        platform.users.setRoleIds(user.id, b.roleIds);
        applyRecordedRoles(user.id, user.roleIds, prev !== [...user.roleIds].sort().join(","));
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    const userPwMatch = path.match(/^\/api\/users\/([^/]+)\/password$/);
    if (method === "POST" && userPwMatch) {
      requireSuper(userId);
      const pw = String((await readBody(req)).password ?? "");
      if (pw.length < 6) {
        throw new ValidationError("Password must be at least 6 characters", "password");
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
      const roles = platform.permissions.getUserRoleIds(userId);
      const mayAdd =
        roles.includes(ROLES.SUPER_ADMIN) ||
        roles.includes(ROLES.ADMIN_STAFF) ||
        roles.includes(ROLES.JOB_ASSISTANT) ||
        platform.permissions.authorize(userId, "Training", "create");
      if (!mayAdd) throw new AuthorizationError("You do not have permission to add a course");
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

    // Training list — anyone with Training:read. Heavy images are omitted;
    // GET /api/training/:id returns the full job when a record is opened.
    if (method === "GET" && path === "/api/training") {
      requireAnyPerm(userId, [["Training", "read"], ["Reports", "read"]]);
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
      sendJson(res, 200, jobs.map((j) => TrainingService.summarizeJob(j)));
      return;
    }
    const oneJob = path.match(/^\/api\/training\/([^/]+)$/);
    if (method === "GET" && oneJob && oneJob[1] !== "next-job-order" && oneJob[1] !== "invoice-stats" && oneJob[1] !== "numbering") {
      requireAnyPerm(userId, [["Training", "read"], ["Reports", "read"]]);
      requireAssignedIfFieldUser(userId, oneJob[1]);
      let job: TrainingJob = platform.training.getJob(oneJob[1]);
      requireService(userId, job.serviceType);
      if (isFieldOnly(userId)) {
        const afterSubmit = new Set(["Approved", "Issued", "Closed"]);
        job = {
          ...job,
          status: afterSubmit.has(job.status) ? "Submitted" : job.status,
          certificates: [],
          invoiceNo: undefined,
        } as TrainingJob;
      } else {
        job = TrainingService.forOfficeView(job);
      }
      sendJson(res, 200, job);
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
    if (method === "GET" && path === "/api/training/numbering") {
      requireSuper(userId);
      sendJson(res, 200, platform.training.numberingPreview());
      return;
    }
    if (method === "PUT" && path === "/api/training/numbering") {
      requireSuper(userId);
      sendJson(res, 200, platform.training.setNextTrainingOrder(String((await readBody(req)).nextTr ?? "")));
      return;
    }
    const certificateEdit = path.match(/^\/api\/training\/([^/]+)\/certificates\/([^/]+)$/);
    if (method === "PATCH" && certificateEdit) {
      requirePerm(userId, "Certificates", "edit");
      sendJson(res, 200, await platform.training.editCertificate(certificateEdit[1], certificateEdit[2], await readBody(req)));
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
        verifyLink(certificate.verificationRef)
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
        verifyLink(certificate.verificationRef),
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
        verifyLink(certificate.verificationRef)
      );
      return;
    }
    const certificateContentNoPhotoMatch = path.match(/^\/api\/training\/([^/]+)\/certificates\/([^/]+)\/content-nophoto-pdf$/);
    if (method === "GET" && certificateContentNoPhotoMatch) {
      requireAnyPerm(userId, [["Certificates", "read"], ["Certificates", "edit"]]);
      requireAssignedIfFieldUser(userId, certificateContentNoPhotoMatch[1]);
      const job = platform.training.getJob(certificateContentNoPhotoMatch[1]);
      const certificate = job.certificates.find((item) => item.id === certificateContentNoPhotoMatch[2]);
      if (!certificate) {
        sendJson(res, 404, { code: "NotFoundError", message: "certificate not found" });
        return;
      }
      await sendTrainingCertificateContentPdf(
        res,
        job,
        certificate,
        verifyLink(certificate.verificationRef),
        true
      );
      return;
    }
    const oldCertificateDocxMatch = path.match(/^\/api\/training\/([^/]+)\/certificates\/([^/]+)\/old-docx$/);
    if (method === "GET" && oldCertificateDocxMatch) {
      requireAnyPerm(userId, [["Certificates", "read"], ["Certificates", "edit"]]);
      requireAssignedIfFieldUser(userId, oldCertificateDocxMatch[1]);
      const job = platform.training.getJob(oldCertificateDocxMatch[1]);
      const certificate = job.certificates.find((item) => item.id === oldCertificateDocxMatch[2]);
      if (!certificate) {
        sendJson(res, 404, { code: "NotFoundError", message: "certificate not found" });
        return;
      }
      await sendOldCertificateDocx(
        res,
        job,
        certificate,
        certificate.verificationRef
          ? verifyLink(certificate.verificationRef)
          : undefined,
      );
      return;
    }
    const specialCertificateDocxMatch = path.match(/^\/api\/training\/([^/]+)\/certificates\/([^/]+)\/special-docx$/);
    if (method === "GET" && specialCertificateDocxMatch) {
      requirePerm(userId, "Certificates", "edit");
      requireAssignedIfFieldUser(userId, specialCertificateDocxMatch[1]);
      const job = platform.training.getJob(specialCertificateDocxMatch[1]);
      const certificate = job.certificates.find((item) => item.id === specialCertificateDocxMatch[2]);
      if (!certificate) {
        sendJson(res, 404, { code: "NotFoundError", message: "certificate not found" });
        return;
      }
      await sendQannatiCertificateDocx(
        res,
        job,
        certificate,
        certificate.verificationRef
          ? verifyLink(certificate.verificationRef)
          : undefined,
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
        verifyLink(certificate.verificationRef)
      );
      return;
    }
    const classicCardPdfMatch = path.match(/^\/api\/training\/([^/]+)\/certificates\/([^/]+)\/classic-card-pdf$/);
    if (method === "GET" && classicCardPdfMatch) {
      requireAnyPerm(userId, [["Certificates", "read"], ["Certificates", "edit"]]);
      requireAssignedIfFieldUser(userId, classicCardPdfMatch[1]);
      const job = platform.training.getJob(classicCardPdfMatch[1]);
      const certificate = job.certificates.find((item) => item.id === classicCardPdfMatch[2]);
      if (!certificate) {
        sendJson(res, 404, { code: "NotFoundError", message: "certificate not found" });
        return;
      }
      const fit = url.searchParams.get("fit") === "shrink" ? "shrink" : "same";
      await sendOldTrainingCardPdf(
        res,
        job,
        certificate,
        certificate.verificationRef
          ? verifyLink(certificate.verificationRef)
          : undefined,
        fit,
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
      const roles = platform.permissions.getUserRoleIds(userId);
      const maySetOrder = roles.includes(ROLES.SUPER_ADMIN);
      const job = platform.training.createJob({
        serviceType: b.serviceType, location: b.location,
        course: b.course, courses: b.courses, customerName: b.customerName, companies: b.companies,
        certificateUnder: b.certificateUnder, certifiedBy: b.certifiedBy,
        trainingDate: b.trainingDate,
        trainingDateTo: b.trainingDateTo,
        trainingTime: b.trainingTime,
        mode: b.mode ?? "Onsite", trainerName: b.trainerName, createdById: userId,
        address: b.address, directionUrl: b.directionUrl, trnNo: b.trnNo, contactNameNumber: b.contactNameNumber,
        salesPerson: b.salesPerson, standardReference: b.standardReference,
        typeOfTraining: b.typeOfTraining, clientRequirements: b.clientRequirements,
        jobOrderNo: maySetOrder ? b.jobOrderNo : undefined,
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

    // Edit a job (Training:edit, or Mapping:edit for mapping protocol data)
    const editMatch = path.match(/^\/api\/training\/([^/]+)$/);
    if (method === "PATCH" && editMatch) {
      const existing = platform.training.getJob(editMatch[1]);
      if ((existing.serviceType || "Training") === "Mapping") {
        requireAnyPerm(userId, [["Training", "edit"], ["Mapping", "edit"], ["Mapping", "create"]]);
      } else {
        requirePerm(userId, "Training", "edit");
      }
      const b = await readBody(req);
      if (!platform.permissions.getUserRoleIds(userId).includes(ROLES.SUPER_ADMIN)) {
        delete b.jobOrderNo;
      }
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
      requireAnyPerm(userId, [["Training", "create"], ["Training", "assign"], ["Training", "edit"], ["Mapping", "create"], ["Mapping", "edit"]]);
      if (isFieldOnly(userId)) throw new AuthorizationError("Office staff only");
      
      const allUsers = platform.users.listUsers();
      const assignees = allUsers
        .filter((u) => {
          const roles = platform.permissions.getUserRoleIds(u.id);
          const isActive = u.status === "Active";
          const hasTrainerRole = roles.includes(ROLES.TRAINER);
          const hasSiteEngineerRole = roles.includes(ROLES.SITE_ENGINEER);
          const hasCoordinatorRole = roles.includes(ROLES.JOB_ASSISTANT);
          return isActive && (hasTrainerRole || hasSiteEngineerRole || hasCoordinatorRole);
        })
        .map((u) => {
          const roles = platform.permissions.getUserRoleIds(u.id);
          const roleName = roles.includes(ROLES.TRAINER)
            ? "Trainer"
            : roles.includes(ROLES.JOB_ASSISTANT)
              ? "Certificate Coordinator"
              : "Site Engineer";
          return {
            id: u.id,
            displayName: u.displayName,
            roleName: roleName,
          };
        });
      
      sendJson(res, 200, assignees);
      return;
    }

    // Mapping / office staff can add a Site Engineer from the job form without Users:create.
    if (method === "POST" && path === "/api/assignees") {
      requireAnyPerm(userId, [["Mapping", "create"], ["Training", "create"], ["Training", "assign"]]);
      if (isFieldOnly(userId)) throw new AuthorizationError("Office staff only");
      const b = await readBody(req);
      const displayName = String(b.displayName ?? "").trim();
      if (displayName.length < 2) throw new ValidationError("Type the site engineer name.", "displayName");
      const base = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "engineer";
      let identifier = base;
      let n = 2;
      while (platform.users.hasIdentifier(identifier)) {
        identifier = (base + String(n)).slice(0, 255);
        n += 1;
      }
      const u = platform.users.createUser({
        identifier,
        displayName,
        credential: randomBytes(8).toString("hex"),
        roleIds: [ROLES.SITE_ENGINEER],
      });
      setUserGrants(
        u.id,
        [
          { module: "Training", action: "read" },
          { module: "Training", action: "add_attendees" },
          { module: "Testing", action: "read" },
          { module: "Testing", action: "edit" },
          { module: "Calibration", action: "read" },
          { module: "Calibration", action: "edit" },
          { module: "Inspection", action: "read" },
          { module: "Inspection", action: "edit" },
          { module: "Mapping", action: "read" },
          { module: "Mapping", action: "edit" },
        ],
        ["Testing", "Calibration", "Inspection", "Mapping"],
      );
      sendJson(res, 201, { id: u.id, displayName: u.displayName, roleName: "Site Engineer" });
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
      const attendee = platform.training.updateAttendee(attendeeEdit[1], attendeeEdit[2], await readBody(req));
      await platform.training.issueMissingCertificates(attendeeEdit[1]);
      sendJson(res, 200, attendee);
      return;
    }
    if (method === "DELETE" && attendeeEdit) {
      requireAddTrainee(userId);
      requireAssignedIfFieldUser(userId, attendeeEdit[1]);
      requireEditable(userId, attendeeEdit[1]);
      platform.training.removeAttendee(attendeeEdit[1], attendeeEdit[2]);
      sendJson(res, 200, { ok: true });
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
      notifyCertificateRequest(submittedJob, userId);
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
      const caller = platform.users.getUser(userId);
      const isAccountant = caller.identifier.trim().toLowerCase() === "accountant";
      if (!isAccountant) requirePerm(userId, "Invoice", "create");
      if (isFieldOnly(userId)) throw new AuthorizationError("Office staff only");
      const b = await readBody(req);
      sendJson(res, 200, platform.training.addInvoiceAndClose(invoiceMatch[1], b.invoiceNumber, userId));
      return;
    }

    // Invoice Statistics - Super Admin monitoring
    if (method === "GET" && path === "/api/training/invoice-stats") {
      requirePerm(userId, "Invoice", "monitor");
      const stats = platform.training.getInvoiceStats();
      const nameOf = (id?: string) => { if (!id) return id; try { return platform.users.getUser(id).displayName || id; } catch { return id; } };
      sendJson(res, 200, { ...stats, jobs: stats.jobs.map((j) => ({ ...j, closedBy: nameOf((j as { closedBy?: string }).closedBy) })) });
      return;
    }

    sendJson(res, 404, { code: "NotFoundError", message: "route not found" });
  } catch (err) {
    handleError(res, err);
  }
}

const HTTPS_PFX = join(__dirname, "..", "data", "dev-https.pfx");
const httpServer = createServer((req, res) => { void handleRequest(req, res); });
/** Phone cameras open https. Office PCs still use http. Same port serves both.
 *  Without the pfx (cloud server behind nginx) plain http only. */
const httpsServer = existsSync(HTTPS_PFX)
  ? createHttpsServer(
      { pfx: readFileSync(HTTPS_PFX), passphrase: "westcal" },
      (req, res) => { void handleRequest(req, res); }
    )
  : null;
const server = !httpsServer ? httpServer : createNetServer((socket) => {
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
  const rolesSynced = syncStoredRoles();
  const relinked = platform.training.relinkMissingAssignees(platform.users.listUsers());
  if (relinked) {
    console.log(`Re-linked ${relinked} job(s) to current trainer / engineer logins.`);
  }
  if (rolesSynced || relinked) schedulePersist();
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
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
  }
  persistChain
    .then(() => savePlatformState(platform))
    .catch((err) => console.error("Could not save data:", err))
    .finally(() => process.exit(0));
}
process.on("SIGINT", flushAndExit);
process.on("SIGTERM", flushAndExit);

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
