import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import PDFDocument from "pdfkit";
import type { TrainingJob } from "./training.js";
import { applyDocumentControlFooter, DOC_CONTROL, drawWestcalLetterhead } from "./trainingForms.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const WESTCAL = "Westcal Instrumentation and Calibration Services LLC";

export function sheetView(job: TrainingJob) {
  const insigniaName = String(job.sheetInsigniaName ?? "").trim() || WESTCAL;
  const logoSrc = job.sheetInsigniaLogoDataUrl || "/logo.jpg";
  const jobLabel = String(job.sheetJobLabel ?? "").trim() || "WESTCAL Job";
  const jobNo = String(job.sheetJobNo ?? "").trim() || sheetJobNo(job);
  const courseTitle = String(job.sheetCourseTitle ?? "").trim() || job.course || "Training";
  const code = String(job.sheetCourseCode ?? "").trim() || courseCode(job);
  const invoiced = String(job.sheetCompany ?? "").trim() || job.customerName || "";
  const certifiedBy = String(job.certificateUnder ?? "").trim() || invoiced;
  const date = formatDob(job.trainingDate);
  return { insigniaName, logoSrc, jobLabel, jobNo, courseTitle, code, invoiced, certifiedBy, date, time: "" };
}

function html(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]!);
}

function dataUrlBuffer(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

export function sheetJobNo(job: TrainingJob): string {
  const raw = job.jobOrderNo || job.jobNo || "";
  const digits = String(raw).replace(/\D/g, "");
  return digits || String(raw);
}

function courseCode(job: TrainingJob): string {
  const first = String(job.course || "TRAINING").split(" · ")[0].trim();
  return first.toUpperCase();
}

function traineePhoto(a: { photoDataUrl?: string; extraPhotoDataUrl?: string }): string {
  return a.photoDataUrl || a.extraPhotoDataUrl || "";
}

function formatDob(value?: string): string {
  const raw = String(value ?? "").trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return raw || "-";
}

function traineeRow(job: TrainingJob, a: TrainingJob["attendees"][number], i: number, canSign: boolean): string {
  const photo = traineePhoto(a);
  const course = a.course || job.course || "";
  const signCell = canSign
    ? `<div class="sigcell">
        <canvas class="sig" data-id="${html(a.id)}" ${a.signature ? `data-src="${html(a.signature)}"` : ""}></canvas>
        <button type="button" class="clr" data-id="${html(a.id)}">Clear</button>
        <button type="button" class="sigsubmit" data-id="${html(a.id)}">Submit</button>
      </div>`
    : (a.signature ? `<img class="sg" src="${a.signature}" alt="signature">` : "");
  return `<tr>
    <td class="num">${i + 1}</td>
    <td>
      <b>${html(a.name)}</b><br>
      <span class="sub">EID: ${html(a.idOrVisaNo || "-")}</span><br>
      <span class="sub">Training Date: ${html(formatDob(job.trainingDate))}</span><br>
      <span class="sub">Certified to: ${html(String(job.certificateUnder ?? "").trim() || a.company || job.customerName)}</span><br>
      <span class="sub">Course: ${html(course)}</span>
    </td>
    <td class="pic">${photo ? `<img src="${photo}" alt="">` : ""}</td>
    <td class="sigcol">${signCell}</td>
  </tr>`;
}

function westcalHeadHtml(logoSrc: string): string {
  return `<div class="wc">
    <div class="wc-top">
      <div class="wc-ct">T: +9714 576 2773<br>M: +971 56 665 4326<br>E: training@westcal.ae<br>W: www.westcal.ae</div>
      <img src="${html(logoSrc)}" alt="WESTCAL">
    </div>
    <div class="wc-bar">WESTCAL INSTRUMENTATION AND CALIBRATION SERVICES LLC</div>
  </div>`;
}

export function attendancePublicHtml(job: TrainingJob, publicUrl: string): string {
  const closed = job.status === "Approved" || job.status === "Cancelled";
  const rows = job.attendees.map((a, i) => traineeRow(job, a, i, !closed)).join("");
  const s = sheetView(job);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${html(s.jobLabel.replace(/ Job$/i, ""))}${html(s.jobNo)} — Attendance of ${html(s.courseTitle)}</title>
  <style>
    body{margin:0;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;color:#222}
    .page{max-width:920px;margin:20px auto;background:#fff;padding:0 0 28px;border:1px solid #d5dde8}
    .wc-top{display:flex;justify-content:space-between;align-items:center;padding:14px 28px 10px}
    .wc-ct{font:bold 12px/1.45 Times New Roman,Times,serif;color:#151515}
    .wc img{height:56px}
    .wc-bar{background:#4d83bc;color:#fff;text-align:center;font:700 13px Arial,sans-serif;padding:9px 12px}
    .inner{padding:18px 28px 0}
    h2{margin:8px 0 4px;font-size:20px;text-align:center}
    .subhead{margin:0 0 14px;color:#555;font-size:13px;text-align:center}
    table.info,table.list{width:100%;border-collapse:collapse;margin-top:14px}
    table.info td{border:1px solid #ccc;padding:10px 12px;font-size:14px}
    table.info td:first-child{width:160px;background:#fafafa;font-weight:700}
    table.list th,table.list td{border:1px solid #ccc;padding:10px;vertical-align:top;text-align:left}
    table.list th{background:#f7f7f7}
    .num{width:36px;text-align:center}
    .pic{width:90px;text-align:center}
    .pic img{height:72px;max-width:78px;object-fit:cover}
    .sigcol{width:180px;text-align:center}
    .sigcol img.sg{height:48px;max-width:150px;object-fit:contain}
    .sigcell{display:flex;flex-direction:column;align-items:stretch;gap:6px}
    canvas.sig{width:160px;height:72px;border:1px dashed #8aa0bc;background:#fafafa;touch-action:none;display:block;margin:0 auto}
    .clr,.sigsubmit{padding:6px 10px;border-radius:8px;font:700 12px Arial;cursor:pointer}
    .clr{background:#fff;color:#0b4f9c;border:1px solid #0b4f9c}
    .sigsubmit{background:#0b4f9c;color:#fff;border:1px solid #0b4f9c}
    .sub{color:#555;font-size:12px}
    .count{margin-top:14px;font-weight:700}
    .link{margin-top:10px;font-size:12px;word-break:break-all;color:#334}
    a.dl{display:inline-block;margin-top:10px;background:#0b4f9c;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font:700 13px Arial}
    .docctl{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:28px 28px 0;padding-top:10px;border-top:1px solid #ddd;font:italic 11px Times New Roman,Times,serif;color:#1a2744}
    .docctl .pg{font-style:normal;font-weight:700;font-size:12px}
    @media print{body{background:#fff}.page{margin:0;border:0}canvas.sig,.clr,.sigsubmit{display:none}}
  </style></head><body>
  <div class="page">
    ${westcalHeadHtml(s.logoSrc)}
    <div class="inner">
    <h2>Attendance of ${html(s.courseTitle)}</h2>
    <p class="subhead">${html(s.courseTitle)} | ${html(s.date)} | ${html(s.invoiced)}</p>
    <table class="info">
      <tr><td>${html(s.jobLabel)}</td><td><b>${html(s.jobNo)}</b></td></tr>
      <tr><td>Training</td><td><b>${html(s.courseTitle)}</b></td></tr>
      <tr><td>Training date</td><td><b>${html(s.date)}</b></td></tr>
      <tr><td>Company</td><td><b>${html(s.invoiced)}</b></td></tr>
      <tr><td>Certified to</td><td><b>${html(s.certifiedBy)}</b></td></tr>
    </table>
    <table class="list">
      <thead><tr><th>#</th><th>Trainee</th><th>Photo</th><th>Signature</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="count">Trainees: ${job.attendees.length}${job.expectedTraineeCount ? " / " + job.expectedTraineeCount : ""}</div>
    <p><a class="dl" href="/public/training/${html(job.id)}/pdf">Download attendance sheet</a></p>
    ${job.trainerVerified ? `<p><b>Attendance verified by trainer</b></p>` : ""}
    ${job.trainerSignature ? `<p>Authorized by: ${html(job.authorizedBy || job.assigneeName || job.trainerName || "")}<br><img src="${job.trainerSignature}" alt="authorized by" style="height:42px"></p>` : ""}
    <div class="link">Public link: ${html(publicUrl)}</div>
    </div>
    <div class="docctl"><span>${html(DOC_CONTROL.attendance)}</span><span class="pg">Page 1 of 1</span></div>
  </div>
  ${closed ? "" : `<script>
  const jobId=${JSON.stringify(job.id)};
  function save(id, data){
    return fetch("/api/public/training/"+jobId+"/attendees/"+id+"/signature",{
      method:"PATCH", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({signature:data||""})
    });
  }
  function bind(cv){
    const id=cv.getAttribute("data-id");
    const ctx=cv.getContext("2d");
    let drawing=false, dirty=false;
    function size(keep){
      const dpr=window.devicePixelRatio||1;
      const r=cv.getBoundingClientRect();
      const prev=keep?cv.toDataURL("image/png"):null;
      ctx.setTransform(1,0,0,1,0,0);
      cv.width=Math.max(1,Math.round(r.width*dpr));
      cv.height=Math.max(1,Math.round(r.height*dpr));
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.lineWidth=2.2; ctx.lineCap="round"; ctx.lineJoin="round"; ctx.strokeStyle="#12203a";
      const src=prev||cv.getAttribute("data-src");
      if(src){
        const img=new Image();
        img.onload=()=>ctx.drawImage(img,0,0,r.width,r.height);
        img.src=src;
      }
    }
    size(false);
    const pt=e=>{
      const t=e.touches&&e.touches[0];
      const x=t?t.clientX:e.clientX, y=t?t.clientY:e.clientY;
      const b=cv.getBoundingClientRect();
      return {x:x-b.left,y:y-b.top};
    };
    function start(e){ e.preventDefault(); drawing=true; dirty=true; const p=pt(e); ctx.beginPath(); ctx.moveTo(p.x,p.y); }
    function move(e){ if(!drawing)return; e.preventDefault(); const p=pt(e); ctx.lineTo(p.x,p.y); ctx.stroke(); }
    function end(e){ if(!drawing)return; e&&e.preventDefault(); drawing=false; }
    cv.addEventListener("pointerdown", e=>{ start(e); try{cv.setPointerCapture(e.pointerId)}catch(x){} });
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("touchstart", start, {passive:false});
    cv.addEventListener("touchmove", move, {passive:false});
    cv.addEventListener("touchend", end, {passive:false});
    const clr=document.querySelector('button.clr[data-id="'+id+'"]');
    const sub=document.querySelector('button.sigsubmit[data-id="'+id+'"]');
    if(clr) clr.onclick=()=>{ cv.removeAttribute("data-src"); size(false); save(id, ""); if(sub) sub.textContent="Submit"; };
    if(sub) sub.onclick=async ()=>{
      const data=cv.toDataURL("image/png");
      const r=await save(id, data);
      if(r.ok){ cv.setAttribute("data-src", data); sub.textContent="Submitted"; }
    };
  }
  document.querySelectorAll("canvas.sig").forEach(bind);
  </script>`}
  </body></html>`;
}

export async function sendAttendanceSheetPdf(
  res: ServerResponse,
  job: TrainingJob,
  publicUrl: string
): Promise<void> {
  const s = sheetView(job);
  const fileLogo = await readFile(join(__dirname, "../../ui/logo.jpg")).catch(() => null);
  const logo = s.logoSrc.startsWith("data:") ? dataUrlBuffer(s.logoSrc) : fileLogo;
  const no = s.jobNo;
  const doc = new PDFDocument({ size: "A4", margin: 36, bufferPages: true, info: { Title: `${s.jobLabel}-${no} attendance` } });
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${String(no).replace(/[^\w-]+/g, "_")}-attendance.pdf"`,
  });
  doc.pipe(res);
  const navy = "#17305f";
  drawWestcalLetterhead(doc, logo);
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(16)
    .text("Attendance Sheet", 36, 128, { align: "center" });
  doc.font("Helvetica").fontSize(10).fillColor("#444")
    .text(`${s.courseTitle}  |  ${s.date}  |  ${s.invoiced}`, { align: "center" });
  doc.moveDown(0.8);
  const info: [string, string][] = [
    [s.jobLabel, no],
    ["Training", s.courseTitle],
    ["Training date", s.date],
    ["Company", s.invoiced],
    ["Certified to", s.certifiedBy],
  ];
  info.forEach(([label, value]) => {
    const y = doc.y;
    const pad = 7;
    doc.font("Helvetica").fontSize(10);
    const textH = Math.max(12, doc.heightOfString(String(value || "-"), { width: 378 }));
    const h = Math.max(24, textH + pad * 2);
    doc.rect(36, y, 523, h).stroke("#bbb");
    doc.fillColor("#111").font("Helvetica-Bold").fontSize(10)
      .text(label, 42, y + pad, { width: 120, lineBreak: false });
    doc.font("Helvetica").text(String(value || "-"), 170, y + pad, { width: 378 });
    doc.y = y + h;
  });
  doc.moveDown(0.6);
  const headerY = doc.y;
  doc.font("Helvetica-Bold").fontSize(10);
  doc.rect(36, headerY, 523, 20).fillAndStroke("#f3f3f3", "#bbb");
  doc.fillColor("#111").text("#", 42, headerY + 5, { width: 24 });
  doc.text("Trainee", 70, headerY + 5, { width: 250 });
  doc.text("Photo", 330, headerY + 5, { width: 90 });
  doc.text("Signature", 430, headerY + 5, { width: 120 });
  doc.y = headerY + 20;
  job.attendees.forEach((a, i) => {
    if (doc.y > 700) doc.addPage();
    const y = doc.y;
    const rowH = 88;
    doc.rect(36, y, 523, rowH).stroke("#bbb");
    doc.fillColor("#111").font("Helvetica").fontSize(10).text(String(i + 1), 42, y + 10, { width: 24 });
    doc.font("Helvetica-Bold").text(a.name, 70, y + 8, { width: 250 });
    doc.font("Helvetica").fontSize(9).fillColor("#444")
      .text(`EID: ${a.idOrVisaNo || "-"}`, 70, y + 24, { width: 250 })
      .text(`Training date: ${formatDob(job.trainingDate)}`, 70, y + 36, { width: 250 })
      .text(`Certified to: ${String(job.certificateUnder ?? "").trim() || a.company || job.customerName}`, 70, y + 48, { width: 250 })
      .text(a.course || job.course || "", 70, y + 60, { width: 250, height: 22, ellipsis: true });
    const photo = traineePhoto(a);
    if (photo) {
      try { doc.image(dataUrlBuffer(photo), 338, y + 8, { fit: [54, 62] }); } catch { /* skip */ }
    }
    if (a.signature) {
      try { doc.image(dataUrlBuffer(a.signature), 430, y + 18, { fit: [110, 42] }); } catch { /* skip */ }
    }
    doc.y = y + rowH;
  });
  doc.moveDown(0.8);
  const ay = doc.y;
  doc.rect(36, ay, 523, 88).stroke("#bbb");
  doc.fillColor("#111").font("Helvetica-Bold").fontSize(10)
    .text("Authorized by", 42, ay + 8);
  if (job.trainerSignature) {
    try { doc.image(dataUrlBuffer(job.trainerSignature), 42, ay + 24, { fit: [180, 42] }); } catch { /* skip */ }
  }
  doc.font("Helvetica").fontSize(10)
    .text(job.authorizedBy || job.assigneeName || job.trainerName || "", 42, ay + 70, { width: 250 });
  if (job.trainerVerified) {
    doc.font("Helvetica-Bold").text("Attendance verified", 300, ay + 36, { width: 240 });
  }
  applyDocumentControlFooter(doc, DOC_CONTROL.attendance);
  doc.end();
}
