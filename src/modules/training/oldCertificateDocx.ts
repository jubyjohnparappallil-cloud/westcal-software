import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import JSZip from "jszip";
import QRCode from "qrcode";
import {
  certificateSlots,
  companyNameHalfPoints,
  readCertificateSignature,
  shrinkCompanyParagraph,
} from "./certificateTemplate.js";
import { printedTrNo, type TrainingCertificate, type TrainingJob } from "./training.js";

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "templates", "old-certificate.docx");

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** yyyy-mm-dd printed as dd-mm-yyyy, matching the old Word certificate. */
function oldDate(value: string | undefined): string {
  const raw = String(value ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : raw;
}

/** The old sheet prints the job order, such as TR4800, not the WC certificate number. */
function oldJobNo(job: TrainingJob): string {
  return printedTrNo(job);
}

/** Small QR above the gold seal, to the right of the certificate details. */
const QR_DRAWING = `<w:tbl><w:tblPr><w:tblpPr w:leftFromText="0" w:rightFromText="0" w:vertAnchor="text" w:horzAnchor="page" w:tblpX="9000" w:tblpY="-720"/><w:tblW w:w="1100" w:type="dxa"/><w:tblBorders><w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="1100"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="1100"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="1100" w:type="dxa"/><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="700000" cy="700000"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="20" name="Verify QR"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="20" name="qr.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdQr"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="700000" cy="700000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:tc></w:tr></w:tbl>`;

/** Float signature to the right of "Authorized By:" without growing the paragraph. */
function signatureRun(cx: number, cy: number): string {
  return `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="character"><wp:posOffset>120000</wp:posOffset></wp:positionH><wp:positionV relativeFrom="line"><wp:posOffset>-60000</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="21" name="Authorized signature"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="21" name="signature.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdSign"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
}

function pngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  return null;
}

/** About 1.45 inch wide, height from the real signature shape so Word does not stretch/blur it. */
function signatureExtent(buf: Buffer): { cx: number; cy: number } {
  const size = pngSize(buf);
  const cx = 1320000;
  if (!size?.w || !size?.h) return { cx, cy: 400000 };
  const cy = Math.max(220000, Math.min(520000, Math.round((cx * size.h) / size.w)));
  return { cx, cy };
}

export async function buildOldCertificateDocx(
  job: TrainingJob,
  certificate: TrainingCertificate,
  verifyUrl?: string,
): Promise<Buffer> {
  const s = certificateSlots(certificate, job);
  const idNumber = s.idDocument === "passport" ? s.eid.toUpperCase() : s.eid;
  const values: Record<string, string> = {
    "{{NAME}}": xmlEscape(s.name.toUpperCase()),
    "{{EID}}": xmlEscape(idNumber),
    "{{COMPANY}}": xmlEscape(s.company.toUpperCase()),
    "{{COURSE}}": xmlEscape(s.course.toUpperCase()),
    "{{CERTNO}}": xmlEscape(s.certificateNo),
    "{{JOBNO}}": xmlEscape(oldJobNo(job)),
    "{{TRAINING}}": xmlEscape(oldDate(s.trainingDate)),
    "{{EXPIRY}}": xmlEscape(oldDate(s.expiresOn)),
  };
  const zip = await JSZip.loadAsync(await readFile(TEMPLATE));
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("old certificate template is missing");
  let xml = await file.async("string");
  xml = shrinkCompanyParagraph(xml, companyNameHalfPoints(s.company, 40, s.companyFit, s.companyScale));
  if (s.idDocument === "passport") xml = xml.replaceAll("EID NO", "PASSPORT NO");
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
        "<Default Extension=\"rels\"",
        `<Default Extension="${ext}" ContentType="${contentType}"/><Default Extension="rels"`,
      ),
    );
  };

  const signature = readCertificateSignature(s.signatureChoice);
  if (signature) {
    zip.file("word/media/signature.png", signature);
    await ensureRel("rIdSign", "media/signature.png");
    await ensureType("png", "image/png");
    const { cx, cy } = signatureExtent(signature);
    // Keep the original paragraph height. Only float the signature to the right.
    xml = xml.replace(
      "<w:t>Authorized By:</w:t></w:r></w:p>",
      `<w:t>Authorized By:</w:t></w:r>${signatureRun(cx, cy)}</w:p>`,
    );
  }

  if (verifyUrl) {
    const png = await QRCode.toBuffer(verifyUrl, { type: "png", margin: 2, width: 480, errorCorrectionLevel: "Q" });
    zip.file("word/media/qr.png", png);
    await ensureRel("rIdQr", "media/qr.png");
    await ensureType("png", "image/png");
    xml = xml.replace("</w:tbl><w:p w14:paraId=\"44007595\"", `</w:tbl>${QR_DRAWING}<w:p w14:paraId="44007595"`);
  }
  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Word data sheet that lines up on the old certificate design. */
export async function sendOldCertificateDocx(
  res: ServerResponse,
  job: TrainingJob,
  certificate: TrainingCertificate,
  verifyUrl?: string,
): Promise<void> {
  const buffer = await buildOldCertificateDocx(job, certificate, verifyUrl);
  const no = certificate.certificateNo.replace(/[^a-zA-Z0-9_-]/g, "_");
  res.writeHead(200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="${no}-old-design.docx"`,
  });
  res.end(buffer);
}
