import { certDate } from "../lib/jobs";
import type { Certificate, Job } from "../types";

export function CertificatePreview({ c, j }: { c: Certificate; j: Job }) {
  const ref = c.verificationRef ? encodeURIComponent(c.verificationRef) : "";
  const attendee = (j.attendees || []).find((a) => a.id === c.attendeeId);
  const photo = attendee && (attendee.photoDataUrl || attendee.extraPhotoDataUrl);
  const design = j.certificateDesign || "achievement";
  const employer = j.certificateUnder || c.company || j.customerName || "-";
  return (
    <div className={`west-cert design-${design}`}>
      {photo && (
        <div className="cert-photo">
          <img src={photo} alt="" />
        </div>
      )}
      {design === "achievement" && <img className="cert-marks" src="/certificate-marks.png?v=20260928e" alt="" />}
      <div className="cert-name">{c.name || ""}</div>
      <hr className="cert-rule" />
      <div className="lead">has successfully completed one day safety training for</div>
      <div className="cert-course">{c.course || ""}</div>
      <div className="meta-col meta-left">
        <div>
          <span>EID Number</span> {c.idOrVisaNo || "-"}
        </div>
        <div>
          <span>Employed by</span> {employer}
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
          <span>Job No.</span> {j.jobNo || "-"}
        </div>
        <div>
          <span>Expiry Date</span> {certDate(c.expiresOn)}
        </div>
      </div>
      <div className="auth">AUTHORISED BY</div>
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
