import type { ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { printedTrNo, type TrainingCertificate, type TrainingJob } from "./training.js";
import { applyDocumentControlFooter, DOC_CONTROL, drawWestcalLetterhead } from "./trainingForms.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CERTIFICATE_BG = join(__dirname, "..", "..", "ui", "certificate-bg.png");
export const CERTIFICATE_ACHIEVEMENT = join(__dirname, "..", "..", "ui", "certificate-achievement.png");
export const CERTIFICATE_ACHIEVEMENT_BLANK = join(__dirname, "..", "..", "ui", "certificate-achievement-blank.png");
export const CERTIFICATE_ACHIEVEMENT_BLANK_HD = join(__dirname, "..", "..", "ui", "certificate-achievement-blank-hd.png");
export const CERTIFICATE_ACHIEVEMENT_BLANK_PRINT = join(__dirname, "..", "..", "ui", "certificate-achievement-blank-print.jpg");
export const CERTIFICATE_DESIGNS_DIR = join(__dirname, "..", "..", "ui", "certificates");
const LOGO = join(__dirname, "..", "..", "ui", "logo.jpg");
const CERTIFICATE_MARKS = join(__dirname, "..", "..", "ui", "certificate-marks.png");
const UI_DIR = join(__dirname, "..", "..", "ui");
const marksPng = (() => {
  try {
    return readFileSync(CERTIFICATE_MARKS);
  } catch {
    return null;
  }
})();
let artworkCache: Promise<Buffer | null> | null = null;

/** Three authorised-by signatures the office can pick for a job. */
export type CertificateSignatureChoice = "1" | "2" | "3";

export function normalizeCertificateSignature(value: unknown): CertificateSignatureChoice {
  const v = String(value ?? "1").trim();
  return v === "2" || v === "3" ? v : "1";
}

export function certificateSignaturePath(choice: unknown): string {
  return join(UI_DIR, `certificate-signature-${normalizeCertificateSignature(choice)}.png`);
}

export function certificateSignatureUrl(choice: unknown): string {
  const n = normalizeCertificateSignature(choice);
  return `/certificate-signature-${n}.png?v=20261026qr`;
}

export function readCertificateSignature(choice: unknown): Buffer | null {
  try {
    return readFileSync(certificateSignaturePath(choice));
  } catch {
    try {
      return readFileSync(join(UI_DIR, `certificate-signature-${normalizeCertificateSignature(choice)}.jpg`));
    } catch {
      try {
        return readFileSync(join(UI_DIR, "certificate-signature.png"));
      } catch {
        return null;
      }
    }
  }
}

function pngPixelSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  return null;
}

export type CertificateSignatureSize = "normal" | "medium";

export function normalizeCertificateSignatureSize(value: unknown): CertificateSignatureSize {
  return String(value ?? "").trim() === "normal" ? "normal" : "medium";
}

/**
 * Word/PDF print size for the authorised signature.
 * Keep the real PNG aspect (wrong height = Word stretches the ink and it looks blurry).
 * Signature 2: "normal" = earlier smaller print, "medium" = current medium print.
 * Used by old design + special design Word downloads.
 */
export function authorizedSignatureExtent(
  buf: Buffer,
  choice: unknown = "1",
  printSize: unknown = "medium",
): { cx: number; cy: number } {
  const size = pngPixelSize(buf);
  const n = normalizeCertificateSignature(choice);
  const print = normalizeCertificateSignatureSize(printSize);
  // EMU: 914400 = 1 inch.
  let targetCx = 1500000;
  let maxCy = 780000;
  if (n === "2") {
    if (print === "normal") {
      targetCx = 1680000; // earlier / smaller Signature 2
      maxCy = 950000;
    } else {
      targetCx = 1920000; // medium Signature 2
      maxCy = 1500000;
    }
  }
  if (!size?.w || !size?.h) return { cx: targetCx, cy: Math.round(targetCx * 0.4) };
  const ar = size.h / size.w;
  let cx = targetCx;
  let cy = Math.round(cx * ar);
  // Never stretch: if too tall for the page, shrink width to keep the real shape.
  if (cy > maxCy) {
    cy = maxCy;
    cx = Math.round(cy / ar);
  }
  return { cx, cy };
}

/** Float the ink next to "Authorized By:" — a bit above the line, same pen design. */
export function authorizedSignatureRun(cx: number, cy: number): string {
  return `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="character"><wp:posOffset>100000</wp:posOffset></wp:positionH><wp:positionV relativeFrom="line"><wp:posOffset>-260000</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="21" name="Authorized signature"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="21" name="signature.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdSign"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
}

/** PDF fit box for the authorised signature on the new Westcal certificate. */
export function authorizedSignaturePdfFit(choice: unknown, printSize: unknown = "medium"): { w: number; h: number } {
  if (normalizeCertificateSignature(choice) !== "2") return { w: 155, h: 58 };
  return normalizeCertificateSignatureSize(printSize) === "normal" ? { w: 168, h: 72 } : { w: 200, h: 85 };
}

export const BUILTIN_CERTIFICATE_DESIGNS = [
  { id: "achievement", name: "Westcal Achievement", preview: "/certificate-achievement.png" },
  { id: "classic", name: "Westcal Classic", preview: "/certificate-bg.png" },
  { id: "letterhead", name: "Westcal Letterhead", preview: "/logo.jpg" },
  { id: "navy-gold", name: "Navy & Gold frame", preview: "/certificate-bg.png" },
] as const;

export async function listCertificateDesigns(): Promise<{ id: string; name: string; preview: string }[]> {
  const extra: { id: string; name: string; preview: string }[] = [];
  try {
    const files = await readdir(CERTIFICATE_DESIGNS_DIR);
    for (const file of files) {
      if (!/\.(png|jpe?g)$/i.test(file)) continue;
      const id = `file-${file.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-")}`;
      extra.push({
        id,
        name: file.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
        preview: `/certificates/${encodeURIComponent(file)}`,
      });
    }
  } catch {
    /* drop extra PNG templates into backend/src/ui/certificates */
  }
  return [...BUILTIN_CERTIFICATE_DESIGNS, ...extra];
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

/** KHDA and ISO marks belong on the printed design, not on the data sheet. */
function drawCertificateMarks(doc: PdfDoc): void {
  if (!marksPng) return;
  const pageW = 595.28;
  const pageH = 841.89;
  doc.image(marksPng, pageW * 0.36, pageH * 0.852, { width: pageW * 0.24 });
}

type PdfDoc = InstanceType<typeof PDFDocument>;
type CertSlots = ReturnType<typeof certificateSlots>;

export function certificateSlots(c: TrainingCertificate, job: TrainingJob) {
  const trainee = job.attendees.find((a) => a.id === c.attendeeId);
  return {
    name: c.name,
    eid: c.idOrVisaNo || trainee?.idOrVisaNo || "",
    idDocument: (c.idDocument || trainee?.idDocument) === "passport" ? "passport" : "eid",
    company: (() => {
      // Employed by from the ID / trainee — never job.certificateUnder (Certified to).
      const pick = [trainee?.company, c.company, job.customerName]
        .map((v) => String(v || "").trim())
        .find((v) => v.length > 2);
      return pick || "";
    })(),
    course: (c.course || "").trim(),
    certificateNo: c.certificateNo,
    jobNo: printedTrNo(job),
    orderNo: printedTrNo(job),
    trainingDate: c.trainingDate,
    trainingTime: job.trainingTime || "",
    expiresOn: c.expiresOn,
    authorizedBy: job.authorizedBy || job.assigneeName || job.trainerName || "",
    authorizedSignature: job.trainerSignature || "",
    // Prefer the signature stamped on this certificate (QR scan must match print).
    signatureChoice: normalizeCertificateSignature(c.certificateSignature ?? job.certificateSignature),
    signatureSize: normalizeCertificateSignatureSize(job.certificateSignatureSize),
    traineeSignature: trainee?.signature || "",
    photoDataUrl: trainee?.photoDataUrl || trainee?.extraPhotoDataUrl || "",
    qrDataUrl: c.qrDataUrl || "",
    design: "achievement",
    companyScale: clampCompanyScale(job.companyScale),
    companyFit: job.companyFit === "shrink" ? "shrink" : "same",
  };
}

/** 1 keeps the automatic fit. Smaller values shrink a long employer name further. */
function employerSize(text: string, scale: number, fit: string): string {
  if (fit !== "shrink") return "1em";
  const len = text.trim().length;
  const base = len > 52 ? 0.78 : len > 40 ? 0.88 : len > 28 ? 0.95 : 1;
  return `${(base * clampCompanyScale(scale)).toFixed(2)}em`;
}

export function clampCompanyScale(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0.55, n));
}

/** Same size matches the trainee name. Shrink makes a long company name smaller. */
export function companyNameHalfPoints(text: string, nameHalfPoints: number, fit: unknown, scale: unknown): number {
  const same = Math.max(16, Math.round(nameHalfPoints * clampCompanyScale(scale)));
  if (fit !== "shrink") return same;
  const len = Math.max(1, text.trim().length);
  return len <= 34 ? same : Math.max(20, Math.round((same * 34) / len));
}

export function shrinkCompanyParagraph(xml: string, halfPoints: number): string {
  const at = xml.indexOf("{{COMPANY}}");
  if (at < 0) return xml;
  const start = xml.lastIndexOf("<w:p", at);
  const end = xml.indexOf("</w:p>", at);
  if (start < 0 || end < 0) return xml;
  const para = xml.slice(start, end)
    .replace(/<w:sz w:val="\d+"\/>/g, `<w:sz w:val="${halfPoints}"/>`)
    .replace(/<w:szCs w:val="\d+"\/>/g, `<w:szCs w:val="${halfPoints}"/>`);
  return xml.slice(0, start) + para + xml.slice(end);
}

async function loadCertificateArtwork(): Promise<Buffer | null> {
  if (!artworkCache) {
    artworkCache = readFile(CERTIFICATE_ACHIEVEMENT_BLANK_HD).catch(() =>
      readFile(CERTIFICATE_ACHIEVEMENT_BLANK).catch(() =>
        readFile(CERTIFICATE_ACHIEVEMENT_BLANK_PRINT).catch(() => readFile(CERTIFICATE_ACHIEVEMENT).catch(() => null)),
      ),
    );
  }
  return artworkCache;
}

function isAchievementDesign(design: string): boolean {
  return !design || design === "achievement" || design === "classic";
}

function drawCertificateBody(doc: PdfDoc, s: CertSlots, qrPng: Buffer | null, startY: number, authY: number, qrY: number): void {
  const navy = "#111111";
  const x = 70;
  const w = 455;
  let y = startY;
  doc.fillColor("#333").font("Times-Italic").fontSize(11)
    .text("This is to certify that", x, y, { width: w, align: "center" });
  y = doc.y + 8;
  doc.fillColor(navy).font("Times-Bold").fontSize(16)
    .text(s.name.toUpperCase(), x, y, { width: w, align: "center" });
  y = doc.y + 4;
  if (s.eid) {
    const idNumber = s.idDocument === "passport" ? s.eid.toUpperCase() : s.eid;
    doc.fillColor("#111").font("Times-Bold").fontSize(11)
      .text(`(${s.idDocument === "passport" ? "PASSPORT NO" : "EID NO"}: ${idNumber})`, x, y, { width: w, align: "center" });
    y = doc.y + 8;
  }
  doc.fillColor("#333").font("Times-Italic").fontSize(11)
    .text("Employed by", x, y, { width: w, align: "center" });
  y = doc.y + 4;
  const company = s.company.toUpperCase();
  let companySize = 13 * s.companyScale;
  doc.font("Times-Bold").fillColor(navy);
  if (s.companyFit === "shrink") {
    while (companySize > 8 && doc.fontSize(companySize).widthOfString(company) > w) companySize -= 0.5;
  }
  doc.font("Times-Bold").fontSize(companySize)
    .text(company, x, y, { width: w, align: "center" });
  y = doc.y + 8;
  doc.fillColor("#333").font("Times-Italic").fontSize(11)
    .text("has successfully completed one day safety training for", x, y, { width: w, align: "center" });
  y = doc.y + 8;
  doc.fillColor(navy).font("Times-Bold").fontSize(s.course.length > 36 ? 12 : 14)
    .text(s.course.toUpperCase(), x, y, { width: w, align: "center" });
  y = Math.min(doc.y + 16, qrY + 20);
  const metaRows = [
    ["Certificate No.:", s.certificateNo],
    ["Job No.:", s.jobNo],
    ["Training Date:", s.trainingTime ? `${s.trainingDate}  ${s.trainingTime}` : s.trainingDate],
    ["Expiry Date:", s.expiresOn],
  ];
  const metaW = 260;
  const metaX = (595.28 - metaW) / 2;
  metaRows.forEach(([label, value]) => {
    doc.font("Times-Roman").fontSize(11).fillColor("#111").text(label, metaX, y, { width: 120 });
    doc.text(value, metaX + 120, y, { width: 140 });
    y += 16;
  });
  doc.font("Times-Roman").fontSize(11).fillColor("#111")
    .text("Authorized by:", 70, authY, { width: 180, align: "left" });
  doc.font("Times-Roman").fontSize(10).text(s.authorizedBy, 70, authY + 16, { width: 180, align: "left" });
  if (s.authorizedSignature) {
    try { doc.image(dataUrlBuffer(s.authorizedSignature), 70, authY + 32, { fit: [110, 32] }); } catch { /* skip */ }
  }
  if (qrPng) {
    const qrSize = 72;
    const qrX = 268;
    doc.rect(qrX - 4, qrY - 4, qrSize + 8, qrSize + 16).fill("#ffffff");
    doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });
    doc.font("Helvetica").fontSize(6).fillColor("#111").text("Scan to verify", qrX - 4, qrY + qrSize + 1, { width: qrSize + 8, align: "center" });
  }
}

function drawNavyGoldFrame(doc: PdfDoc): void {
  doc.rect(0, 0, 595.28, 841.89).fill("#17305f");
  doc.rect(10, 10, 575.28, 821.89).fill("#c9a227");
  doc.rect(16, 16, 563.28, 809.89).fill("#ffffff");
  doc.rect(22, 22, 551.28, 797.89).stroke("#17305f");
}

export function formatCertDate(value: string): string {
  const m = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return String(value ?? "").trim();
}

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!
  ));
}

/** The designed certificate. Shown when the ID card QR or the certificate QR is scanned. */
export function printedCertificateVerifyHtml(c: TrainingCertificate, job: TrainingJob): string {
  const s = certificateSlots(c, job);
  const company = s.company || "-";
  const photo = s.photoDataUrl
    ? `<div class="cert-photo"><img src="${esc(s.photoDataUrl)}" alt=""></div>`
    : "";
  const ref = c.verificationRef ? encodeURIComponent(c.verificationRef) : "";
  return `<!doctype html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(s.certificateNo)}</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#e8eef6;min-height:100%}
.page{min-height:100dvh;display:flex;align-items:flex-start;justify-content:center;padding:8px 0}
.west-cert{position:relative;width:min(720px,100vw);aspect-ratio:210/297;background:#fff url(/certificate-achievement-blank-screen.jpg?v=20261009fast) center/100% 100% no-repeat;overflow:hidden;text-align:center;font-family:"Times New Roman",Times,serif;color:#16325c;container-type:inline-size}
.cert-photo{position:absolute;right:15.5%;top:52.4%;width:11%;aspect-ratio:3/4;height:auto;overflow:hidden;border:2px solid #c9a227;background:#eee;z-index:2}
.cert-photo img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 22%;display:block}
.cert-marks{position:absolute;left:36%;top:85.2%;width:24%;height:auto;object-fit:contain;z-index:2;pointer-events:none}
.cert-name{position:absolute;left:8%;right:30%;top:54.6%;text-align:center;font-weight:700;font-size:16px;font-size:2.15cqi;text-transform:uppercase;white-space:nowrap;line-height:1;color:#16325c}
.cert-rule{position:absolute;left:32%;width:18%;top:57.4%;border:0;border-top:1px solid #222;margin:0}
.lead{position:absolute;left:10%;right:30%;top:58.4%;text-align:center;font-style:italic;font-weight:700;font-size:13px;font-size:1.45cqi;color:#16325c;white-space:nowrap}
.cert-course{position:absolute;left:8%;right:30%;top:62.2%;text-align:center;font-weight:700;font-size:15px;font-size:2cqi;text-transform:uppercase;color:#16325c;white-space:nowrap}
.meta-col{position:absolute;top:68.2%;font-weight:700;font-size:13px;font-size:1.45cqi;color:#16325c;text-align:left;line-height:1.85}
.meta-left{left:12%;width:40%}
.meta-right{left:54%;width:26%}
.meta-col div{overflow-wrap:anywhere}
.meta-col span{display:inline-block;min-width:13.5cqi;vertical-align:top}
.employer{font-size:0.92em;line-height:1.2}
.auth{position:absolute;left:15%;top:77%;width:22%;text-align:left;font-weight:700;font-style:italic;letter-spacing:.8px;font-size:14px;font-size:1.6cqi}
.auth-sign{position:absolute;left:14%;top:77.2%;width:24%;height:6.2%;object-fit:contain;object-position:left center;z-index:3;background:transparent;mix-blend-mode:multiply}
.auth-seal{position:absolute;left:39%;top:77.4%;width:13%;height:auto;object-fit:contain;z-index:3}
.contact{position:absolute;left:9%;top:84.8%;width:24%;text-align:left;font-weight:700;font-size:11px;font-size:1.12cqi;line-height:1.15;color:#16325c}
.qr{position:absolute;right:22%;top:75%;width:16%;background:#fff;padding:6px;box-sizing:border-box;z-index:4}
.qr img{width:100%;height:auto;display:block;background:#fff}
</style></head><body>
<div class="page"><div class="west-cert">
  ${photo}
  <img class="cert-marks" src="/certificate-marks.png?v=20261007m" alt="KHDA permit">
  <div class="cert-name">${esc(s.name)}</div>
  <hr class="cert-rule">
  <div class="lead">has successfully completed one day safety training for</div>
  <div class="cert-course">${esc(s.course)}</div>
  <div class="meta-col meta-left">
    <div><span>${s.idDocument === "passport" ? "Passport No" : "EID Number"}</span> ${esc(s.eid || "-")}</div>
    <div><span>Employed by</span> <b class="employer" style="font-size:${employerSize(company, s.companyScale, s.companyFit)}">${esc(company)}</b></div>
    <div><span>Training Date</span> ${esc(formatCertDate(s.trainingDate))}</div>
  </div>
  <div class="meta-col meta-right">
    <div><span>Certificate No.</span> ${esc(s.certificateNo)}</div>
    <div><span>Job No.</span> ${esc(s.jobNo)}</div>
    <div><span>Expiry Date</span> ${esc(formatCertDate(s.expiresOn))}</div>
  </div>
  <div class="auth">AUTHORISED BY</div>
  <img class="auth-sign" src="${certificateSignatureUrl(s.signatureChoice)}" alt="Authorized signature">
  <img class="auth-seal" src="/certificate-company-seal.png?v=20261017s" alt="Westcal seal">
  <div class="contact">Westcal Instrumentation and Calibration<br>Services LLC<br>Morocco Cluster, International City,<br>Dubai, UAE.<br>info@westcal.ae<br>+971566654326 &amp; +97145762773.<br>https://westcal.ae/</div>
  ${ref ? `<div class="qr"><img src="/verify/${ref}/qr.png" alt="Scan to verify"></div>` : ""}
</div></div>
</body></html>`;
}

/** Original Westcal artwork + live fields in the same places as the issued sample. */
function drawPrintedCertificate(
  doc: PdfDoc,
  s: CertSlots,
  qrPng: Buffer | null,
  artwork: Buffer | null,
  fieldsOnly = false,
  hidePhoto = false
): void {
  const W = 595.28;
  const H = 841.89;
  const SX = W / 768;
  const SY = H / 1024;
  const px = (x: number) => x * SX;
  const py = (y: number) => y * SY;
  const navy = "#16325c";
  const gold = "#c9a227";
  const cream = "#fef9f3";

  if (!fieldsOnly) {
    if (artwork) {
      doc.image(artwork, 0, 0, { width: W, height: H });
    } else {
      doc.rect(0, 0, W, H).fill(cream);
    }
  }

  if (!hidePhoto) {
    const photoX = px(564);
    const photoY = py(536);
    const photoW = px(84);
    const photoH = photoW * (4 / 3);
    doc.save();
    doc.rect(photoX, photoY, photoW, photoH).clip();
    if (s.photoDataUrl) {
      try {
        const buf = dataUrlBuffer(s.photoDataUrl);
        const size = imagePixelSize(buf);
        const idCard = size && size.w > size.h * 1.15;
        if (idCard && size) {
          const fx = 0.086;
          const fy = 0.335;
          const fw = 0.184;
          const fh = 0.348;
          const regionW = size.w * fw;
          const regionH = size.h * fh;
          const scale = Math.max(photoW / regionW, photoH / regionH);
          doc.image(buf, photoX - fx * size.w * scale + (photoW - regionW * scale) / 2, photoY - fy * size.h * scale + (photoH - regionH * scale) / 2, {
            width: size.w * scale,
            height: size.h * scale,
          });
        } else {
          const img = doc.openImage(buf);
          const scale = Math.max(photoW / img.width, photoH / img.height);
          const dw = img.width * scale;
          const dh = img.height * scale;
          doc.image(buf, photoX + (photoW - dw) / 2, photoY + (photoH - dh) * 0.22, {
            width: dw,
            height: dh,
          });
        }
      } catch { /* skip */ }
    }
    doc.restore();
    doc.save();
    doc.lineWidth(1.1).strokeColor(gold).rect(photoX - 1.2, photoY - 1.2, photoW + 2.4, photoH + 2.4).stroke();
    doc.restore();
  }

  const textLeft = px(70);
  const textRight = px(564) - 8;
  const textW = textRight - textLeft;
  const placeLine = (text: string, y: number, font: string, maxSize: number, minSize: number) => {
    let size = maxSize;
    doc.font(font).fillColor(navy);
    while (size > minSize && doc.fontSize(size).widthOfString(text) > textW) size -= 0.25;
    doc.font(font).fontSize(size);
    const width = doc.widthOfString(text);
    const x = textLeft + Math.max(0, (textW - width) / 2);
    doc.text(text, x, y, { lineBreak: false });
  };

  placeLine(s.name.toUpperCase(), py(568), "Times-Bold", 13, 7);

  const ruleW = px(120);
  const ruleX = textLeft + (textW - ruleW) / 2;
  const lineY = py(596);
  doc.save();
  doc.moveTo(ruleX, lineY).lineTo(ruleX + ruleW, lineY).lineWidth(0.6).strokeColor("#222").stroke();
  doc.restore();

  placeLine("has successfully completed one day safety training for", py(608), "Times-BoldItalic", 9, 6);
  placeLine(s.course.toUpperCase(), py(646), "Times-Bold", 12, 7);

  let y = py(708);
  const leftX = px(108);
  const rightX = px(400);
  const labelW = px(100);
  const valueW = px(145);
  const meta: Array<[string, string, string, string]> = [
    [s.idDocument === "passport" ? "Passport No" : "EID Number", s.eid || "-", "Certificate No.", s.certificateNo],
    ["Employed by", s.company || "-", "Job No.", s.orderNo || s.jobNo],
    ["Training Date", formatCertDate(s.trainingDate), "Expiry Date", formatCertDate(s.expiresOn)],
  ];
  const scale = s.companyScale;
  const linesAt = (text: string, size: number) => {
    doc.font("Times-Bold").fontSize(size);
    const words = String(text || "-").split(/\s+/).filter(Boolean);
    if (!words.length) return 1;
    let lines = 1;
    let width = 0;
    for (const word of words) {
      const wordW = doc.widthOfString(word);
      if (wordW > valueW) return 3;
      const gap = width ? doc.widthOfString(" ") : 0;
      if (width && width + gap + wordW > valueW) {
        lines += 1;
        width = wordW;
      } else width += gap + wordW;
    }
    return lines;
  };
  const valueSize = (text: string, scaled: boolean) => {
    let size = 8 * (scaled ? scale : 1);
    const floor = scaled ? Math.max(5, 6.5 * scale) : 6.5;
    while (size > floor && linesAt(text, size) > 2) size -= 0.25;
    return { size, lines: Math.min(2, linesAt(text, size)) };
  };
  for (const [l1, v1, l2, v2] of meta) {
    const left = valueSize(v1, l1 === "Employed by");
    const right = valueSize(v2, false);
    const rowH = Math.max(left.lines, right.lines) === 2 ? 16 : py(16);
    doc.font("Times-Bold").fontSize(8).fillColor(navy).text(l1, leftX, y, { width: labelW, lineBreak: false });
    doc.font("Times-Bold").fontSize(left.size).fillColor(navy).text(v1, leftX + labelW, y, { width: valueW, height: rowH, lineBreak: left.lines === 2 });
    doc.font("Times-Bold").fontSize(8).fillColor(navy).text(l2, rightX, y, { width: labelW, lineBreak: false });
    doc.font("Times-Bold").fontSize(right.size).fillColor(navy).text(v2, rightX + labelW, y, { width: valueW, height: rowH, lineBreak: right.lines === 2 });
    y += rowH;
  }

  doc.fillColor(navy).font("Times-BoldItalic").fontSize(9)
    .text("AUTHORISED BY", px(118), py(798), { width: px(130), align: "left", characterSpacing: 0.6, lineBreak: false });
  const sign = readCertificateSignature(s.signatureChoice);
  if (sign) {
    try {
      // Wide pen mark; fit keeps the real shape so it stays sharp. Signature 2 is a little larger.
      const fit = authorizedSignaturePdfFit(s.signatureChoice, s.signatureSize);
      doc.image(sign, px(112), py(816), { fit: [px(fit.w), py(fit.h)] });
    } catch { /* signature optional */ }
  }
  try {
    const seal = readFileSync(join(__dirname, "..", "..", "ui", "certificate-company-seal.png"));
    doc.image(seal, px(300), py(792), { fit: [px(78), py(78)] });
  } catch { /* seal optional */ }

  const contactX = px(68);
  const contactW = px(168);
  y = py(868);
  doc.fillColor(navy).font("Times-Bold").fontSize(7);
  for (const line of [
    "Westcal Instrumentation and Calibration",
    "Services LLC",
    "Morocco Cluster, International City,",
    "Dubai, UAE.",
    "info@westcal.ae",
    "+971566654326 & +97145762773.",
    "https://westcal.ae/",
  ]) {
    doc.text(line, contactX, y, { width: contactW, lineBreak: false });
    y += 8.6;
  }

  if (qrPng) {
    const qrSize = 78;
    const qrX = px(470);
    const qrY = py(768);
    doc.save();
    doc.rect(qrX - 8, qrY - 8, qrSize + 16, qrSize + 16).fill("#ffffff");
    doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });
    doc.restore();
  }

  if (!fieldsOnly) drawCertificateMarks(doc);
}

export async function sendTrainingCertificatePdf(
  res: ServerResponse,
  job: TrainingJob,
  c: TrainingCertificate,
  verifyUrl?: string,
  hidePhoto = false
): Promise<void> {
  const s = certificateSlots(c, job);
  const qrUrl = verifyUrl || "";
  const qrPng = qrUrl
    ? await QRCode.toBuffer(qrUrl, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 420,
        color: { dark: "#000000", light: "#ffffff" },
      })
    : null;
  const fileTag = hidePhoto ? "certificate-nophoto" : "certificate";
  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true, info: { Title: s.certificateNo } });
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="${s.certificateNo.replace(/[^a-zA-Z0-9_-]/g, "_")}-${fileTag}.pdf"`,
  });
  doc.pipe(res);

  const design = s.design;
  if (design === "letterhead") {
    const logo = await readFile(LOGO).catch(() => null);
    drawWestcalLetterhead(doc, logo);
    doc.fillColor("#17305f").font("Times-Bold").fontSize(22)
      .text("Certificate of Training", 36, 130, { width: 523, align: "center" });
    drawCertificateBody(doc, s, qrPng, 180, 620, 500);
  } else if (design === "navy-gold") {
    drawNavyGoldFrame(doc);
    const logo = await readFile(LOGO).catch(() => null);
    if (logo) {
      try { doc.image(logo, 248, 40, { fit: [100, 62] }); } catch { /* skip */ }
    }
    doc.fillColor("#17305f").font("Times-BoldItalic").fontSize(28)
      .text("Certificate", 70, 120, { width: 455, align: "center" });
    drawCertificateBody(doc, s, qrPng, 200, 620, 500);
  } else if (design.startsWith("file-") && !isAchievementDesign(design)) {
    const files = await readdir(CERTIFICATE_DESIGNS_DIR).catch(() => [] as string[]);
    const match = files.find((f) => `file-${f.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-")}` === design);
    if (match) {
      const bg = await readFile(join(CERTIFICATE_DESIGNS_DIR, match));
      doc.image(bg, 0, 0, { width: 595.28, height: 841.89 });
    }
    drawCertificateBody(doc, s, qrPng, 310, 530, 455);
  } else {
    const artwork = await loadCertificateArtwork();
    drawPrintedCertificate(doc, s, qrPng, artwork, false, hidePhoto);
  }
  applyDocumentControlFooter(doc, DOC_CONTROL.certificate, { pageNumber: false });
  doc.end();
}

/** A4 design only — blank Westcal artwork, no trainee data. For printing the layout. */
export async function sendTrainingCertificateLayoutPdf(
  res: ServerResponse,
  job: TrainingJob,
  c: TrainingCertificate
): Promise<void> {
  const no = c.certificateNo.replace(/[^a-zA-Z0-9_-]/g, "_");
  const artwork = await loadCertificateArtwork();
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    bufferPages: true,
    info: { Title: `${c.certificateNo} design layout` },
  });
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="${no}-layout.pdf"`,
  });
  doc.pipe(res);
  if (artwork) {
    doc.image(artwork, 0, 0, { width: 595.28, height: 841.89 });
  }
  drawCertificateMarks(doc);
  applyDocumentControlFooter(doc, DOC_CONTROL.certificate, { pageNumber: false });
  doc.end();
}

/** A4 inside data only — same positions as the designed certificate, no artwork. Print on the layout. */
export async function sendTrainingCertificateContentPdf(
  res: ServerResponse,
  job: TrainingJob,
  c: TrainingCertificate,
  verifyUrl?: string,
  hidePhoto = false
): Promise<void> {
  const s = certificateSlots(c, job);
  const qrPng = verifyUrl
    ? await QRCode.toBuffer(verifyUrl, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 420,
        color: { dark: "#000000", light: "#ffffff" },
      })
    : null;
  const fileTag = hidePhoto ? "data-nophoto" : "data";
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    bufferPages: true,
    info: { Title: `${s.certificateNo} inside data${hidePhoto ? " without photo" : ""}` },
  });
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="${s.certificateNo.replace(/[^a-zA-Z0-9_-]/g, "_")}-${fileTag}.pdf"`,
  });
  doc.pipe(res);
  drawPrintedCertificate(doc, s, qrPng, null, true, hidePhoto);
  doc.end();
}
