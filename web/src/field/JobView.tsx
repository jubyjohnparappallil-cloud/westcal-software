import { useEffect, useRef, useState } from "react";
import type { Attendee, Job } from "../types";
import { apiBase, downloadBlob, fapi } from "./api";
import { Capture } from "./Capture";
import { chipClass, fieldDate, isTrainer, isTrainingJob, statusLabel, useField } from "./FieldApp";
import { formatEidLocal, ocrEmiratesCard, prepareIdPhoto, shrinkImage } from "./ocr";
import { Pad, type PadHandle } from "./Pad";

type Section = "details" | "attendance" | "feedback";
type Download = (path: string, name: string, done?: string) => Promise<void>;

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
const WESTCAL_NAME = "Westcal Instrumentation and Calibration Services LLC";

function displayJobNo(jobNo?: string): string {
  return String(jobNo || "").replace(/^WC-/i, "");
}

/** Open the saved Maps link. A plain place name still opens Google Maps. */
function directionHref(direction?: string, address?: string): string {
  const raw = String(direction || "").trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^(maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.|www\.google\.|google\.)/i.test(raw)) return "https://" + raw;
  const q = raw || String(address || "").trim();
  return q ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q) : "";
}

function sheetView(j: Job) {
  const logoSrc = j.sheetInsigniaLogoDataUrl || "/logo.jpg";
  const jobLabel = (j.sheetJobLabel || "").trim() || "WESTCAL Job";
  const jobNo = (j.sheetJobNo || "").trim() || displayJobNo(j.jobNo) || j.jobOrderNo || "";
  const courseTitle = (j.sheetCourseTitle || "").trim() || j.course || "Training";
  const invoiced = (j.sheetCompany || "").trim() || j.customerName || "";
  const certifiedBy = (j.certificateUnder || "").trim() || invoiced;
  return {
    insigniaName: (j.sheetInsigniaName || "").trim() || WESTCAL_NAME,
    logoSrc,
    jobLabel,
    jobNo,
    courseTitle,
    invoiced,
    certifiedBy,
    date: fieldDate(j.trainingDate),
  };
}

export function JobView({ job: j, onBack, reload }: { job: Job; onBack: () => void; reload: () => Promise<Job[]> }) {
  const { toast } = useField();
  const [section, setSection] = useState<Section>("details");
  const training = isTrainingJob(j);
  const canWork = ["Assigned", "In Progress", "Rejected"].includes(j.status);

  async function show(next: Section) {
    setSection(next);
    await reload();
  }

  const download: Download = async (path, name, done) => {
    try {
      await downloadBlob(path, name);
      if (done) toast(done);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const tabs: [Section, string][] = [
    ["details", "📱 Job Details"],
    ...(training ? [["attendance", `👥 Attendance (${j.attendees.length})`] as [Section, string]] : []),
    ["feedback", "⭐ Reviews"],
  ];

  return (
    <>
      <button className="btn ghost" onClick={onBack} style={{ marginBottom: 14 }}>
        ← All my jobs
      </button>
      <div className="jobtabs">
        {tabs.map(([id, label]) => (
          <button key={id} className={section === id ? "on" : ""} onClick={() => show(id)}>
            {label}
          </button>
        ))}
      </div>
      {section === "details" && <Details j={j} canWork={canWork} reload={reload} />}
      {section === "attendance" && training && (
        <Attendance
          j={j}
          canMark={canWork}
          showAttendance={training}
          reload={reload}
          download={download}
        />
      )}
      {section === "feedback" && <Feedback />}
      {j.status === "Submitted" && (
        <div className="card">
          <b>Submitted to the office</b>
          <p className="muted" style={{ marginBottom: 0 }}>
            This job is locked and can no longer be edited. If the admin returns it, you can edit it again.
          </p>
        </div>
      )}
      {j.status === "Cancelled" && j.cancelledReason && (
        <div className="card">
          <p className="err" style={{ margin: 0 }}>
            Cancelled{j.cancelledBy ? " by " + j.cancelledBy : ""}: {j.cancelledReason}
          </p>
        </div>
      )}
    </>
  );
}

function Details({ j, canWork, reload }: { j: Job; canWork: boolean; reload: () => Promise<Job[]> }) {
  const { toast, openJob } = useField();
  const s = sheetView(j);
  const review = j.contractReview || {};
  const training = isTrainingJob(j);
  const trainer = isTrainer(useField().session);
  const info = {
    contact: review.contactPersonNumber || j.contactNameNumber || "",
    prepared: review.crPreparedBy || "Not specified",
    method: review.trainingMethodUsed || j.mode || "Onsite",
  };
  const results: ItemResult[] = j.itemResults || [];
  const lineItems: LineItem[] = j.lineItems || [];
  const allRecorded = lineItems.length > 0 && lineItems.every((l) => results.some((r) => r.sn === l.sn));

  async function submitResults() {
    if (!confirm(j.status === "Rejected" ? "Send these results back to the office?" : "Send these results to the office?")) return;
    try {
      await fapi("POST", `/api/training/${j.id}/submit`, {});
      toast("Submitted to the office.");
      await openJob(j.id);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const fact = (label: string, value: string) => (
    <div className="fact">
      <label className="fl">{label}</label>
      <div className="val">{value}</div>
    </div>
  );

  return (
    <>
      <div className="job-block">
        <h3>Job details</h3>
        <div className="row" style={{ marginBottom: 12 }}>
          <h2 className="grow" style={{ margin: 0 }}>
            {displayJobNo(j.jobNo)}
          </h2>
          <span className={chipClass(j.status)}>{statusLabel(j.status)}</span>
        </div>
        {fact("Company", s.invoiced)}
        {fact("Certified to", s.certifiedBy)}
        {fact("Date", s.date)}
        {fact("Course", j.course || "")}
        {fact("Site address", j.address || "Not set")}
        {fact("Contact", j.contactNameNumber || "-")}
        {fact("Job order no", j.jobOrderNo || "-")}
        {j.clientRequirements && fact("Client requirements", j.clientRequirements)}
        {directionHref(j.directionUrl, j.address) && (
          <a
            className="btn sec"
            style={{ marginTop: 6 }}
            href={directionHref(j.directionUrl, j.address)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Direction
          </a>
        )}
        {j.status === "Cancelled" && (
          <p className="err" style={{ marginTop: 12 }}>
            <b>Cancelled</b>
            {j.cancelledBy ? " by " + j.cancelledBy : ""}
            <br />
            Reason: {j.cancelledReason || "-"}
          </p>
        )}
      </div>
      {training && trainer && (
        <div className="job-block">
          <h3>📱 Job Information</h3>
          <p className="muted" style={{ margin: "0 0 12px" }}>
            Training job details (mobile view)
          </p>
          <label className="fl">Contact person / number</label>
          <div className="val">{info.contact || "Not specified"}</div>
          <label className="fl">CR prepared by</label>
          <div className="val">{info.prepared}</div>
          <label className="fl">Training method</label>
          <div className="val">{info.method}</div>
        </div>
      )}
      {!training && lineItems.length > 0 && (
        <>
          <div className="sect">Test results</div>
          {lineItems.map((l) =>
            canWork ? (
              <ItemResultForm key={l.sn} j={j} line={l} result={results.find((r) => r.sn === l.sn)} reload={reload} />
            ) : (
              <ItemResultCard key={l.sn} line={l} result={results.find((r) => r.sn === l.sn)} />
            ),
          )}
          {canWork && (
            <>
              {!allRecorded && <p className="muted">Save a result for every item, then send the job to the office.</p>}
              <button className="btn ok" disabled={!allRecorded} onClick={submitResults}>
                {j.status === "Rejected" ? "Send back to office" : "Send to office"}
              </button>
            </>
          )}
        </>
      )}
      {!training && !lineItems.length && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No test items on this job yet. Ask the office to add the items to test.
          </p>
        </div>
      )}
    </>
  );
}

function ItemResultForm({
  j,
  line,
  result,
  reload,
}: {
  j: Job;
  line: LineItem;
  result?: ItemResult;
  reload: () => Promise<Job[]>;
}) {
  const { toast } = useField();
  const [f, setF] = useState({
    reading: result?.reading || "",
    result: result?.result || "Pass",
    remarks: result?.remarks || "",
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await fapi("POST", `/api/training/${j.id}/results`, { sn: line.sn, ...f });
      toast("Result saved.");
      await reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div>
        <b>
          {line.sn}. {line.description}
        </b>
        {result && <span className={`chip ${result.result === "Pass" ? "Pass" : "Fail"}`} style={{ marginLeft: 8 }}>{result.result}</span>}
      </div>
      <div className="muted">
        Qty {line.qty}
        {line.remarks ? " · " + line.remarks : ""}
      </div>
      <label className="fl">Reading</label>
      <input value={f.reading} onChange={(e) => setF({ ...f, reading: e.target.value })} />
      <label className="fl">Result</label>
      <select value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}>
        <option>Pass</option>
        <option>Fail</option>
      </select>
      <label className="fl">Remarks</label>
      <input value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
      <button className="btn ok" style={{ marginTop: 12 }} disabled={busy} onClick={save}>
        {result ? "Update result" : "Save result"}
      </button>
    </div>
  );
}

function ItemResultCard({ line, result }: { line: LineItem; result?: ItemResult }) {
  return (
    <div className="card">
      <div>
        <b>
          {line.sn}. {line.description}
        </b>
      </div>
      <div className="muted">
        Qty {line.qty}
        {line.remarks ? " · " + line.remarks : ""}
      </div>
      {result && (
        <>
          <label className="fl">Reading</label>
          <div className="val">{result.reading || "Not recorded"}</div>
          <label className="fl">Result</label>
          <div className="val">
            <span className={`chip ${result.result === "Pass" ? "Pass" : "Fail"}`}>{result.result || "Not tested"}</span>
          </div>
          <label className="fl">Remarks</label>
          <div className="val">{result.remarks || "No remarks"}</div>
        </>
      )}
      {!result && (
        <div className="muted" style={{ marginTop: 8 }}>
          No test results recorded yet.
        </div>
      )}
    </div>
  );
}

export function Attendance({
  j,
  canMark,
  showAttendance,
  reload,
  download,
  office = false,
}: {
  j: Job;
  canMark: boolean;
  showAttendance: boolean;
  reload: () => Promise<Job[]>;
  download: Download;
  /** Shown inside the office console: the office has its own submit and issue steps. */
  office?: boolean;
}) {
  const { session, toast, openJob } = useField();
  const s = sheetView(j);
  const [captureKey, setCaptureKey] = useState(0);
  const [rowEdit, setRowEdit] = useState<{ id: string; focusEid: boolean; eid?: string } | null>(null);
  const [companyDraft, setCompanyDraft] = useState(s.invoiced);
  const [certifiedDraft, setCertifiedDraft] = useState(s.certifiedBy);
  const [personCompany, setPersonCompany] = useState<Record<string, string>>({});
  const [sigPreview, setSigPreview] = useState<Record<string, string>>({});
  useEffect(() => {
    setCompanyDraft(s.invoiced);
    setCertifiedDraft(s.certifiedBy);
  }, [j.id, s.invoiced, s.certifiedBy]);
  const [dropRow, setDropRow] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(
    j.authorizedBy || j.assigneeName || j.trainerName || session.displayName || "",
  );
  const [verified, setVerified] = useState(!!j.trainerVerified);
  const trainerSig = useRef<string | null>(j.trainerSignature || null);
  const trainerPad = useRef<PadHandle>(null);
  const sigFile = useRef<HTMLInputElement>(null);
  const [shownSig, setShownSig] = useState(j.trainerSignature || "");
  useEffect(() => {
    setShownSig(j.trainerSignature || "");
    trainerSig.current = j.trainerSignature || null;
  }, [j.id, j.trainerSignature]);
  const rowPads = useRef(new Map<string, PadHandle | null>());
  const [verifyErr, setVerifyErr] = useState("");
  const publicUrl = (apiBase() || location.origin) + "/public/training/" + j.id;
  const results: ItemResult[] = j.itemResults || [];
  const lineItems: LineItem[] = j.lineItems || [];
  const allRecorded = lineItems.length > 0 && lineItems.every((l) => results.some((r) => r.sn === l.sn));

  const afterCaptureSaved = async () => {
    setCaptureKey((k) => k + 1);
    await reload();
  };

  async function saveTrainerVerify() {
    setVerifyErr("");
    try {
      const payload: Record<string, unknown> = { trainerVerified: verified, authorizedBy: authorized };
      if (trainerSig.current || j.trainerSignature) payload.trainerSignature = trainerSig.current || j.trainerSignature;
      await fapi("POST", `/api/training/${j.id}/attendance-meta`, payload);
      toast("Trainer verification saved.");
      await reload();
    } catch (e) {
      setVerifyErr((e as Error).message);
    }
  }

  async function submitJob() {
    if (showAttendance && !verified) {
      setVerifyErr("Tick I verified this attendance sheet, then send to the Certificate Coordinator.");
      toast("Verify the attendance sheet first.");
      return;
    }
    if (
      !confirm(
        j.status === "Rejected"
          ? "Send this attendance sheet back to the admin team?"
          : "Send this verified attendance sheet to the admin team?",
      )
    )
      return;
    try {
      if (showAttendance) {
        const payload: Record<string, unknown> = { trainerVerified: true, authorizedBy: authorized };
        if (trainerSig.current || j.trainerSignature) payload.trainerSignature = trainerSig.current || j.trainerSignature;
        await fapi("POST", `/api/training/${j.id}/attendance-meta`, payload);
      }
      await fapi("POST", `/api/training/${j.id}/submit`, {});
      toast("Submitted to the office.");
      await openJob(j.id);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function replacePhoto(a: Attendee, file: File) {
    try {
      const dataUrl = await shrinkImage(file);
      await fapi("PATCH", `/api/training/${j.id}/attendees/${a.id}`, { photoDataUrl: dataUrl });
      toast("Photo updated.");
      await reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function replaceId(a: Attendee, file: File) {
    try {
      const { card, portrait, ocrCard } = await prepareIdPhoto(file);
      let name: string | undefined;
      let idOrVisaNo: string | undefined;
      let nationality: string | undefined;
      let dateOfBirth: string | undefined;
      try {
        const text = await ocrEmiratesCard([ocrCard]);
        if (text.trim()) {
          const fetched = await fapi<{
            name?: string;
            idOrVisaNo?: string;
            nationality?: string;
            dateOfBirth?: string;
          }>("POST", `/api/training/${j.id}/id-fetch`, { ocrText: text });
          name = fetched.name;
          idOrVisaNo = fetched.idOrVisaNo || formatEidLocal(text);
          nationality = fetched.nationality;
          dateOfBirth = fetched.dateOfBirth;
        }
      } catch {
        /* still save the photo */
      }
      await fapi("PATCH", `/api/training/${j.id}/attendees/${a.id}`, {
        idCardDataUrl: card,
        photoDataUrl: portrait || card,
        ...(name ? { name } : {}),
        ...(idOrVisaNo ? { idOrVisaNo } : {}),
        ...(nationality ? { nationality } : {}),
        ...(dateOfBirth ? { dateOfBirth } : {}),
        autoFetched: !!idOrVisaNo,
      });
      toast(idOrVisaNo ? "Photo saved and ID filled: " + idOrVisaNo : "Photo saved. Type the ID if it is missing.");
      await reload();
      setRowEdit({ id: a.id, focusEid: !idOrVisaNo, eid: idOrVisaNo });
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function deleteTrainee(a: Attendee) {
    if (!confirm("Remove " + a.name + " from attendance?")) return;
    try {
      await fapi("DELETE", `/api/training/${j.id}/attendees/${a.id}`);
      toast("Trainee removed.");
      if (rowEdit?.id === a.id) setRowEdit(null);
      await reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function saveSheetCompany(value: string) {
    const name = value.trim();
    if (!name) {
      setCompanyDraft(s.invoiced);
      setPersonCompany({});
      toast("Company is required.");
      return;
    }
    if (name === s.invoiced) {
      setPersonCompany({});
      return;
    }
    setCompanyDraft(name);
    setPersonCompany(Object.fromEntries(j.attendees.map((a) => [a.id, name])));
    try {
      await fapi("POST", `/api/training/${j.id}/attendance-meta`, { sheetCompany: name });
      await Promise.all(
        j.attendees.map((a) => fapi("PATCH", `/api/training/${j.id}/attendees/${a.id}`, { company: name })),
      );
      toast("Company updated on the attendance sheet.");
      await reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function saveCertifiedTo(value: string) {
    const name = value.trim();
    if (!name) {
      setCertifiedDraft(s.certifiedBy);
      toast("Certified to is required.");
      return;
    }
    if (name === s.certifiedBy) return;
    setCertifiedDraft(name);
    try {
      await fapi("POST", `/api/training/${j.id}/attendance-meta`, { certifiedBy: name });
      toast("Certified to updated on the attendance sheet.");
      await reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const canSubmit =
    !office &&
    canMark &&
    ["In Progress", "Rejected", "Assigned"].includes(j.status) &&
    (showAttendance ? j.attendees.length > 0 : allRecorded);

  return (
    <>
      {j.status === "Rejected" && (
        <div className="card">
          <p className="err" style={{ margin: 0 }}>
            <b>Office sent this back.</b> Edit any trainee field below, then send back to the Certificate Coordinator.
          </p>
        </div>
      )}
      {canMark && (
        <div className="card">
          <h2>📱 Add Trainee</h2>
          <Capture key={captureKey} job={j} onSaved={afterCaptureSaved} />
        </div>
      )}
      <div className="card">
        {office && (
          <p style={{ margin: "0 0 12px" }}>
            <span className="mini">Customer link: {publicUrl}</span>
            <br />
            <button
              className="btn ghost"
              style={{ marginTop: 8 }}
              onClick={async () => {
                const text =
                  "Westcal training attendance — open this link, upload your Emirates ID, check your details, sign and send:\n" +
                  publicUrl;
                try {
                  await navigator.clipboard.writeText(text);
                  toast("Customer attendance link copied.");
                } catch {
                  prompt("Copy this customer link", publicUrl);
                }
              }}
            >
              Copy customer attendance link
            </button>
          </p>
        )}
        <div className="wc-top">
          <div className="wc-ct">
            T: +9714 576 2773
            <br />
            M: +971 56 665 4326
            <br />
            E: training@westcal.ae
            <br />
            W: www.westcal.ae
          </div>
          <img src={s.logoSrc} alt="WESTCAL" style={{ height: 48 }} />
        </div>
        <div className="wc-bar">WESTCAL INSTRUMENTATION AND CALIBRATION SERVICES LLC</div>
        <h2 style={{ margin: "0 0 6px", textAlign: "center" }}>Attendance</h2>
        {office && (
          <p style={{ textAlign: "center", margin: "0 0 12px" }}>
            <button
              className="btn ok"
              onClick={() =>
                download(
                  `/api/training/${j.id}/attendance-pdf`,
                  "WESTCAL-" + (j.jobOrderNo || j.jobNo) + "-attendance.pdf",
                  "Attendance sheet downloaded.",
                )
              }
            >
              Download attendance sheet
            </button>
          </p>
        )}
        <p className="muted" style={{ textAlign: "center" }}>
          {s.courseTitle} | {s.date} | {companyDraft}
        </p>
        <table className="sheet facts">
          <tbody>
            {[
              [s.jobLabel, s.jobNo],
              ["Training", s.courseTitle],
              ["Training date", s.date],
            ].map(([k, v]) => (
              <tr key={k}>
                <td>
                  <b>{k}</b>
                </td>
                <td>
                  <b>{v}</b>
                </td>
              </tr>
            ))}
            <tr>
              <td>
                <b>Company</b>
              </td>
              <td>
                {canMark ? (
                  <input
                    value={companyDraft}
                    aria-label="Company"
                    onChange={(e) => {
                      const name = e.target.value;
                      setCompanyDraft(name);
                      setPersonCompany(Object.fromEntries(j.attendees.map((a) => [a.id, name])));
                    }}
                    onBlur={() => saveSheetCompany(companyDraft)}
                  />
                ) : (
                  <b>{companyDraft}</b>
                )}
              </td>
            </tr>
            <tr>
              <td>
                <b>Certified to</b>
              </td>
              <td>
                {canMark ? (
                  <input
                    value={certifiedDraft}
                    aria-label="Certified to"
                    onChange={(e) => setCertifiedDraft(e.target.value)}
                    onBlur={() => saveCertifiedTo(certifiedDraft)}
                  />
                ) : (
                  <b>{certifiedDraft}</b>
                )}
              </td>
            </tr>
          </tbody>
        </table>
        <div className="att-list">
          {j.attendees.length ? (
            j.attendees.map((a, i) => {
              const photo = a.photoDataUrl || a.extraPhotoDataUrl || a.idCardDataUrl || "";
              const open = rowEdit?.id === a.id;
              return (
                <article
                  key={a.id}
                  className={"att-card" + (dropRow === a.id ? " dragover" : "")}
                  onDragOver={(e) => {
                    if (!canMark) return;
                    e.preventDefault();
                    if (dropRow !== a.id) setDropRow(a.id);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropRow(null);
                  }}
                  onDrop={(e) => {
                    if (!canMark) return;
                    e.preventDefault();
                    setDropRow(null);
                    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
                    if (file) replaceId(a, file);
                  }}
                >
                  <div className="att-head">
                    {photo ? <img className="att-photo" src={photo} alt="" /> : <div className="att-photo empty">No photo</div>}
                    <div className="grow">
                      <b>
                        {i + 1}. {a.name}
                      </b>
                      <div className="mini">EID: {a.idOrVisaNo || "re-upload ID or type it"}</div>
                      <div className="mini">Company: {personCompany[a.id] ?? (a.company || companyDraft || "-")}</div>
                      <div className="mini">Certified to: {certifiedDraft || "-"}</div>
                      <div className="mini">{a.course || j.course || ""}</div>
                    </div>
                  </div>
                  {canMark && (
                    <>
                      <div className="attacts">
                        <button
                          type="button"
                          className="btn sec"
                          onClick={() => setRowEdit(open ? null : { id: a.id, focusEid: false })}
                        >
                          {open ? "Close" : "Edit"}
                        </button>
                        <label className="btn ghost" htmlFor={`repid_${a.id}`}>
                          Re-upload EID
                        </label>
                        <input
                          id={`repid_${a.id}`}
                          className="sr-only"
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) replaceId(a, file);
                          }}
                        />
                        <label className="btn ghost" htmlFor={`repph_${a.id}`}>
                          New photo
                        </label>
                        <input
                          id={`repph_${a.id}`}
                          className="sr-only"
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) replacePhoto(a, file);
                          }}
                        />
                        <button className="btn ghost" onClick={() => deleteTrainee(a)}>
                          Delete
                        </button>
                      </div>
                      {open && rowEdit && (
                        <RowEdit
                          j={j}
                          a={a}
                          focusEid={rowEdit.focusEid}
                          eid={rowEdit.eid}
                          certifiedTo={certifiedDraft}
                          onApplied={(patch) => {
                            setPersonCompany((current) => ({ ...current, [a.id]: patch.company }));
                            if (patch.certifiedTo) setCertifiedDraft(patch.certifiedTo);
                          }}
                          onDone={() => setRowEdit(null)}
                          reload={reload}
                        />
                      )}
                      <div className="sigwrap" style={{ marginTop: 10 }}>
                        <Pad
                          key={(sigPreview[a.id] ?? a.signature) || "blank-" + a.id}
                          className="rowsig"
                          initial={sigPreview[a.id] ?? a.signature}
                          ref={(h) => {
                            rowPads.current.set(a.id, h);
                          }}
                        />
                      </div>
                      <div className="attacts">
                        <button
                          type="button"
                          className="btn ghost"
                          onClick={() => {
                            rowPads.current.get(a.id)?.clear();
                            setSigPreview((current) => ({ ...current, [a.id]: "" }));
                            fapi("PATCH", `/api/training/${j.id}/attendees/${a.id}`, { signature: "" })
                              .then(() => toast("Signature cleared."))
                              .catch((e) => toast(e.message));
                          }}
                        >
                          Clear
                        </button>
                        <label className="btn ghost" htmlFor={`sigup_${a.id}`}>
                          Upload signature
                        </label>
                        <input
                          id={`sigup_${a.id}`}
                          className="sr-only"
                          type="file"
                          accept="image/*"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (!file) return;
                            if (!file.type.startsWith("image/")) {
                              toast("Upload a picture of the signature (JPG or PNG).");
                              return;
                            }
                            try {
                              const dataUrl = await shrinkImage(file, 900);
                              await fapi("PATCH", `/api/training/${j.id}/attendees/${a.id}`, { signature: dataUrl });
                              setSigPreview((current) => ({ ...current, [a.id]: dataUrl }));
                              toast("Trainee signature uploaded.");
                              await reload();
                            } catch (err) {
                              toast((err as Error).message);
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="btn sec"
                          onClick={async () => {
                            const pad = rowPads.current.get(a.id);
                            if (!pad) return;
                            try {
                              await fapi("PATCH", `/api/training/${j.id}/attendees/${a.id}`, {
                                signature: pad.dataUrl(),
                              });
                              toast("Signature submitted.");
                            } catch (e) {
                              toast((e as Error).message);
                            }
                          }}
                        >
                          Submit
                        </button>
                      </div>
                    </>
                  )}
                  {!canMark && a.signature && <img className="sg" src={a.signature} alt="sign" />}
                </article>
              );
            })
          ) : (
            <p className="muted">No trainees yet.</p>
          )}
        </div>
        {canMark && (
          <>
            <label className="fl">Authorized by</label>
            <input value={authorized} placeholder="Trainer name" onChange={(e) => setAuthorized(e.target.value)} />
            <label className="fl" id="tsiglbl">
              {office ? "Certificate Coordinator signature" : "Authorized by signature (optional)"}
            </label>
            <div className="sigwrap">
              <Pad
                key={shownSig || "blank"}
                className="sig"
                label={office ? "Certificate Coordinator signature" : "Authorized by signature"}
                ref={trainerPad}
                initial={shownSig}
                onDone={(d) => (trainerSig.current = d)}
              />
              <div className="sighint">
                {office ? "Draw the Certificate Coordinator signature, or upload a picture" : "Trainer signs here"}
              </div>
            </div>
            {office && (
              <>
                <input
                  ref={sigFile}
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    if (!file.type.startsWith("image/")) {
                      toast("Upload a picture of the signature (JPG or PNG).");
                      return;
                    }
                    try {
                      const dataUrl = await shrinkImage(file, 900);
                      trainerSig.current = dataUrl;
                      setShownSig(dataUrl);
                      await fapi("POST", `/api/training/${j.id}/attendance-meta`, {
                        trainerVerified: verified,
                        authorizedBy: authorized,
                        trainerSignature: dataUrl,
                      });
                      toast("Coordinator signature uploaded.");
                      await reload();
                    } catch (err) {
                      toast((err as Error).message);
                    }
                  }}
                />
                <button type="button" className="btn sec" style={{ marginTop: 8 }} onClick={() => sigFile.current?.click()}>
                  Upload coordinator signature
                </button>
              </>
            )}
            <button
              type="button"
              className="btn ghost"
              style={{ marginTop: 10 }}
              onClick={() => {
                trainerPad.current?.clear();
                trainerSig.current = null;
                setShownSig("");
              }}
            >
              Clear {office ? "coordinator" : "trainer"} signature
            </button>
            {j.trainerSignature && (
              <>
                <p className="okmsg">{office ? "Coordinator signature on file." : "Trainer signature on file."}</p>
                <img className="sg" src={j.trainerSignature} alt="Signature" />
              </>
            )}
            <label className="checkline">
              <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /> I verified
              this attendance sheet
            </label>
            <button className="btn sec" onClick={saveTrainerVerify}>
              Save verify &amp; signature
            </button>
            <div className="err">{verifyErr}</div>
          </>
        )}
        <button
          className="btn ok"
          style={{ marginTop: 12 }}
          onClick={() =>
            download(
              `/api/training/${j.id}/attendance-pdf`,
              "WESTCAL-" + (j.jobOrderNo || j.jobNo) + "-attendance.pdf",
              "Attendance sheet downloaded.",
            )
          }
        >
          Download attendance sheet
        </button>
        <p className="mini">Customer link: {publicUrl}</p>
        <button
          className="btn ghost"
          onClick={async () => {
            const text =
              "Westcal training attendance — open this link, upload your Emirates ID, check your details, sign and send:\n" +
              publicUrl;
            try {
              await navigator.clipboard.writeText(text);
              toast("Customer attendance link copied.");
            } catch {
              prompt("Copy this customer link", publicUrl);
            }
          }}
        >
          Copy customer attendance link
        </button>
      </div>
      {canSubmit && (
        <>
          <button className="btn ok" disabled={showAttendance && !verified} onClick={submitJob}>
            {j.status === "Rejected" ? "Send back to Certificate Coordinator" : "Send to Certificate Coordinator"}
          </button>
          {showAttendance && !verified && (
            <p className="muted" style={{ margin: "8px 0 0", textAlign: "center" }}>
              Tick <b>I verified this attendance sheet</b> first, then you can send.
            </p>
          )}
        </>
      )}
    </>
  );
}

function RowEdit({
  j,
  a,
  focusEid,
  eid,
  certifiedTo,
  onApplied,
  onDone,
  reload,
}: {
  j: Job;
  a: Attendee;
  focusEid: boolean;
  eid?: string;
  certifiedTo: string;
  onApplied: (patch: { company: string; certifiedTo: string }) => void;
  onDone: () => void;
  reload: () => Promise<Job[]>;
}) {
  const { toast } = useField();
  const [f, setF] = useState({
    name: a.name || "",
    eid: eid || a.idOrVisaNo || "",
    phone: a.mobileNumber || "",
    company: a.company || "",
    certifiedTo: certifiedTo || "",
  });
  const [err, setErr] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollIntoView({ block: "nearest" });
  }, []);

  async function save() {
    setErr("");
    const name = f.name.trim();
    const mobileNumber = f.phone.replace(/[\s\-+]/g, "");
    const company = f.company.trim();
    const certified = f.certifiedTo.trim();
    if (!name) return setErr("Name is required.");
    if (!company) return setErr("Company is required.");
    if (!certified) return setErr("Certified to is required.");
    try {
      await fapi("PATCH", `/api/training/${j.id}/attendees/${a.id}`, {
        name,
        idOrVisaNo: f.eid.trim(),
        mobileNumber,
        company,
      });
      if (certified !== certifiedTo.trim()) {
        await fapi("POST", `/api/training/${j.id}/attendance-meta`, { certifiedBy: certified });
      }
      onApplied({ company, certifiedTo: certified });
      toast("Trainee updated.");
      onDone();
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div ref={box} style={{ marginTop: 10, textAlign: "left" }}>
      <label className="fl">Name</label>
      <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <label className="fl">Emirates ID</label>
      <input
        value={f.eid}
        autoFocus={focusEid}
        placeholder="784-...."
        onChange={(e) => setF({ ...f, eid: e.target.value })}
      />
      <label className="fl">Phone</label>
      <input value={f.phone} inputMode="tel" onChange={(e) => setF({ ...f, phone: e.target.value })} />
      <label className="fl">Company</label>
      <input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} />
      <label className="fl">Certified to</label>
      <input value={f.certifiedTo} onChange={(e) => setF({ ...f, certifiedTo: e.target.value })} />
      <button type="button" className="btn ok" style={{ marginTop: 10 }} onClick={save}>
        Save update
      </button>
      <div className="err">{err}</div>
    </div>
  );
}

function Feedback() {
  const openReviews = () => {
    window.open("https://westcal.ae/", "_blank");
  };
  return (
    <div className="card">
      <h2>Customer Feedback</h2>
      <div style={{ marginTop: 20, padding: 16, backgroundColor: "#f8f9fa", borderRadius: 8 }}>
        <h3 style={{ margin: "0 0 12px", color: "#28a745" }}>Leave a Google Review</h3>
        <p className="muted" style={{ margin: "0 0 12px" }}>
          Help us improve our services by leaving a review on our website.
        </p>
        <button
          className="btn ok"
          onClick={openReviews}
          style={{ backgroundColor: "#4285f4", borderColor: "#4285f4", width: "100%" }}
        >
          🌟 Leave a Review on Westcal.ae
        </button>
      </div>
    </div>
  );
}
