import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../api";
import { useApp, usePageData } from "../../app-context";
import { AddTrainee } from "../../components/AddTrainee";
import { ProtocolDetails } from "../../components/mapping/ProtocolDetails";
import { PageLoading } from "../../components/PageLoading";
import { Paged } from "../../components/Pagination";
import { TraineeEditor } from "../../components/TraineeEditor";
import { copyTraineeJoin, downloads } from "../../lib/downloads";
import { isTrainingJob, jobCompanyNames, jobDateRange, sheetView, statusClass } from "../../lib/jobs";
import type { Assignee } from "../../lib/roles";
import type { Job } from "../../types";

interface LineItem {
  sn: number;
  description: string;
  qty: string;
  remarks?: string;
}

interface ItemResult {
  sn: number;
  reading?: string;
  result?: string;
  remarks?: string;
}

export function JobDetail({
  jobId,
  onEdit,
  onCancel,
  onChanged,
}: {
  jobId: string;
  onEdit: () => void;
  onCancel: (job: Job) => void;
  onChanged: () => void;
}) {
  const { perms, go, goToCertificates } = useApp();
  const canAssign = (perms.isSuper() || perms.has("Training:create") || perms.has("Training:assign")) && (!perms.isFieldUser() || perms.isAdmin());
  const { loading, data, reload } = usePageData(async () => {
    const [jobs, assignees] = await Promise.all([
      api<Job[]>("GET", "/api/training"),
      canAssign ? api<Assignee[]>("GET", "/api/assignees").catch(() => [] as Assignee[]) : Promise.resolve([] as Assignee[]),
    ]);
    return { job: jobs.find((j) => j.id === jobId) || null, assignees };
  });
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    cardRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [loading]);
  const [tab, setTab] = useState("details");
  const refresh = () => {
    reload();
    onChanged();
  };
  if (loading || !data) return <PageLoading />;
  const j = data.job;
  if (!j) return null;

  const training = isTrainingJob(j);
  const mapping = (j.serviceType || "") === "Mapping";
  const results: ItemResult[] = j.itemResults || [];
  const resultFor = (sn: number) => results.find((r) => r.sn === sn);
  const lines: LineItem[] = j.lineItems || [];
  const allRecorded = lines.length > 0 && lines.every((l) => resultFor(l.sn));
  const docNo = j.jobOrderNo || j.jobNo;
  const canEditCertifiedTo =
    (perms.has("Training:edit") || perms.has("Training:create") || perms.has("Training:assign") || perms.isSuper()) && j.status !== "Cancelled";

  async function rejectCancelRequest() {
    if (!confirm(`Reject the cancel request for ${j!.jobNo}? The job continues as normal.`)) return;
    try {
      await api("POST", `/api/training/${j!.id}/cancel-request/reject`);
      refresh();
    } catch (e) {
      alert((e as Error).message);
    }
  }
  async function submitToAdmin() {
    try {
      await api("POST", `/api/training/${j!.id}/submit`);
      refresh();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  const showDates =
    perms.canEditJob() && perms.canChangeJob(j.status) && ["Submitted", "Assigned", "In Progress", "Rejected", "Approved", "Issued"].includes(j.status);
  const showDocuments =
    perms.canDownload() || perms.canAttendance() || (perms.canIssueCerts() && ["Submitted", "Approved", "Issued", "Closed"].includes(j.status));
  const showCerts = (j.certificates.length > 0 && perms.canViewCerts()) || (perms.canIssueCerts() && j.status === "Submitted");
  const tabs: [string, string][] = [["details", "Details"]];
  if (mapping) tabs.push(["protocol", "Protocol"]);
  if (training) tabs.push(["trainees", `Trainees (${j.attendees.length})`]);
  if (showDocuments) tabs.push(["documents", "Documents"]);
  if (showDates) tabs.push(["dates", "Dates & certificate name"]);
  if (showCerts) tabs.push(["certificates", `Certificates (${j.certificates.length})`]);
  const current = tabs.some(([k]) => k === tab) ? tab : "details";

  return (
    <div className="card" ref={cardRef}>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>
          {j.jobNo} — {j.serviceType || "Training"} <span className={statusClass(j.status)}>{j.status}</span>{" "}
          <span className="chip">{j.location || "-"}</span>
        </h3>
        {perms.canEditJob() && j.status !== "Cancelled" && perms.canChangeJob(j.status) && (
          <button className="btn sm" onClick={onEdit}>
            Edit job
          </button>
        )}
      </div>
      {j.status === "Rejected" && j.rejectedReason && <p className="err">Returned: {j.rejectedReason}</p>}
      <div className="subtabs detail-tabs">
        {tabs.map(([k, label]) => (
          <button key={k} className={current === k ? "on" : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {current === "details" && (
        <>
          <div className="grid" style={{ marginBottom: 6 }}>
            <div>
              <label>{mapping ? "Mapping" : "Scope / Course"}</label>
              {j.course}
            </div>
            {mapping && (
              <>
                <Field label="Asset" value={j.assetName} />
                <Field label="Season / year" value={j.seasonYear} />
                <Field label="Temperature range" value={j.mappingRange} />
                <Field label="Humidity range" value={j.maxHumRange} />
                <div>
                  <label>Westcal engineer</label>
                  {j.protocolEngineerName || j.assigneeName || j.trainerName || "-"} <span className="muted">{j.engineerDesignation || ""}</span>
                </div>
                <Field label="Protocol preparation" value={j.protocolNotes} />
                <Field label="Work status" value={j.workStatus} />
                <Field label="Required date" value={j.requiredDateForService} />
              </>
            )}
            <div>
              <label>Customer / companies</label>
              {jobCompanyNames(j).join(" · ") || j.customerName}
            </div>
            {training && (
              <div style={{ gridColumn: "1/-1" }}>
                <label>Certified to</label>
                {canEditCertifiedTo && !showDates ? <CertifiedToEditor job={j} onSaved={refresh} /> : j.certificateUnder || j.customerName || "-"}
              </div>
            )}
            <div>
              <label>Date</label>
              {jobDateRange(j)} {j.trainingTime || ""}
            </div>
            <Field label="Assigned to" value={[j.assigneeName || j.trainerName, j.assigneeRole].filter(Boolean).join(" · ")} />
            <Field label="Job order no" value={j.jobOrderNo} />
            <Field label="Sales person" value={j.salesPerson} />
            <Field label="Handed over to" value={j.handedOverTo} />
          </div>
          <div>
            <b>Work codes:</b> {j.workCodeTraining ? "☑" : "☐"} Training {"  "}
            {j.workCodeCertification ? "☑" : "☐"} Certification
            {mapping && (
              <>
                {" "}
                {"  "}
                {j.workCodeCalibration ? "☑" : "☐"} Calibration {"  "}
                {j.workCodeSupply ? "☑" : "☐"} Supply {"  "}
                {j.workCodeRepairing ? "☑" : "☐"} Repairing
              </>
            )}
          </div>
          {lines.length > 0 && (
            <>
              <div className="sect">Line items / equipment</div>
              <table>
                <thead>
                  <tr>
                    <th>SN</th>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Remarks</th>
                    {!training && (
                      <>
                        <th>Reading</th>
                        <th>Result</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const r = resultFor(l.sn);
                    return (
                      <tr key={l.sn}>
                        <td>{l.sn}</td>
                        <td>{l.description}</td>
                        <td>{l.qty}</td>
                        <td>{l.remarks || "-"}</td>
                        {!training && (
                          <>
                            <td>{r ? r.reading || "-" : "—"}</td>
                            <td>{r ? <span className={"chip " + r.result}>{r.result}</span> : <span className="muted">Not recorded</span>}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
          {j.status === "Cancelled" && (
            <div className="card" style={{ borderColor: "#f0c9c9", background: "#fff8f8", marginTop: 14 }}>
              <h3 style={{ color: "var(--warn)" }}>Cancelled</h3>
              <p>
                By {j.cancelledBy || "office"}
                {j.cancelledAt ? " · " + new Date(j.cancelledAt).toLocaleString() : ""}
              </p>
              <p>
                <b>Reason:</b> {j.cancelledReason || "-"}
              </p>
            </div>
          )}
          {canAssign && ["Created", "Assigned", "Rejected"].includes(j.status) && (
            <AssignPanel job={j} assignees={data.assignees} onAssigned={() => go("jobs")} />
          )}
          {!training && perms.isFieldUser() && ["Assigned", "In Progress"].includes(j.status) && lines.length > 0 && (
            <>
              <div className="sect">Record test results</div>
              {lines.map((l) => (
                <ResultForm key={l.sn} jobId={j.id} line={l} existing={resultFor(l.sn)} onSaved={refresh} />
              ))}
            </>
          )}
          {perms.isFieldUser() && j.status === "In Progress" && (training ? j.attendees.length > 0 : allRecorded) && (
            <button className="btn ok" style={{ marginTop: 14 }} onClick={submitToAdmin}>
              Submit to admin for certificates
            </button>
          )}
          {(perms.isSuper() || perms.has("Invoice:create")) && (j.status === "Issued" || j.status === "Approved") && (
            <InvoiceClose jobId={j.id} onClosed={refresh} />
          )}
          {j.status === "Closed" && (
            <div className="card" style={{ borderColor: "#c9e8d4", background: "#f5fbf7", marginTop: 14 }}>
              <h3 style={{ color: "var(--ok)" }}>Closed</h3>
              <p>
                <b>Invoice number:</b> {j.invoiceNumber || "-"}
              </p>
              {j.closedAt && <p className="muted">Closed on {new Date(j.closedAt).toLocaleString()}</p>}
            </div>
          )}
          {j.cancelRequest && j.status !== "Cancelled" && (
            <div className="card" style={{ borderColor: "#f0d9a8", background: "#fffaf0", marginTop: 14 }}>
              <h3 style={{ color: "#a86b00" }}>Cancel request waiting for Super Admin</h3>
              <p>
                By {j.cancelRequest.requestedBy} · {new Date(j.cancelRequest.requestedAt).toLocaleString()}
              </p>
              <p>
                <b>Reason:</b> {j.cancelRequest.reason}
              </p>
              {perms.isSuper() && (
                <p>
                  <button className="btn warn sm" onClick={() => onCancel(j)}>
                    Approve – cancel job
                  </button>{" "}
                  <button className="btn sec sm" onClick={rejectCancelRequest}>
                    Reject request
                  </button>
                </p>
              )}
            </div>
          )}
          {perms.canCancelJob() && !j.cancelRequest && ["Created", "Assigned"].includes(j.status) && (
            <p style={{ marginTop: 18 }}>
              <button className="btn warn sm" onClick={() => onCancel(j)}>
                {perms.isSuper() ? "Cancel this job" : "Request cancellation"}
              </button>
            </p>
          )}
        </>
      )}

      {current === "protocol" && <ProtocolDetails job={j} editable={perms.canEditJob() && j.status !== "Cancelled" && perms.canChangeJob(j.status)} onSaved={refresh} />}

      {current === "trainees" && (
        <>
          {perms.isFieldUser() && ["Assigned", "In Progress"].includes(j.status) && <IdTextTrainee jobId={j.id} onAdded={refresh} />}
          <TraineeList job={j} onChanged={refresh} />
          {!perms.isFieldUser() &&
            perms.canAddTrainees() &&
            ["Created", "Assigned", "In Progress", "Rejected"].includes(j.status) && <OfficeSubmit job={j} onSubmitted={refresh} />}
        </>
      )}

      {current === "documents" && (
        <>
          {(perms.canDownload() || perms.canAttendance()) && (
            <>
              <p className="hint">Download the PDF documents for this job.</p>
              <p style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {perms.canDownload() && (
                  <button className="btn dark sm" onClick={() => downloads.jobSheet(j.id, docNo)}>
                    Job sheet
                  </button>
                )}
                {perms.canDownload() && training && (
                  <button className="btn dark sm" onClick={() => downloads.review(j.id, docNo)}>
                    Review form
                  </button>
                )}
                {training && perms.canAttendance() && (
                  <button className="btn dark sm" onClick={() => downloads.attendance(j.id, docNo)}>
                    Attendance sheet
                  </button>
                )}
                {perms.canDownload() && training && (
                  <button className="btn dark sm" onClick={() => downloads.workPermit(j.id, docNo)}>
                    Work permit
                  </button>
                )}
                {mapping && perms.canDownload() && (
                  <button className="btn dark sm" onClick={() => downloads.mappingProtocol(j.id)}>
                    Protocol report
                  </button>
                )}
              </p>
            </>
          )}
          {perms.canIssueCerts() && ["Submitted", "Approved"].includes(j.status) && (
            <>
              <div className="sect">Supporting files and trainer review</div>
              <p className="hint">
                Feedback: {j.contractReview?.customerFeedback || "Not recorded"} · {j.contractReview?.customerFeedbackNotes || "-"}
              </p>
              {(j.attachments || []).length ? (
                (j.attachments as any[]).map((a, i) => (
                  <a key={i} className="btn ghost sm" style={{ margin: "0 6px 6px 0" }} href={a.dataUrl} download={a.fileName}>
                    {a.type}: {a.fileName}
                  </a>
                ))
              ) : (
                <span className="muted">No uploaded files</span>
              )}
            </>
          )}
        </>
      )}

      {current === "dates" && <DatesEditor job={j} onSaved={refresh} />}

      {current === "certificates" && (
        <>
          {perms.canIssueCerts() && j.status === "Submitted" && (
            <p>
              <button className="btn ok" onClick={() => goToCertificates("pending")}>
                Issue certificates (pending)
              </button>
            </p>
          )}
          {j.certificates.map((c) => (
            <p key={c.id} style={{ margin: "8px 0", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <b>{c.certificateNo}</b>
              <span className="muted">{c.name}</span>
              <button className="btn dark sm" onClick={() => downloads.certificate(j.id, c.id, String(c.certificateNo || "").replace(/'/g, ""))}>
                Certificate
              </button>
              <button className="btn sec sm" onClick={() => downloads.card(j.id, c.id, String(c.certificateNo || "").replace(/'/g, ""))}>
                ID card
              </button>
            </p>
          ))}
          {j.certificates.length > 0 && (
            <p style={{ marginTop: 8 }}>
              <button className="btn sec sm" onClick={() => goToCertificates("issued")}>
                Open certificate page
              </button>
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <label>{label}</label>
      {value || "-"}
    </div>
  );
}

function CertifiedToEditor({ job, onSaved }: { job: Job; onSaved: () => void }) {
  const [value, setValue] = useState(job.certificateUnder || job.customerName || "");
  const [err, setErr] = useState("");
  async function save() {
    setErr("");
    try {
      await api("PATCH", `/api/training/${job.id}`, { certificateUnder: value });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <>
      <input value={value} onChange={(e) => setValue(e.target.value)} />
      <p className="hint" style={{ margin: "6px 0 0" }}>
        Filled from the company. Change it if another company must appear on the certificate.
      </p>
      <button className="btn sec sm" style={{ marginTop: 8 }} onClick={save}>
        Save certified to
      </button>
      <div className="err">{err}</div>
    </>
  );
}

function AssignPanel({ job, assignees, onAssigned }: { job: Job; assignees: Assignee[]; onAssigned: () => void }) {
  const [assigneeId, setAssigneeId] = useState(assignees[0]?.id || "");
  async function assign() {
    try {
      await api("POST", `/api/training/${job.id}/assign`, { assigneeId });
      onAssigned();
    } catch (e) {
      alert((e as Error).message);
    }
  }
  return (
    <>
      <div className="sect">Assign to trainer / site engineer</div>
      <div style={{ display: "flex", gap: 10, maxWidth: 460 }}>
        <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
          {assignees.length ? (
            assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName} — {a.roleName}
              </option>
            ))
          ) : (
            <option value="">(no trainers or site engineers)</option>
          )}
        </select>
        <button className="btn" onClick={assign}>
          Assign & notify
        </button>
      </div>
    </>
  );
}

function ResultForm({ jobId, line, existing, onSaved }: { jobId: string; line: LineItem; existing?: ItemResult; onSaved: () => void }) {
  const [reading, setReading] = useState(existing?.reading || "");
  const [result, setResult] = useState(existing?.result || "Pass");
  const [remarks, setRemarks] = useState(existing?.remarks || "");
  async function save() {
    try {
      await api("POST", `/api/training/${jobId}/results`, { sn: line.sn, reading, result, remarks });
      onSaved();
    } catch (e) {
      alert((e as Error).message);
    }
  }
  return (
    <div className="grid" style={{ marginBottom: 12, padding: 12, border: "1px solid var(--line)", borderRadius: 10 }}>
      <div style={{ gridColumn: "1/-1" }}>
        <b>
          {line.sn}. {line.description}
        </b>
      </div>
      <div>
        <label>Reading</label>
        <input value={reading} onChange={(e) => setReading(e.target.value)} />
      </div>
      <div>
        <label>Result</label>
        <select value={result} onChange={(e) => setResult(e.target.value)}>
          <option>Pass</option>
          <option>Fail</option>
        </select>
      </div>
      <div>
        <label>Remarks</label>
        <input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </div>
      <div style={{ alignSelf: "end" }}>
        <button className="btn sm" onClick={save}>
          Save result
        </button>
      </div>
    </div>
  );
}

/** Field users paste the ID card text; the server parses it. */
function IdTextTrainee({ jobId, onAdded }: { jobId: string; onAdded: () => void }) {
  const [text, setText] = useState("");
  const [fetched, setFetched] = useState<{ confidence: number } | null>(null);
  const [f, setF] = useState({ name: "", company: "", idOrVisaNo: "", nationality: "", mobileNumber: "" });
  const [err, setErr] = useState("");
  async function autoFetch() {
    try {
      const r = await api("POST", `/api/training/${jobId}/id-fetch`, { ocrText: text });
      setFetched(r);
      setF({ name: r.name || "", company: "", idOrVisaNo: r.idOrVisaNo || "", nationality: r.nationality || "", mobileNumber: r.mobileNumber || "" });
    } catch (e) {
      alert((e as Error).message);
    }
  }
  async function add() {
    setErr("");
    try {
      await api("POST", `/api/training/${jobId}/attendees`, { ...f, autoFetched: true, idCardFileName: "emirates-id.jpg" });
      onAdded();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  const field = (k: keyof typeof f, label: string) => (
    <div>
      <label>{label}</label>
      <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </div>
  );
  return (
    <>
      <div className="sect">Upload trainee Emirates ID (auto-fetch)</div>
      <p className="hint">Paste ID text (simulating a scan/OCR). Details auto-fill — correct if needed.</p>
      <textarea
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Name: HAROON UR RASHEED\nID Number: 784-1990-1234567-1\nNationality: Pakistan\n+971 56 665 4326"}
      />
      <button className="btn sec" style={{ marginTop: 8 }} onClick={autoFetch}>
        Auto-fetch from ID
      </button>
      {fetched && (
        <>
          <p className="ok-msg">Auto-fetched ({(fetched.confidence * 100).toFixed(0)}% confidence). Review & correct:</p>
          <div className="grid">
            {field("name", "Name")}
            {field("company", "Company")}
            {field("idOrVisaNo", "Emirates ID / Visa")}
            {field("nationality", "Nationality")}
            {field("mobileNumber", "Mobile (optional)")}
          </div>
          <button className="btn" style={{ marginTop: 12 }} onClick={add}>
            Add trainee
          </button>
          <div className="err">{err}</div>
        </>
      )}
    </>
  );
}

function TraineeList({ job, onChanged }: { job: Job; onChanged: () => void }) {
  const { perms } = useApp();
  const sheet = sheetView(job);
  const open = job.status !== "Cancelled" && job.status !== "Closed" && perms.canChangeJob(job.status);
  const canEdit = perms.canEditTrainees() && open;
  const canAdd = perms.canAddTrainees() && open;
  return (
    <>
      <div className="sect">Trainees ({job.attendees.length})</div>
      <p className="hint">
        {sheet.courseTitle} · {sheet.date}
        {job.trainingTime ? " · " + job.trainingTime : ""} · {sheet.certifiedBy}
      </p>
      {canAdd && <AddTrainee job={job} onAdded={onChanged} />}
      {job.attendees.length ? (
        <Paged items={job.attendees} resetKey={job.id}>
          {(rows, offset) =>
            rows.map((a, i) => (
              <div key={a.id} className="job-block">
                <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
                  {(a.photoDataUrl || a.extraPhotoDataUrl) && (
                    <img src={a.photoDataUrl || a.extraPhotoDataUrl} alt="" style={{ height: 72, width: 58, objectFit: "cover", borderRadius: 8 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <b>
                      {offset + i + 1}. {a.name || "Trainee"}
                    </b>
                    {a.signature ? " · signed" : ""}
                    {canEdit ? (
                      <TraineeEditor
                        job={job}
                        attendee={a}
                        onSaved={onChanged}
                        extraButtons={
                          job.traineeInviteToken &&
                          a.editToken && (
                            <button className="btn ghost sm" onClick={() => copyTraineeJoin(job.traineeInviteToken!, a.editToken)}>
                              Copy join link
                            </button>
                          )
                        }
                      />
                    ) : (
                      <p className="muted" style={{ margin: "6px 0 0" }}>
                        EID: {a.idOrVisaNo || "-"} · {a.company || job.customerName} · {a.course || job.course || ""}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))
          }
        </Paged>
      ) : (
        <p className="muted">No trainees yet.</p>
      )}
    </>
  );
}

function DatesEditor({ job, onSaved }: { job: Job; onSaved: () => void }) {
  const [f, setF] = useState({
    trainingDate: job.trainingDate || "",
    trainingDateTo: job.trainingDateTo || job.trainingDate || "",
    trainingTime: job.trainingTime || "",
    certificateUnder: job.certificateUnder || job.customerName || "",
  });
  const [err, setErr] = useState("");
  const afterCerts = job.status === "Approved" || job.status === "Issued";
  async function save() {
    setErr("");
    try {
      const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()]));
      await api("PATCH", `/api/training/${job.id}`, body);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  const field = (k: keyof typeof f, label: string, type = "text") => (
    <div>
      <label>{label}</label>
      <input type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </div>
  );
  return (
    <>
      <div className="sect">{afterCerts ? "Correct job after certificates" : "Office — edit dates"}</div>
      <p className="hint">
        {afterCerts
          ? "Changing the date or certified-to name also updates every issued certificate. Download the PDF again after you save."
          : "Change dates, job time and the certificate name without sending the job back to the trainer."}
      </p>
      <div className="grid">
        {field("trainingDate", "Date from", "date")}
        {field("trainingDateTo", "Date to", "date")}
        {field("trainingTime", "Job time", "time")}
        {field("certificateUnder", "Certified to (prints on certificate)")}
      </div>
      <button className="btn sec sm" style={{ marginTop: 10 }} onClick={save}>
        Save dates & certified to
      </button>
      <div className="err">{err}</div>
    </>
  );
}

/** Office completes the attendance sheet when the trainer did not, then sends the job to admin. */
function OfficeSubmit({ job, onSubmitted }: { job: Job; onSubmitted: () => void }) {
  const { session } = useApp();
  const [verified, setVerified] = useState(!!job.trainerVerified);
  const [authorizedBy, setAuthorizedBy] = useState(job.authorizedBy || session.displayName);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setErr("");
    if (!job.attendees.length) return setErr("Add at least one trainee first.");
    if (!verified) return setErr("Tick that you checked the attendance sheet.");
    if (!authorizedBy.trim()) return setErr("Enter who authorized the attendance sheet.");
    if (!confirm(`Send ${job.jobNo} to admin with ${job.attendees.length} trainee(s)?`)) return;
    setBusy(true);
    try {
      await api("POST", `/api/training/${job.id}/attendance-meta`, { trainerVerified: true, authorizedBy: authorizedBy.trim() });
      await api("POST", `/api/training/${job.id}/submit`);
      onSubmitted();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="job-block" style={{ marginTop: 16 }}>
      <h4>Office: complete the attendance sheet</h4>
      <p className="hint">Use this when the trainer did not fill the attendance. Add the trainees above, then send it to admin.</p>
      <div className="grid">
        <div>
          <label>Authorized by</label>
          <input value={authorizedBy} onChange={(e) => setAuthorizedBy(e.target.value)} />
        </div>
        <div style={{ alignSelf: "end" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 500 }}>
            <input type="checkbox" style={{ width: "auto", minHeight: 0 }} checked={verified} onChange={(e) => setVerified(e.target.checked)} />I checked
            the attendance sheet ({job.attendees.length} trainee{job.attendees.length === 1 ? "" : "s"})
          </label>
        </div>
      </div>
      <button className="btn ok" style={{ marginTop: 12 }} disabled={busy} onClick={submit}>
        {busy ? "Sending…" : "Submit attendance to admin"}
      </button>
      <div className="err">{err}</div>
    </div>
  );
}

function InvoiceClose({ jobId, onClosed }: { jobId: string; onClosed: () => void }) {
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function close() {
    if (!invoiceNumber.trim()) {
      setErr("Invoice number is required");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await api("POST", `/api/training/${jobId}/invoice`, { invoiceNumber: invoiceNumber.trim() });
      onClosed();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="sect">Add Invoice Number & Close Job</div>
      <p className="hint">Enter the invoice number to close this job and complete the workflow.</p>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8 }}>
        <input type="text" placeholder="Enter invoice number" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} style={{ flex: 1 }} />
        <button className="btn ok" onClick={close} disabled={busy}>
          {busy ? "Closing..." : "Add Invoice & Close"}
        </button>
      </div>
      <div className="err">{err}</div>
    </>
  );
}
