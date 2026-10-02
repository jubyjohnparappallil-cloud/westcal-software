import { useRef, useState } from "react";
import type { Attendee, Job } from "../types";
import { apiBase, downloadBlob, fapi } from "./api";
import { Capture } from "./Capture";
import { chipClass, fieldDate, isTrainer, isTrainingJob, statusLabel, useField } from "./FieldApp";
import { cropPortrait, formatEidLocal, ocrEmiratesCard, shrinkImage } from "./ocr";
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
interface Fetched {
  name?: string;
  idOrVisaNo?: string;
  nationality?: string;
  dateOfBirth?: string;
}

const WESTCAL_NAME = "Westcal Instrumentation and Calibration Services LLC";

function sheetView(j: Job) {
  const logoSrc = j.sheetInsigniaLogoDataUrl || "/logo.jpg";
  const jobLabel = (j.sheetJobLabel || "").trim() || "WESTCAL Job";
  const jobNo =
    (j.sheetJobNo || "").trim() ||
    String(j.jobOrderNo || j.jobNo || "").replace(/\D/g, "") ||
    j.jobOrderNo ||
    j.jobNo ||
    "";
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
            {j.jobNo}
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
        {j.address && (
          <a
            className="btn sec"
            style={{ marginTop: 6 }}
            href={`https://maps.google.com/?q=${encodeURIComponent(j.address)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Directions to site
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
          <label className="fl">Prepared by</label>
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
  const [dropRow, setDropRow] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(
    j.authorizedBy || j.assigneeName || j.trainerName || session.displayName || "",
  );
  const [verified, setVerified] = useState(!!j.trainerVerified);
  const trainerSig = useRef<string | null>(j.trainerSignature || null);
  const trainerPad = useRef<PadHandle>(null);
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
    if (
      !confirm(
        j.status === "Rejected"
          ? "Send this attendance sheet back to the admin team?"
          : "Send this verified attendance sheet to the admin team?",
      )
    )
      return;
    try {
      await fapi("POST", `/api/training/${j.id}/submit`, {});
      toast("Submitted to the office.");
      await openJob(j.id);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function replacePhoto(a: Attendee, file: File) {
    try {
      const dataUrl = await shrinkImage(file, 1400);
      await fapi("PATCH", `/api/training/${j.id}/attendees/${a.id}`, {
        extraPhotoDataUrl: dataUrl,
        photoDataUrl: dataUrl,
      });
      toast("New photo saved. Send back to admin after you verify.");
      await reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function replaceId(a: Attendee, file: File) {
    toast("Reading Emirates ID…");
    try {
      const idCardDataUrl = await shrinkImage(file, 1800);
      const photoDataUrl = await cropPortrait(idCardDataUrl);
      let text = "";
      let fetched: Fetched = {};
      try {
        text = await ocrEmiratesCard([idCardDataUrl]);
        if (text.trim()) fetched = await fapi<Fetched>("POST", `/api/training/${j.id}/id-fetch`, { ocrText: text });
      } catch {
        toast("Could not auto-read the number. Type it below.");
      }
      const eid = (fetched.idOrVisaNo || formatEidLocal(text) || "").trim();
      await fapi("PATCH", `/api/training/${j.id}/attendees/${a.id}`, {
        idCardDataUrl,
        photoDataUrl,
        name: fetched.name || undefined,
        idOrVisaNo: eid || undefined,
        nationality: fetched.nationality || undefined,
        dateOfBirth: fetched.dateOfBirth || undefined,
        autoFetched: !!eid,
      });
      toast(eid ? "EID saved: " + eid : "Card photo saved. Type the Emirates ID number (784-…) and tap Save update.");
      await reload();
      setRowEdit({ id: a.id, focusEid: true, eid });
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
            <b>Office sent this back.</b> Edit any trainee field below, then send back to admin.
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
        <p className="muted" style={{ textAlign: "center" }}>
          {s.courseTitle} | {s.date} | {s.invoiced}
        </p>
        <table className="sheet" style={{ marginTop: 12, minWidth: 0 }}>
          <tbody>
            {[
              [s.jobLabel, s.jobNo],
              ["Training", s.courseTitle],
              ["Training date", s.date],
              ["Company", s.invoiced],
              ["Certified to", s.certifiedBy],
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
          </tbody>
        </table>
        <div className="sheetwrap">
          <table className="sheet">
            <thead>
              <tr>
                <th>#</th>
                <th>Trainee</th>
                <th>Photo</th>
                <th>Signature</th>
              </tr>
            </thead>
            <tbody>
              {j.attendees.length ? (
                j.attendees.map((a, i) => {
                  const photo = a.photoDataUrl || a.extraPhotoDataUrl || "";
                  const open = rowEdit?.id === a.id;
                  return (
                    <tr
                      key={a.id}
                      className={dropRow === a.id ? "dragover" : undefined}
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
                      <td>{i + 1}</td>
                      <td>
                        <b>{a.name}</b>
                        <br />
                        <span className="mini">EID: {a.idOrVisaNo || "not on file — Re-upload EID or type it"}</span>
                        <br />
                        <span className="mini">Training date: {s.date}</span>
                        <br />
                        <span className="mini">Certified to: {s.certifiedBy}</span>
                        <br />
                        <span className="mini">{a.course || j.course || ""}</span>
                        {canMark && (
                          <>
                            <div className="attacts">
                              <button
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
                                capture="environment"
                                onChange={(e) => e.target.files?.[0] && replaceId(a, e.target.files[0])}
                              />
                              <label className="btn ghost" htmlFor={`repph_${a.id}`}>
                                New photo
                              </label>
                              <input
                                id={`repph_${a.id}`}
                                className="sr-only"
                                type="file"
                                accept="image/*"
                                onChange={(e) => e.target.files?.[0] && replacePhoto(a, e.target.files[0])}
                              />
                            </div>
                            {open && rowEdit && (
                              <RowEdit
                                j={j}
                                a={a}
                                focusEid={rowEdit.focusEid}
                                eid={rowEdit.eid}
                                onDone={() => setRowEdit(null)}
                                reload={reload}
                              />
                            )}
                          </>
                        )}
                      </td>
                      <td className="sig">
                        {photo && (
                          <img
                            src={photo}
                            alt=""
                            style={{ height: 72, width: 58, objectFit: "cover", maxWidth: "none" }}
                          />
                        )}
                      </td>
                      <td className="sig">
                        {canMark ? (
                          <>
                            <Pad
                              className="rowsig"
                              initial={a.signature}
                              ref={(h) => {
                                rowPads.current.set(a.id, h);
                              }}
                            />
                            <button
                              className="btn ghost"
                              style={{ minHeight: 36, marginTop: 6 }}
                              onClick={() => {
                                rowPads.current.get(a.id)?.clear();
                                fapi("PATCH", `/api/training/${j.id}/attendees/${a.id}`, { signature: "" })
                                  .then(() => toast("Signature cleared."))
                                  .catch((e) => toast(e.message));
                              }}
                            >
                              Clear
                            </button>
                            <button
                              className="btn sec"
                              style={{ minHeight: 36, marginTop: 6 }}
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
                          </>
                        ) : (
                          a.signature && <img src={a.signature} alt="sign" />
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={4} className="muted">
                    No trainees yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {canMark && (
          <>
            <label className="fl">Authorized by</label>
            <input value={authorized} placeholder="Trainer name" onChange={(e) => setAuthorized(e.target.value)} />
            <label className="fl" id="tsiglbl">
              Authorized by signature (optional)
            </label>
            <div className="sigwrap">
            <Pad
              className="sig"
              label="Authorized by signature"
                ref={trainerPad}
                initial={j.trainerSignature}
                onDone={(d) => (trainerSig.current = d)}
              />
              <div className="sighint">Trainer signs here</div>
            </div>
            <button
              className="btn ghost"
              style={{ marginTop: 10 }}
              onClick={() => {
                trainerPad.current?.clear();
                trainerSig.current = null;
              }}
            >
              Clear trainer signature
            </button>
            {j.trainerSignature && (
              <>
                <p className="okmsg">Trainer signature on file.</p>
                <img className="sg" src={j.trainerSignature} alt="Trainer signature" />
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
        <button className="btn ok" onClick={submitJob}>
          {j.status === "Rejected" ? "Send back to admin" : "Send to admin"}
        </button>
      )}
    </>
  );
}

function RowEdit({
  j,
  a,
  focusEid,
  eid,
  onDone,
  reload,
}: {
  j: Job;
  a: Attendee;
  focusEid: boolean;
  eid?: string;
  onDone: () => void;
  reload: () => Promise<Job[]>;
}) {
  const { toast } = useField();
  const [f, setF] = useState({
    name: a.name || "",
    eid: eid || a.idOrVisaNo || "",
    phone: a.mobileNumber || "",
    company: a.company || "",
  });
  const [err, setErr] = useState("");

  async function save() {
    setErr("");
    const name = f.name.trim();
    const mobileNumber = f.phone.replace(/[\s\-+]/g, "");
    if (!name) return setErr("Name is required.");
    try {
      await fapi("PATCH", `/api/training/${j.id}/attendees/${a.id}`, {
        name,
        idOrVisaNo: f.eid.trim(),
        mobileNumber,
        company: f.company.trim(),
      });
      toast("Trainee updated.");
      onDone();
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div
      style={{ marginTop: 10, textAlign: "left" }}
      ref={(el) => el?.scrollIntoView({ behavior: "smooth", block: "center" })}
    >
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
      <button className="btn ok" style={{ marginTop: 10 }} onClick={save}>
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
