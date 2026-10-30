import { certDate, printedTrNo } from "../lib/jobs";
import type { Certificate, Job } from "../types";

function employerTextSize(text: string, scale: unknown, fit: unknown): string {
  if (fit !== "shrink") return "1em";
  const n = Number(scale);
  const safe = Number.isFinite(n) ? Math.min(1, Math.max(0.55, n)) : 1;
  const len = text.trim().length;
  const base = len > 52 ? 0.78 : len > 40 ? 0.88 : len > 28 ? 0.95 : 1;
  return `${(base * safe).toFixed(2)}em`;
}

export function CertificatePreview({ c, j }: { c: Certificate; j: Job }) {
  const ref = c.verificationRef ? encodeURIComponent(c.verificationRef) : "";
  const attendee = (j.attendees || []).find((a) => a.id === c.attendeeId);
  const photo = attendee && (attendee.photoDataUrl || attendee.extraPhotoDataUrl);
  const design = j.certificateDesign || "achievement";
  // Employed by = ID / trainee employer. Certified to is a separate job field.
  const employer =
    [attendee?.company, c.company, j.customerName]
      .map((v) => String(v || "").trim())
      .find((v) => v.length > 2) || "-";
  const employerFont = employerTextSize(employer, j.companyScale, j.companyFit);
  return (
    <div className={`west-cert design-${design}`}>
      {photo && (
        <div className="cert-photo">
          <img src={photo} alt="" />
        </div>
      )}
      {design === "achievement" && <img className="cert-marks" src="/certificate-marks.png?v=20261007m" alt="KHDA permit" />}
      <div className="cert-name">{c.name || ""}</div>
      <hr className="cert-rule" />
      <div className="lead">has successfully completed one day safety training for</div>
      <div
        className="cert-course"
        style={{
          fontSize: (() => {
            const len = String(c.course || "").trim().length;
            if (len > 100) return "1.05cqi";
            if (len > 80) return "1.2cqi";
            if (len > 55) return "1.4cqi";
            if (len > 40) return "1.65cqi";
            return undefined;
          })(),
        }}
      >
        {c.course || ""}
      </div>
      <div className="meta-col meta-left">
        <div>
          <span>{(c.idDocument || attendee?.idDocument) === "passport" ? "Passport No" : "EID Number"}</span> {c.idOrVisaNo || "-"}
        </div>
        <div>
          <span>Employed by</span> <b className="employer" style={{ fontSize: employerFont }}>{employer}</b>
        </div>
        <div>
          <span>Training Date</span> {certDate(c.trainingDate)}
        </div>
      </div>
      <div className="meta-col meta-right">
        <div>
          <span>Certificate No.</span> {c.certificateNo || ""}
        </div>
        <div>
          <span>Job No.</span> {printedTrNo(j) || "-"}
        </div>
        <div>
          <span>Expiry Date</span> {certDate(c.expiresOn)}
        </div>
      </div>
      <div className="auth">AUTHORISED BY</div>
      <img
        className="auth-sign"
        src={`/certificate-signature-${
          c.certificateSignature === "2" || c.certificateSignature === "3"
            ? c.certificateSignature
            : j.certificateSignature === "2" || j.certificateSignature === "3"
              ? j.certificateSignature
              : "1"
        }.png?v=20261026qr`}
        alt="Authorized signature"
      />
      <div className="contact">
        Westcal Instrumentation and Calibration
        <br />
        Services LLC
        <br />
        Morocco Cluster, International City,
        <br />
        Dubai, UAE.
        <br />
        info@westcal.ae
        <br />
        +971566654326 & +97145762773.
        <br />
        https://westcal.ae/
      </div>
      {c.verificationRef && (
        <div className="qr">
          <img src={`/verify/${ref}/qr.png`} alt="Scan to verify" />
        </div>
      )}
    </div>
  );
}
