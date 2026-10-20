import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { certificateSlots, formatCertDate } from "./certificateTemplate.js";
import type { TrainingCertificate, TrainingJob } from "./training.js";

const UI = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "ui");
const LOGO = join(UI, "logo.jpg");
const ARIAL_BOLD = "C:\\Windows\\Fonts\\arialbd.ttf";
const ARIAL_BLACK = "C:\\Windows\\Fonts\\ariblk.ttf";

/** Sample plastic card, in pixels. The PDF uses the same proportions. */
const SW = 774;
const SH = 436;
const PAGE_W = 465;
const S = PAGE_W / SW;
const PAGE_H = SH * S;
const u = (n: number) => n * S;

const BLUE = "#4f81bd";
const GOLD = "#e8a525";
const INK = "#171717";

const BODY = 21.5 * S;
const CONTACT = 15.5 * S;
const FOOTER = 16.2 * S;

export type OldCardFit = "same" | "shrink";

export type OldCardFields = {
  name: string;
  company: string;
  course: string;
  trainingDate: string;
  expiresOn: string;
  certificateNo: string;
  photo?: Buffer | null;
  /** Same size keeps the sample type size. Shrink reduces a long line so it stays on one row. */
  fit?: OldCardFit;
  qr?: Buffer | null;
};

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

function dataUrlBuffer(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

function useFace(doc: PDFKit.PDFDocument, heavy: boolean): void {
  const file = heavy && existsSync(ARIAL_BLACK) ? ARIAL_BLACK : existsSync(ARIAL_BOLD) ? ARIAL_BOLD : "";
  doc.font(file || "Helvetica-Bold");
}

/** Sample size, then a smaller size only when the words do not fit on the line. */
function fittedSize(doc: PDFKit.PDFDocument, text: string, maxSize: number, maxW: number, heavy: boolean): number {
  useFace(doc, heavy);
  let size = maxSize;
  const minSize = maxSize * 0.55;
  if (!text || maxW <= 0) return size;
  while (size > minSize && doc.fontSize(size).widthOfString(text) > maxW) size -= 0.2;
  return size;
}

function drawFitted(doc: PDFKit.PDFDocument, text: string, x: number, y: number, maxSize: number, maxW: number, heavy: boolean): void {
  const size = fittedSize(doc, text, maxSize, maxW, heavy);
  useFace(doc, heavy);
  doc.fontSize(size).text(text, x, y + (maxSize - size) * 0.75, { lineBreak: false });
}

/** Keep the sample size and wrap onto another line when the words are too wide. */
function wrapSameSize(doc: PDFKit.PDFDocument, text: string, maxW: number): string[] {
  useFace(doc, true);
  doc.fontSize(BODY);
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length || doc.widthOfString(text) <= maxW) return [text];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (doc.widthOfString(next) <= maxW) current = next;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Portrait box matching the sample card: head near the top, shoulders at the bottom. */
function drawPortrait(doc: PDFKit.PDFDocument, buf: Buffer, x: number, y: number, w: number, h: number): void {
  const size = imagePixelSize(buf);
  const idCard = size && size.w > size.h * 1.15;
  doc.save();
  doc.rect(x, y, w, h).clip();
  if (idCard && size) {
    const fx = 0.06;
    const fy = 0.28;
    const fw = 0.24;
    const fh = 0.46;
    const regionW = size.w * fw;
    const regionH = size.h * fh;
    const scale = Math.max(w / regionW, h / regionH);
    const dx = x - fx * size.w * scale + (w - regionW * scale) / 2;
    const dy = y - fy * size.h * scale + (h - regionH * scale) / 2;
    doc.image(buf, dx, dy, { width: size.w * scale, height: size.h * scale });
  } else if (size) {
    const scale = Math.max(w / size.w, h / size.h);
    const dw = size.w * scale;
    const dh = size.h * scale;
    doc.image(buf, x + (w - dw) / 2, y + (h - dh) * 0.08, { width: dw, height: dh });
  } else {
    doc.image(buf, x, y, { cover: [w, h], align: "center", valign: "center" });
  }
  doc.restore();
  doc.lineWidth(0.6).strokeColor("#d0d0d0").rect(x, y, w, h).stroke();
}

export async function renderOldIdCardPdf(fields: OldCardFields): Promise<Buffer> {
  const logo = await readFile(LOGO).catch(() => null);
  const doc = new PDFDocument({
    size: [PAGE_W, PAGE_H],
    margin: 0,
    info: { Title: `${fields.certificateNo || "card"} old ID card` },
  });
  const done = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.rect(0, 0, PAGE_W, PAGE_H).fill("#ffffff");
  doc.rect(0, 0, u(21), PAGE_H).fill(BLUE);
  doc.roundedRect(u(18), u(343), u(728), u(87), u(16)).fill(BLUE);
  doc.rect(u(755), 0, PAGE_W - u(755), PAGE_H).fill(GOLD);

  if (logo) {
    try {
      doc.image(logo, u(548), u(10), { fit: [u(150), u(96)], align: "center", valign: "center" });
    } catch { /* logo optional */ }
  }

  doc.fillColor(INK);
  const contacts = [
    "T: +9714 576 2773",
    "M: +971 56 665 4326",
    "E: training@westcal.ae",
    "W: www.westcal.ae",
  ];
  contacts.forEach((line, i) => {
    drawFitted(doc, line, u(58), u(24 + i * 23.5), CONTACT, u(280), false);
  });

  const rows: Array<[string, string]> = [
    ["Name:", (fields.name || "").toUpperCase()],
    ["Company:", (fields.company || "").toUpperCase()],
    ["Course:", (fields.course || "").toUpperCase()],
    ["Training Date:", formatCertDate(fields.trainingDate)],
    ["Expires On:", formatCertDate(fields.expiresOn)],
    ["Certificate No:", fields.certificateNo || ""],
  ];
  const tops = [155, 194, 225, 254, 283, 312];
  const labelX = u(28);
  const valueX = u(210);
  const photoX = u(637);
  const photoY = u(218);
  const photoW = u(102);
  const photoH = u(118);
  const qrSize = u(62);
  const qrX = photoX - qrSize - u(14);
  const qrY = photoY + photoH - qrSize;
  const fit = fields.fit === "shrink" ? "shrink" : "same";
  let shift = 0;
  const placed = rows.map(([label, value], i) => {
    const y = u(tops[i]) + shift;
    const maxW = (fields.qr && y + BODY > qrY ? qrX : photoX) - valueX - u(6);
    const lines = fit === "shrink" ? [value] : wrapSameSize(doc, value, maxW);
    if (lines.length > 1) shift += (lines.length - 1) * BODY * 0.86;
    return { label, y, lines, maxW };
  });
  const footerLimit = u(332);
  const last = placed[placed.length - 1];
  const lastBottom = last.y + last.lines.length * BODY * 0.9;
  const overflow = lastBottom - footerLimit;
  doc.fillColor(INK);
  for (const row of placed) {
    const y = row.y - (overflow > 0 ? overflow : 0);
    drawFitted(doc, row.label, labelX, y, BODY, valueX - labelX - u(6), true);
    if (fit === "shrink") {
      drawFitted(doc, row.lines[0], valueX, y, BODY, row.maxW, true);
    } else {
      useFace(doc, true);
      doc.fontSize(BODY);
      row.lines.forEach((line, lineIndex) => {
        doc.text(line, valueX, y + lineIndex * BODY * 0.86, { lineBreak: false });
      });
    }
  }

  if (fields.qr) {
    doc.save();
    doc.rect(qrX - u(2), qrY - u(2), qrSize + u(4), qrSize + u(4)).fill("#ffffff");
    doc.image(fields.qr, qrX, qrY, { width: qrSize, height: qrSize });
    doc.restore();
  }
  if (fields.photo) {
    try { drawPortrait(doc, fields.photo, photoX, photoY, photoW, photoH); } catch { /* photo skipped */ }
  }

  doc.fillColor("#ffffff");
  const footerW = u(700);
  const footerX = (PAGE_W - footerW) / 2;
  const footerLines = [
    "WESTCAL INSTRUMENTATION AND CALIBRATION SERVICES LLC",
    "DUBAI – UNITED ARAB EMIRATES",
  ];
  footerLines.forEach((line, i) => {
    useFace(doc, true);
    const size = fittedSize(doc, line, FOOTER, footerW, true);
    useFace(doc, true);
    doc.fontSize(size);
    const width = doc.widthOfString(line);
    const x = footerX + Math.max(0, (footerW - width) / 2);
    doc.text(line, x, u(i === 0 ? 360 : 396), { lineBreak: false });
  });

  doc.end();
  return done;
}

export async function sendOldTrainingCardPdf(
  res: ServerResponse,
  job: TrainingJob,
  c: TrainingCertificate,
  verifyUrl?: string,
  fit: OldCardFit = "same",
): Promise<void> {
  const s = certificateSlots(c, job);
  const trainee = job.attendees.find((item) => item.id === c.attendeeId);
  const photoSrc = trainee?.photoDataUrl || trainee?.extraPhotoDataUrl || trainee?.idCardDataUrl || "";
  let photo: Buffer | null = null;
  if (photoSrc.startsWith("data:image/")) {
    try { photo = dataUrlBuffer(photoSrc); } catch { photo = null; }
  }
  const qr = verifyUrl
    ? await QRCode.toBuffer(verifyUrl, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 280,
        color: { dark: "#000000", light: "#ffffff" },
      })
    : null;
  const pdf = await renderOldIdCardPdf({
    name: s.name,
    company: s.company,
    course: s.course,
    trainingDate: s.trainingDate,
    expiresOn: s.expiresOn,
    certificateNo: s.certificateNo,
    photo,
    fit,
    qr,
  });
  const no = (c.certificateNo || "card").replace(/[^a-zA-Z0-9_-]/g, "_");
  const tag = fit === "shrink" ? "old-card-shrink" : "old-card";
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="${no}-${tag}.pdf"`,
    "Content-Length": pdf.length,
  });
  res.end(pdf);
}
