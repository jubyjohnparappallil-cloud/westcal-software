import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import JSZip from "jszip";
import QRCode from "qrcode";
import { certificateSlots, companyNameHalfPoints, shrinkCompanyParagraph } from "./certificateTemplate.js";
import { printedTrNo, type TrainingCertificate, type TrainingJob } from "./training.js";

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "templates", "qannati-certificate.docx");

const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 7 October 2026 becomes OCTOBER 07TH, 2026, matching the special certificate. */
function startOn(value: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? "").trim());
  if (!m) return String(value ?? "").trim();
  const day = Number(m[3]);
  const teen = day % 100;
  const suffix = teen >= 11 && teen <= 13 ? "TH" : ({ 1: "ST", 2: "ND", 3: "RD" } as Record<number, string>)[day % 10] ?? "TH";
  return `${MONTHS[Number(m[2]) - 1]} ${String(day).padStart(2, "0")}${suffix}, ${m[1]}`;
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

/** Smaller QR, a little higher, to the right of the special certificate details. */
const QR_DRAWING = `<w:tbl><w:tblPr><w:tblpPr w:leftFromText="0" w:rightFromText="0" w:vertAnchor="text" w:horzAnchor="page" w:tblpX="9000" w:tblpY="-520"/><w:tblW w:w="1100" w:type="dxa"/><w:tblBorders><w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="1100"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="1100"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="1100" w:type="dxa"/><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="700000" cy="700000"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="21" name="Verify QR"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="21" name="qr.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdQr"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="700000" cy="700000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:tc></w:tr></w:tbl>`;

export async function buildQannatiCertificateDocx(
  job: TrainingJob,
  certificate: TrainingCertificate,
  verifyUrl?: string,
): Promise<Buffer> {
  const s = certificateSlots(certificate, job);
  const values: Record<string, string> = {
    "{{NAME}}": xmlEscape(s.name.toUpperCase()),
    "{{EID}}": xmlEscape(s.eid),
    "{{COMPANY}}": xmlEscape(specialEmployer(job, certificate).toUpperCase()),
    "{{COURSE}}": xmlEscape(s.course.toUpperCase()),
    "{{CERTNO}}": xmlEscape(s.certificateNo),
    "{{JOBNO}}": xmlEscape(specialJobNo(job)),
    "{{START}}": xmlEscape(startOn(s.trainingDate)),
  };
  const zip = await JSZip.loadAsync(await readFile(TEMPLATE));
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("special certificate template is missing");
  let xml = await file.async("string");
  xml = shrinkCompanyParagraph(xml, companyNameHalfPoints(s.company, 36, s.companyFit, s.companyScale));
  if (s.idDocument === "passport") xml = xml.replaceAll("EID NO", "Passport No");
  for (const [token, value] of Object.entries(values)) xml = xml.replaceAll(token, value);
  if (verifyUrl) {
    const png = await QRCode.toBuffer(verifyUrl, { type: "png", margin: 2, width: 480, errorCorrectionLevel: "Q" });
    zip.file("word/media/qr.png", png);
    const relsPath = "word/_rels/document.xml.rels";
    const rels = zip.file(relsPath);
    if (rels) {
      const relsXml = await rels.async("string");
      zip.file(
        relsPath,
        relsXml.replace(
          "</Relationships>",
          `<Relationship Id="rIdQr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/qr.png"/></Relationships>`,
        ),
      );
    }
    const types = zip.file("[Content_Types].xml");
    if (types) {
      const typesXml = await types.async("string");
      if (!typesXml.includes('Extension="png"')) {
        zip.file(
          "[Content_Types].xml",
          typesXml.replace(
            "</Types>",
            `<Default Extension="png" ContentType="image/png"/></Types>`,
          ),
        );
      }
    }
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
