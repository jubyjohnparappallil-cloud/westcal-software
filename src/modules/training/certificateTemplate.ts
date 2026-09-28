import type { ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import type { TrainingCertificate, TrainingJob } from "./training.js";
import { applyDocumentControlFooter, DOC_CONTROL, drawWestcalLetterhead } from "./trainingForms.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CERTIFICATE_BG = join(__dirname, "..", "..", "ui", "certificate-bg.png");
export const CERTIFICATE_ACHIEVEMENT = join(__dirname, "..", "..", "ui", "certificate-achievement.png");
export const CERTIFICATE_ACHIEVEMENT_BLANK = join(__dirname, "..", "..", "ui", "certificate-achievement-blank.png");
export const CERTIFICATE_ACHIEVEMENT_BLANK_HD = join(__dirname, "..", "..", "ui", "certificate-achievement-blank-hd.png");
export const CERTIFICATE_DESIGNS_DIR = join(__dirname, "..", "..", "ui", "certificates");
const LOGO = join(__dirname, "..", "..", "ui", "logo.jpg");
const CERTIFICATE_MARKS = join(__dirname, "..", "..", "ui", "certificate-marks.png");

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

type PdfDoc = InstanceType<typeof PDFDocument>;
type CertSlots = ReturnType<typeof certificateSlots>;

export function certificateSlots(c: TrainingCertificate, job: TrainingJob) {
  const trainee = job.attendees.find((a) => a.id === c.attendeeId);
  return {
    name: c.name,
    eid: c.idOrVisaNo || trainee?.idOrVisaNo || "",
    company: (() => {
      const pick = [c.company, job.certificateUnder, trainee?.company, job.customerName]
        .map((v) => String(v || "").trim())
        .find((v) => v.length > 2);
      return pick || "";
    })(),
    course: (c.course || "").trim(),
    certificateNo: c.certificateNo,
    jobNo: c.jobNo || job.jobNo,
    orderNo: job.jobOrderNo || job.jobNo,
    trainingDate: c.trainingDate,
    trainingTime: job.trainingTime || "",
    expiresOn: c.expiresOn,
    authorizedBy: job.authorizedBy || job.assigneeName || job.trainerName || "",
    authorizedSignature: job.trainerSignature || "",
    traineeSignature: trainee?.signature || "",
    photoDataUrl: trainee?.extraPhotoDataUrl || trainee?.photoDataUrl || "",
    qrDataUrl: c.qrDataUrl || "",
    design: "achievement",
  };
}

async function loadCertificateArtwork(): Promise<Buffer | null> {
  return readFile(CERTIFICATE_ACHIEVEMENT_BLANK).catch(
    () => readFile(CERTIFICATE_ACHIEVEMENT_BLANK_HD).catch(
      () => readFile(CERTIFICATE_ACHIEVEMENT).catch(() => null)
    )
  );
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
    doc.fillColor("#111").font("Times-Bold").fontSize(11)
      .text(`(EID NO: ${s.eid})`, x, y, { width: w, align: "center" });
    y = doc.y + 8;
  }
  doc.fillColor("#333").font("Times-Italic").fontSize(11)
    .text("Employed by", x, y, { width: w, align: "center" });
  y = doc.y + 4;
  doc.fillColor(navy).font("Times-Bold").fontSize(13)
    .text(s.company.toUpperCase(), x, y, { width: w, align: "center" });
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
  const company = String(job.certificateUnder || c.company || job.customerName || "-");
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
.west-cert{position:relative;width:min(720px,100vw);aspect-ratio:210/297;background:#fff url(/certificate-achievement-blank.png?v=20260928d) center/100% 100% no-repeat;overflow:hidden;text-align:center;font-family:"Times New Roman",Times,serif;color:#16325c;container-type:inline-size}
.cert-photo{position:absolute;right:13%;top:54.2%;width:12%;aspect-ratio:1;height:auto;overflow:hidden;border:2px solid #c9a227;background:#eee;z-index:2}
.cert-photo img{position:absolute;top:0;left:-12.5%;width:125%;height:182%;object-fit:cover;object-position:center top;display:block}
.cert-marks{position:absolute;left:38%;top:79.6%;width:19%;height:auto;z-index:2;pointer-events:none}
.cert-name{position:absolute;left:8%;right:28%;top:54.6%;text-align:center;font-weight:700;font-size:2.15cqi;text-transform:uppercase;white-space:nowrap;line-height:1;color:#16325c}
.cert-rule{position:absolute;left:32%;width:18%;top:57.4%;border:0;border-top:1px solid #222;margin:0}
.lead{position:absolute;left:10%;right:28%;top:58.4%;text-align:center;font-style:italic;font-weight:700;font-size:1.45cqi;color:#16325c;white-space:nowrap}
.cert-course{position:absolute;left:8%;right:28%;top:62.2%;text-align:center;font-weight:700;font-size:2cqi;text-transform:uppercase;color:#16325c;white-space:nowrap}
.meta-col{position:absolute;top:68.2%;font-weight:700;font-size:1.45cqi;color:#16325c;text-align:left;line-height:1.85}
.meta-left{left:14%}
.meta-right{left:54%}
.meta-col span{display:inline-block;min-width:13.5cqi}
.auth{position:absolute;left:15%;top:77%;width:30%;text-align:left;font-weight:700;font-style:italic;letter-spacing:.8px;font-size:1.6cqi}
.contact{position:absolute;left:9%;top:85.6%;width:28%;text-align:left;font-weight:700;font-size:1.12cqi;line-height:1.15;color:#16325c}
.qr{position:absolute;right:32%;top:76.4%;width:10%;background:#fff;padding:2px;box-sizing:border-box;z-index:2}
.qr img{width:100%;height:auto;display:block;background:#fff}
</style></head><body>
<div class="page"><div class="west-cert">
  ${photo}
  <img class="cert-marks" src="/certificate-marks.png?v=20260928e" alt="">
  <div class="cert-name">${esc(s.name)}</div>
  <hr class="cert-rule">
  <div class="lead">has successfully completed one day safety training for</div>
  <div class="cert-course">${esc(s.course)}</div>
  <div class="meta-col meta-left">
    <div><span>EID Number</span> ${esc(s.eid || "-")}</div>
    <div><span>Employed by</span> ${esc(company)}</div>
    <div><span>Training Date</span> ${esc(formatCertDate(s.trainingDate))}</div>
  </div>
  <div class="meta-col meta-right">
    <div><span>Certificate No.</span> ${esc(s.certificateNo)}</div>
    <div><span>Job No.</span> ${esc(job.jobNo || s.jobNo)}</div>
    <div><span>Expiry Date</span> ${esc(formatCertDate(s.expiresOn))}</div>
  </div>
  <div class="auth">AUTHORISED BY</div>
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
    const photoX = px(576);
    const photoY = py(555);
    const photoW = px(92);
    const photoH = photoW;
    doc.save();
    doc.rect(photoX, photoY, photoW, photoH).clip();
    if (s.photoDataUrl) {
      try {
        const buf = dataUrlBuffer(s.photoDataUrl);
        doc.image(buf, photoX - photoW * 0.125, photoY, { width: photoW * 1.25, height: photoH / 0.55 });
      } catch { /* skip */ }
    }
    doc.restore();
    doc.save();
    doc.lineWidth(1.1).strokeColor(gold).rect(photoX - 1.2, photoY - 1.2, photoW + 2.4, photoH + 2.4).stroke();
    doc.restore();
  }

  const textLeft = px(70);
  const textRight = px(560);
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
  const rightX = px(415);
  const labelW = px(108);
  const valueW = px(130);
  const meta: Array<[string, string, string, string]> = [
    ["EID Number", s.eid || "-", "Certificate No.", s.certificateNo],
    ["Employed by", s.company || "-", "Job No.", s.orderNo || s.jobNo],
    ["Training Date", formatCertDate(s.trainingDate), "Expiry Date", formatCertDate(s.expiresOn)],
  ];
  for (const [l1, v1, l2, v2] of meta) {
    doc.font("Times-Bold").fontSize(8).fillColor(navy).text(l1, leftX, y, { width: labelW, lineBreak: false });
    doc.font("Times-Bold").fontSize(8).fillColor(navy).text(v1, leftX + labelW, y, { width: valueW, lineBreak: false });
    doc.font("Times-Bold").fontSize(8).fillColor(navy).text(l2, rightX, y, { width: labelW, lineBreak: false });
    doc.font("Times-Bold").fontSize(8).fillColor(navy).text(v2, rightX + labelW, y, { width: valueW, lineBreak: false });
    y += py(18);
  }

  doc.fillColor(navy).font("Times-BoldItalic").fontSize(9)
    .text("AUTHORISED BY", px(118), py(798), { width: px(200), align: "left", characterSpacing: 0.6, lineBreak: false });

  const contactX = px(68);
  const contactW = px(200);
  y = py(880);
  doc.fillColor(navy).font("Times-Bold").fontSize(7.5);
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
    y += 9.2;
  }

  if (qrPng) {
    const qrSize = 58;
    const qrX = px(445);
    const qrY = py(790);
    doc.save();
    doc.rect(qrX - 3, qrY - 3, qrSize + 6, qrSize + 6).fill("#ffffff");
    doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });
    doc.restore();
  }

  try {
    const marks = readFileSync(CERTIFICATE_MARKS);
    const markW = 113;
    const markH = markW * (84 / 272);
    doc.image(marks, 227, 672, { width: markW, height: markH });
  } catch { /* skip */ }
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
        width: 640,
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
  applyDocumentControlFooter(doc, DOC_CONTROL.certificate);
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
  applyDocumentControlFooter(doc, DOC_CONTROL.certificate);
  doc.end();
}

/** A4 inside data only — same positions as the designed certificate, no artwork. Print on the layout. */
export async function sendTrainingCertificateContentPdf(
  res: ServerResponse,
  job: TrainingJob,
  c: TrainingCertificate,
  verifyUrl?: string
): Promise<void> {
  const s = certificateSlots(c, job);
  const qrPng = verifyUrl
    ? await QRCode.toBuffer(verifyUrl, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 640,
        color: { dark: "#000000", light: "#ffffff" },
      })
    : null;
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    bufferPages: true,
    info: { Title: `${s.certificateNo} inside data` },
  });
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="${s.certificateNo.replace(/[^a-zA-Z0-9_-]/g, "_")}-data.pdf"`,
  });
  doc.pipe(res);
  drawPrintedCertificate(doc, s, qrPng, null, true);
  applyDocumentControlFooter(doc, DOC_CONTROL.certificate);
  doc.end();
}
