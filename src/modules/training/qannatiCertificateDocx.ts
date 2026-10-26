import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import JSZip from "jszip";
import QRCode from "qrcode";
import {
  authorizedSignatureExtent,
  authorizedSignatureRun,
  certificateSlots,
  companyNameHalfPoints,
  readCertificateSignature,
  shrinkCompanyParagraph,
} from "./certificateTemplate.js";
import { printedTrNo, type TrainingCertificate, type TrainingJob } from "./training.js";

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "templates", "qannati-certificate.docx");

const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** ST / ND / RD / TH — CAPITAL letters, small + raised at the top (affirmation style). */
function daySuffix(day: number): string {
  const teen = day % 100;
  if (teen >= 11 && teen <= 13) return "TH";
  return ({ 1: "ST", 2: "ND", 3: "RD" } as Record<number, string>)[day % 10] ?? "TH";
}

/**
 * Fills only {{START}} (keeps "START ON THIS" and the rest of the template).
 * Like the sample: OCTOBER 01ˢᵀ, 2026 — day 01/10…; only ST/ND/RD/TH is capital + small + top.
 */
function startTokenXml(value: string | undefined): string {
  const raw = String(value ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  const basePr =
    `<w:rPr><w:rFonts w:asciiTheme="majorBidi" w:hAnsiTheme="majorBidi" w:cstheme="majorBidi"/><w:i/><w:iCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>`;
  if (!m) return xmlEscape(raw);
  const day = Number(m[3]);
  const month = MONTHS[Number(m[2]) - 1];
  const year = m[1];
  const dayText = String(day).padStart(2, "0"); // 01, 10 — same as sample
  const suffix = daySuffix(day);
  const superPr =
    `<w:rPr><w:rFonts w:asciiTheme="majorBidi" w:hAnsiTheme="majorBidi" w:cstheme="majorBidi"/><w:i/><w:iCs/><w:sz w:val="16"/><w:szCs w:val="16"/><w:vertAlign w:val="superscript"/></w:rPr>`;
  // Close the template text run, insert date + raised capital suffix + year, continue.
  return (
    `</w:t></w:r>` +
    `<w:r>${basePr}<w:t>${month} ${dayText}</w:t></w:r>` +
    `<w:r>${superPr}<w:t>${suffix}</w:t></w:r>` +
    `<w:r>${basePr}<w:t>, ${year}`
  );
}

/** TR 4782 and tr4782 both print as TR4782. */
function specialJobNo(job: TrainingJob): string {
  return printedTrNo(job);
}

/** The person's employer from the ID back, not the job's certified-to company. */
function specialEmployer(job: TrainingJob, certificate: TrainingCertificate): string {
  const trainee = job.attendees.find((a) => a.id === certificate.attendeeId);
  const pick = [trainee?.company, certificate.company, job.customerName]
    .map((v) => String(v || "").trim())
    .find((v) => v.length > 2);
  return pick || "";
}

/** Smaller QR in the gap, with its top on the Certificate No row. */
const QR_DRAWING = `<w:tbl><w:tblPr><w:tblpPr w:leftFromText="0" w:rightFromText="0" w:vertAnchor="text" w:horzAnchor="page" w:tblpX="6600" w:tblpY="-160"/><w:tblW w:w="1100" w:type="dxa"/><w:tblBorders><w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="1100"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="1100"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="1100" w:type="dxa"/><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="700000" cy="700000"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="21" name="Verify QR"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="21" name="qr.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdQr"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="700000" cy="700000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:tc></w:tr></w:tbl>`;

export async function buildQannatiCertificateDocx(
  job: TrainingJob,
  certificate: TrainingCertificate,
  verifyUrl?: string,
): Promise<Buffer> {
  const s = certificateSlots(certificate, job);
  const employer = specialEmployer(job, certificate).toUpperCase();
  const values: Record<string, string> = {
    "{{NAME}}": xmlEscape(s.name.toUpperCase()),
    "{{EID}}": xmlEscape(s.eid),
    "{{COMPANY}}": xmlEscape(employer),
    "{{COURSE}}": xmlEscape(s.course.toUpperCase()),
    "{{CERTNO}}": xmlEscape(s.certificateNo),
    "{{JOBNO}}": xmlEscape(specialJobNo(job)),
    "{{START}}": startTokenXml(s.trainingDate),
  };
  const zip = await JSZip.loadAsync(await readFile(TEMPLATE));
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("special certificate template is missing");
  let xml = await file.async("string");
  const specialFit = job.specialCompanyFit === "shrink" || job.specialCompanyFit === "same" ? job.specialCompanyFit : s.companyFit;
  xml = shrinkCompanyParagraph(xml, companyNameHalfPoints(employer, 36, specialFit, s.companyScale));
  if (s.idDocument === "passport") xml = xml.replaceAll("EID NO", "Passport No");
  for (const [token, value] of Object.entries(values)) xml = xml.replaceAll(token, value);

  const relsPath = "word/_rels/document.xml.rels";
  const ensureRel = async (id: string, target: string) => {
    const rels = zip.file(relsPath);
    if (!rels) return;
    const relsXml = await rels.async("string");
    if (relsXml.includes(`Id="${id}"`)) return;
    zip.file(
      relsPath,
      relsXml.replace(
        "</Relationships>",
        `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/></Relationships>`,
      ),
    );
  };
  const ensureType = async (ext: string, contentType: string) => {
    const types = zip.file("[Content_Types].xml");
    if (!types) return;
    const typesXml = await types.async("string");
    if (typesXml.includes(`Extension="${ext}"`)) return;
    zip.file(
      "[Content_Types].xml",
      typesXml.replace(
        "</Types>",
        `<Default Extension="${ext}" ContentType="${contentType}"/></Types>`,
      ),
    );
  };

  // Same authorised signature as old / new designs (Signature 1–3 pick).
  const signature = readCertificateSignature(s.signatureChoice);
  if (signature) {
    zip.file("word/media/signature.png", signature);
    await ensureRel("rIdSign", "media/signature.png");
    await ensureType("png", "image/png");
    const { cx, cy } = authorizedSignatureExtent(signature, s.signatureChoice);
    xml = xml.replace(
      "<w:t>Authorized By:</w:t></w:r></w:p>",
      `<w:t>Authorized By:</w:t></w:r>${authorizedSignatureRun(cx, cy)}</w:p>`,
    );
  }

  if (verifyUrl) {
    const png = await QRCode.toBuffer(verifyUrl, { type: "png", margin: 2, width: 480, errorCorrectionLevel: "Q" });
    zip.file("word/media/qr.png", png);
    await ensureRel("rIdQr", "media/qr.png");
    await ensureType("png", "image/png");
    const besideNumbers = `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="text" w:horzAnchor="margin" w:tblpY="-9"/>`;
    xml = xml.includes(besideNumbers)
      ? xml.replace(besideNumbers, `${QR_DRAWING}${besideNumbers}`)
      : xml.replace("<w:sectPr", `${QR_DRAWING}<w:sectPr`);
  }
  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Word sheet for the special certificate design. Certificate Coordinator only. */
export async function sendQannatiCertificateDocx(
  res: ServerResponse,
  job: TrainingJob,
  certificate: TrainingCertificate,
  verifyUrl?: string,
): Promise<void> {
  const buffer = await buildQannatiCertificateDocx(job, certificate, verifyUrl);
  const no = certificate.certificateNo.replace(/[^a-zA-Z0-9_-]/g, "_");
  res.writeHead(200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="${no}-special.docx"`,
  });
  res.end(buffer);
}
