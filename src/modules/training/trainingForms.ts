import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import PDFDocument from "pdfkit";
import type { TrainingJob } from "./training.js";
import { formatJobDates } from "./training.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGO = join(__dirname, "..", "..", "ui", "logo.jpg");

type PdfDoc = InstanceType<typeof PDFDocument>;

/** QMS document numbers printed at the bottom of downloaded PDFs. */
export const DOC_CONTROL = {
  certificate: "Doc: WICS-TB-CF01/Rev:00/Issuedate:20-02-2022",
  attendance: "Doc: WICS-TB-QP02/Rev:00/Issuedate:20-02-2022",
  jobOrder: "Doc: WICS-TB-QP01/Rev:00/Issuedate:20-02-2022",
} as const;

export const DOC_COPYRIGHT =
  "©No part of this document may be reproduced in any form by print, photocopy, microfilm or any other means wholly or partially, or disclosed to any person outside WICS without a written permission.";

type PdfKitInternals = PdfDoc & {
  continueOnNewPage: (options?: unknown) => PdfDoc;
};

/**
 * Stamp Doc: / Page n of n at the bottom of each existing page.
 * Does not create extra pages and does not overlap the form body.
 */
export function applyDocumentControlFooter(
  doc: PdfDoc,
  controlLine: string,
  opts?: { copyright?: boolean; pageNumber?: boolean }
): void {
  const pdf = doc as PdfKitInternals;
  const origContinue = pdf.continueOnNewPage.bind(doc);
  pdf.continueOnNewPage = () => pdf;

  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let i = 0; i < total; i++) {
    doc.switchToPage(range.start + i);
    const page = doc.page;
    const top = page.margins.top;
    const bottom = page.margins.bottom;
    page.margins.top = 0;
    page.margins.bottom = 0;
    const pageW = page.width;
    const yDoc = page.height - 16;
    if (opts?.copyright) {
      doc.font("Times-Italic").fontSize(6).fillColor("#111")
        .text(DOC_COPYRIGHT, 36, page.height - 38, {
          width: pageW - 72,
          align: "left",
          lineGap: 0.5,
        });
    }
    doc.font("Times-Italic").fontSize(7).fillColor("#111")
      .text(controlLine, 36, yDoc, {
        width: pageW - (opts?.pageNumber === false ? 72 : 140),
        height: 10,
        lineBreak: false,
      });
    if (opts?.pageNumber !== false) {
      doc.font("Times-Roman").fontSize(7)
        .text(`Page ${i + 1} of ${total}`, pageW - 92, yDoc, {
          width: 56,
          height: 10,
          align: "right",
          lineBreak: false,
        });
    }
    page.margins.top = top;
    page.margins.bottom = bottom;
  }
  pdf.continueOnNewPage = origContinue;
}

function dataUrlBuffer(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

function box(
  doc: PdfDoc,
  label: string,
  value: unknown,
  x: number,
  y: number,
  w: number,
  h = 28
): void {
  doc.rect(x, y, w, h).stroke("#333");
  doc.fillColor("#111").font("Helvetica-Bold").fontSize(8).text(label, x + 4, y + 3, {
    width: w - 8,
    height: 10,
    lineBreak: false,
  });
  doc.font("Helvetica").fontSize(10).text(String(value ?? ""), x + 4, y + 13, {
    width: w - 8,
    height: Math.max(10, h - 16),
    lineBreak: false,
    ellipsis: true,
  });
}

/** Job number printed on the training pack: TR… only, without the WC- prefix. */
function trNumber(job: TrainingJob): string {
  const jobNo = String(job.jobNo || "").trim().replace(/^WC-/i, "");
  return jobNo || String(job.jobOrderNo || "").trim();
}

function fileToken(value: string): string {
  return (value || "job").replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** yyyy-mm-dd (or a from/to range) printed as dd-mm-yyyy. */
function formatDisplayDate(value: string | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.split(/\s+to\s+/i).map((part) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(part.trim());
    return m ? `${m[3]}-${m[2]}-${m[1]}` : part.trim();
  }).join(" to ");
}

/** 24-hour HH:mm printed with AM/PM. */
function formatDisplayTime(value: string | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";
  if (/\b(am|pm)\b/i.test(raw)) return raw.replace(/\b(am|pm)\b/gi, (s) => s.toUpperCase());
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw);
  if (!m) return raw;
  let hour = Number(m[1]);
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${String(hour).padStart(2, "0")}:${m[2]} ${suffix}`;
}

export async function sendWorkPermitPdf(res: ServerResponse, job: TrainingJob): Promise<void> {
  const logo = await readFile(LOGO).catch(() => null);
  const no = (job.jobOrderNo || job.jobNo || "job").replace(/[^a-zA-Z0-9_-]/g, "_");
  const doc = new PDFDocument({ size: "A4", margin: 36, info: { Title: `Work Permit ${job.jobNo}` } });
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="WESTCAL-${no}-work-permit.pdf"`,
  });
  doc.pipe(res);
  drawWestcalLetterhead(doc, logo);
  doc.fillColor("#17305f").font("Helvetica-Bold").fontSize(16)
    .text("Training Work Permit (WQF11-03)", 36, 128, { align: "center" });
  let y = 164;
  const w = 523;
  box(doc, "Date", formatJobDates(job) || job.workPermit?.date, 36, y, 170);
  box(doc, "Job order no.", job.jobOrderNo || job.jobNo, 206, y, 170);
  box(doc, "Job no.", job.jobNo, 376, y, 183);
  y += 28;
  box(doc, "Customer name", job.customerName, 36, y, w);
  y += 28;
  box(doc, "Address / training location", job.address || job.location, 36, y, w, 36);
  y += 36;
  box(doc, "Contact name and no.", job.contactNameNumber, 36, y, 260);
  box(doc, "Sales person", job.salesPerson, 296, y, 263);
  y += 28;
  box(doc, "Status", job.workStatus || job.location, 36, y, 170);
  box(doc, "Required date for service", job.requiredDateForService || job.trainingDate, 206, y, 170);
  box(doc, "Handed over to", job.handedOverTo || job.assigneeName, 376, y, 183);
  y += 28;
  box(doc, "Assigned to (trainer)", job.assigneeName || job.trainerName, 36, y, 260);
  box(doc, "Work code", `${job.workCodeTraining !== false ? "Training" : ""}${job.workCodeCertification ? "  Certification" : ""}`.trim() || "Training", 296, y, 263);
  y += 28;
  box(doc, "Client requirements / scope", job.clientRequirements || job.course, 36, y, w, 40);
  y += 48;
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111").text("Line items", 36, y);
  y += 16;
  const cols = [40, 280, 70, 133];
  ["SN", "Description", "Qty", "Remarks"].forEach((h, i) => {
    const x = 36 + cols.slice(0, i).reduce((n, c) => n + c, 0);
    doc.rect(x, y, cols[i], 18).fillAndStroke("#f3f3f3", "#333");
    doc.fillColor("#111").font("Helvetica-Bold").fontSize(8).text(h, x + 4, y + 5, { width: cols[i] - 8 });
  });
  y += 18;
  const items = job.lineItems.length ? job.lineItems : [{ sn: 1, description: job.course, qty: String(job.attendees.length || job.expectedTraineeCount || ""), remarks: "" }];
  items.forEach((li) => {
    if (y > 720) { doc.addPage(); y = 40; }
    const vals = [String(li.sn), li.description, li.qty, li.remarks];
    vals.forEach((val, i) => {
      const x = 36 + cols.slice(0, i).reduce((n, c) => n + c, 0);
      doc.rect(x, y, cols[i], 22).stroke("#333");
      doc.font("Helvetica").fontSize(8).fillColor("#111").text(val || "", x + 4, y + 6, {
        width: cols[i] - 8,
        height: 14,
        lineBreak: false,
        ellipsis: true,
      });
    });
    y += 22;
  });
  y += 20;
  doc.font("Helvetica-Bold").fontSize(10).text("Authorized by (trainer)", 36, y);
  if (job.trainerSignature) {
    try { doc.image(dataUrlBuffer(job.trainerSignature), 36, y + 14, { fit: [160, 40] }); } catch { /* skip */ }
  } else {
    doc.moveTo(36, y + 40).lineTo(200, y + 40).stroke("#111");
  }
  doc.font("Helvetica").fontSize(9).text(job.authorizedBy || job.assigneeName || job.trainerName || "", 36, y + 56);
  doc.end();
}

function drawContractReviewBody(doc: PdfDoc, job: TrainingJob, logo: Buffer | null): void {
  const r = job.contractReview;
  drawWestcalLetterhead(doc, logo);
  doc.fillColor("#17305f").font("Helvetica-Bold").fontSize(16)
    .text("Training Contract Review Form", 36, 128, { align: "center" });
  let y = 164;
  const w = 523;
  box(doc, "Job number", trNumber(job), 36, y, 170);
  box(doc, "Training date", formatDisplayDate(formatJobDates(job)), 206, y, 170);
  box(doc, "Time", formatDisplayTime(job.trainingTime), 376, y, 183);
  y += 28;
  box(doc, "Customer name", r?.customerName || job.customerName, 36, y, w);
  y += 28;
  box(doc, "Scope of work", r?.scopeOfWork || job.course, 36, y, w);
  y += 28;
  box(doc, "Contact person / number", r?.contactPersonNumber || job.contactNameNumber, 36, y, 260);
  box(doc, "CR prepared by", r?.crPreparedBy, 296, y, 263);
  y += 28;
  box(doc, "Trainer", r?.trainerName || job.assigneeName || job.trainerName, 36, y, 260);
  box(doc, "Standard reference", r?.standardReference || job.standardReference, 296, y, 263);
  y += 28;
  box(doc, "Training method used", r?.trainingMethodUsed || job.mode, 36, y, w);
  y += 28;
  box(doc, "Customer feedback", r?.customerFeedback || "Not recorded", 36, y, 170);
  box(doc, "Feedback notes", r?.customerFeedbackNotes, 206, y, 353, 40);
  y += 48;
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111").text("Attached details", 36, y);
  y += 16;
  const checks: [string, boolean | undefined][] = [
    ["Work permit", r?.attached?.workPermit],
    ["Training reports", r?.attached?.trainingReports],
    ["DO", r?.attached?.do_],
    ["Training request form", r?.attached?.trainingRequestForm],
    ["Training certificates", r?.attached?.trainingCertificates],
    ["Invoice", r?.attached?.invoice],
    ["Quotation", r?.attached?.quotation],
    ["Final certificates copy", r?.attached?.finalCertificatesCopy],
    ["Scanned", r?.attached?.scanned],
    ["LPO", r?.attached?.lpo],
  ];
  checks.forEach(([label, on], i) => {
    const x = 36 + (i % 2) * 262;
    if (i % 2 === 0 && i > 0) y += 18;
    doc.font("Helvetica").fontSize(9).fillColor("#111").text(`${on ? "[x]" : "[ ]"}  ${label}`, x, y);
  });
  y += 36;
  box(doc, "Checked by MR / TM", r?.checkedByMRTM, 36, y, 260);
  box(doc, "Final checked by BM", r?.finalCheckedByBM, 296, y, 263);
}

export async function sendContractReviewPdf(res: ServerResponse, job: TrainingJob): Promise<void> {
  const logo = await readFile(LOGO).catch(() => null);
  const no = fileToken(trNumber(job));
  const doc = new PDFDocument({ size: "A4", margin: 36, bufferPages: true, info: { Title: `Training Contract Review Form ${trNumber(job)}` } });
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="WESTCAL-${no}-training-contract-review-form.pdf"`,
  });
  doc.pipe(res);
  drawContractReviewBody(doc, job, logo);
  applyDocumentControlFooter(doc, DOC_CONTROL.jobOrder);
  doc.end();
}

/** Official Westcal letterhead used on job sheets, attendance PDFs and reports. */
export function drawWestcalLetterhead(doc: PdfDoc, logo: Buffer | null): number {
  const blue = "#4d83bc";
  doc.rect(0, 0, 595.28, 88).fill("#ffffff");
  doc.fillColor("#151515").font("Times-Bold").fontSize(10)
    .text("T: +9714 576 2773", 36, 18)
    .text("M: +971 56 665 4326", 36, 32)
    .text("E: training@westcal.ae", 36, 46)
    .text("W: www.westcal.ae", 36, 60);
  if (logo) {
    try { doc.image(logo, 455, 12, { fit: [100, 62] }); } catch { /* skip */ }
  }
  doc.rect(36, 88, 523, 28).fill(blue);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(11)
    .text("WESTCAL INSTRUMENTATION AND CALIBRATION SERVICES LLC", 36, 96, { width: 523, align: "center" });
  return 128;
}

function drawAssignedJobSheetBody(doc: PdfDoc, job: TrainingJob, logo: Buffer | null): void {
  const navy = "#17305f";
  drawWestcalLetterhead(doc, logo);

  const training = (job.serviceType || "Training") === "Training";
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(16)
    .text(training ? "Training Work Permit" : "Assigned Job Sheet", 36, 128, { align: "center" });
  doc.font("Helvetica").fontSize(10).fillColor("#444")
    .text(training ? "Training work permit for office and field staff" : "Job assignment details for office and field staff", { align: "center" });

  let y = 168;
  if (job.status === "Cancelled") {
    doc.rect(36, y, 523, 48).fillAndStroke("#fdeaea", "#c0392b");
    doc.fillColor("#8b1e1e").font("Helvetica-Bold").fontSize(11)
      .text("CANCELLED" + (job.cancelledBy ? " by " + job.cancelledBy : ""), 44, y + 8, { width: 507 });
    doc.font("Helvetica").fontSize(10).text("Reason: " + (job.cancelledReason || "-"), 44, y + 26, { width: 507 });
    y += 58;
  }
  const w = 523;
  const companies = (job.companies && job.companies.length ? job.companies : [job.customerName]).filter(Boolean).join(" · ");
  if (training) {
    box(doc, "TR number", trNumber(job), 36, y, 340);
    box(doc, "Status", job.status, 376, y, 183);
    y += 28;
    box(doc, "Service", job.serviceType || "Training", 36, y, 170);
    box(doc, "Date", formatDisplayDate(formatJobDates(job)) || "-", 206, y, 170);
    box(doc, "Time", formatDisplayTime(job.trainingTime), 376, y, 183);
    y += 28;
    box(doc, "Location", job.location || "-", 36, y, 260);
    box(doc, "Mode", job.mode || "-", 296, y, 263);
  } else {
    box(doc, "Job no.", job.jobNo, 36, y, 170);
    box(doc, "Job order no.", job.jobOrderNo || job.jobNo, 206, y, 170);
    box(doc, "Status", job.status, 376, y, 183);
    y += 28;
    box(doc, "Service", job.serviceType || "Training", 36, y, 170);
    box(doc, "Date", formatJobDates(job), 206, y, 170);
    box(doc, "Time", job.trainingTime || "-", 376, y, 183);
    y += 28;
    box(doc, "Location", job.location || "-", 36, y, 170);
    box(doc, "Mode", job.mode || "-", 206, y, 170);
    box(doc, "Type of training", job.typeOfTraining || "-", 376, y, 183);
  }
  y += 28;
  box(doc, "Company / companies", companies, 36, y, w, 36);
  y += 36;
  box(doc, "Site address", job.address || "-", 36, y, w, 36);
  y += 36;
  box(doc, "Scope / course", job.course, 36, y, w, 40);
  y += 40;
  box(doc, "Assigned to", `${job.assigneeName || job.trainerName || "-"}  (${job.assigneeRole || "Trainer"})`, 36, y, 260);
  box(doc, "Contact name / number", job.contactNameNumber || "-", 296, y, 263);
  y += 28;
  box(doc, "Sales person", job.salesPerson || "-", 36, y, 170);
  box(doc, "Handed over to", job.handedOverTo || job.assigneeName || "-", 206, y, 170);
  box(
    doc,
    "Required date",
    (training ? formatDisplayDate(job.requiredDateForService || job.trainingDate) : (job.requiredDateForService || job.trainingDate)) || "-",
    376,
    y,
    183,
  );
  y += 28;
  box(doc, "Client requirements", job.clientRequirements || "-", 36, y, w, 40);
  y += 48;

  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111").text("Line items", 36, y);
  y += 16;
  const cols = [40, 280, 70, 133];
  ["SN", "Description", "Qty", "Remarks"].forEach((h, i) => {
    const x = 36 + cols.slice(0, i).reduce((n, c) => n + c, 0);
    doc.rect(x, y, cols[i], 18).fillAndStroke("#eef4fb", "#333");
    doc.fillColor("#111").font("Helvetica-Bold").fontSize(8).text(h, x + 4, y + 5, { width: cols[i] - 8 });
  });
  y += 18;
  const items = job.lineItems.length
    ? job.lineItems
    : [{ sn: 1, description: job.course, qty: String(job.expectedTraineeCount || job.attendees.length || ""), remarks: "" }];
  items.forEach((li) => {
    if (y > 720) { doc.addPage(); y = 40; }
    const vals = [String(li.sn), li.description, li.qty, li.remarks];
    vals.forEach((val, i) => {
      const x = 36 + cols.slice(0, i).reduce((n, c) => n + c, 0);
      doc.rect(x, y, cols[i], 22).stroke("#333");
      doc.font("Helvetica").fontSize(8).fillColor("#111").text(val || "", x + 4, y + 6, {
        width: cols[i] - 8,
        height: 14,
        lineBreak: false,
        ellipsis: true,
      });
    });
    y += 22;
  });
}

export async function sendAssignedJobSheetPdf(res: ServerResponse, job: TrainingJob): Promise<void> {
  const logo = await readFile(LOGO).catch(() => null);
  const training = (job.serviceType || "Training") === "Training";
  const no = training ? fileToken(trNumber(job)) : fileToken(job.jobOrderNo || job.jobNo || "job");
  const fileName = training ? `WESTCAL-${no}-training-contract-review-form.pdf` : `WESTCAL-${no}-job-sheet.pdf`;
  const doc = new PDFDocument({
    size: "A4",
    margin: 36,
    bufferPages: true,
    info: { Title: training ? `Training Contract Review Form ${trNumber(job)}` : `Assigned job sheet ${job.jobNo}` },
  });
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${fileName}"`,
  });
  doc.pipe(res);
  drawAssignedJobSheetBody(doc, job, logo);
  if (training) {
    doc.addPage();
    drawContractReviewBody(doc, job, logo);
  }
  applyDocumentControlFooter(doc, DOC_CONTROL.jobOrder);
  doc.end();
}

