import { useApp } from "../../app-context";
import { rejectJob } from "../../components/IssueModal";
import { copyPublicLink, downloads } from "../../lib/downloads";
import type { Job } from "../../types";
import { AttendanceTab } from "./AttendanceTab";
import { CertificatesTab } from "./CertificatesTab";

export type CertKind = "pending" | "issued";
export type InnerTab = "docs" | "attendance" | "certs";

/** One job opened from the certificate lists: documents, attendance and issued certificates. */
export function CertJobView(props: {
  job: Job;
  kind: CertKind;
  inner: InnerTab;
  setInner: (t: InnerTab) => void;
  onBack: () => void;
  onIssue: () => void;
  onChanged: () => void;
}) {
  const { job: j, kind, inner, setInner } = props;
  const { perms } = useApp();
  const fileNo = j.jobOrderNo || j.jobNo;
  const innerButton = (t: InnerTab, label: string) => (
    <button className={inner === t ? "on" : ""} onClick={() => setInner(t)}>
      {label}
    </button>
  );

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <h3 style={{ margin: 0 }}>
            {j.jobNo} · {j.customerName || ""}
          </h3>
          <p className="hint" style={{ margin: "6px 0 0" }}>
            {j.course || "-"} · {j.trainingDate || "-"} · {(j.attendees || []).length} trainees
          </p>
        </div>
        <button className="btn ghost sm" onClick={props.onBack}>
          Back to list
        </button>
      </div>
      <div className="subtabs" style={{ marginTop: 14 }}>
        {innerButton("docs", "Forms & PDFs")}
        {innerButton("attendance", `Attendance (${(j.attendees || []).length})`)}
        {kind === "issued" && innerButton("certs", `Certificates (${(j.certificates || []).length})`)}
      </div>
      {inner === "docs" && (
        <>
          <p className="hint">Download the submitted pack for this job only.</p>
          <div className="dl-row">
            {perms.canAttendance() && (
              <button className="btn dark sm" onClick={() => downloads.attendance(j.id, fileNo)}>
                Attendance sheet PDF
              </button>
            )}
            {perms.canDownload() && (
              <>
                <button className="btn dark sm" onClick={() => downloads.jobSheet(j.id, fileNo)}>
                  Job card PDF
                </button>
                <button className="btn dark sm" onClick={() => downloads.jobData(j.id, fileNo)}>
                  Submitted data PDF
                </button>
                <button className="btn dark sm" onClick={() => downloads.workPermit(j.id, fileNo)}>
                  Work permit PDF
                </button>
                <button className="btn dark sm" onClick={() => downloads.review(j.id, fileNo)}>
                  Review form PDF
                </button>
              </>
            )}
          </div>
          <p className="muted">
            Customer attendance link: {location.origin + "/public/training/" + j.id}{" "}
            <button className="btn ghost sm" onClick={() => copyPublicLink(j.id)}>
              Copy
            </button>
          </p>
          {kind === "pending" && perms.canIssueCerts() && (
            <p style={{ marginTop: 14 }}>
              <button className="btn ok" onClick={props.onIssue}>
                Issue certificates
              </button>{" "}
              <button
                className="btn warn"
                onClick={async () => {
                  if (await rejectJob(j.id)) props.onChanged();
                }}
              >
                Return to trainer
              </button>
            </p>
          )}
        </>
      )}
      {inner === "attendance" && <AttendanceTab job={j} onChanged={props.onChanged} />}
      {inner === "certs" && kind === "issued" && <CertificatesTab job={j} onChanged={props.onChanged} />}
    </div>
  );
}
