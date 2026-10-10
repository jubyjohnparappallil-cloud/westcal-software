import { useRef, useState } from "react";
import { api } from "../api";
import { Pad, type PadHandle } from "../field/Pad";
import { formatEidLocal, ocrEmiratesCard, prepareIdPhoto, shrinkImage } from "../field/ocr";
import { jobCourses } from "../lib/jobs";
import type { Attendee, Job } from "../types";

/** Draw or upload a signature (trainee or Certificate Coordinator). */
export function SignBox({
  label,
  hint,
  value,
  onSave,
}: {
  label: string;
  hint?: string;
  value?: string;
  onSave: (dataUrl: string) => Promise<void>;
}) {
  const pad = useRef<PadHandle>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function saveDrawn() {
    const dataUrl = pad.current?.dataUrl() || "";
    if (!dataUrl) return setErr("Draw the signature first, or upload a picture.");
    setErr("");
    setBusy(true);
    try {
      await onSave(dataUrl);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setErr("Upload a photo of the signature (JPG or PNG).");
    setErr("");
    setBusy(true);
    try {
      await onSave(await shrinkImage(file, 900));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    pad.current?.clear();
    setErr("");
    setBusy(true);
    try {
      await onSave("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sign-box">
      <label>{label}</label>
      {hint && <p className="hint" style={{ margin: "4px 0 8px" }}>{hint}</p>}
      {value && <img className="office-sig-preview" src={value} alt="" />}
      <Pad key={value ? "has" : "empty"} className="sig-pad office-sig" label={label} initial={value} ref={pad} />
      <p style={{ margin: "8px 0 0", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn sec sm" disabled={busy} onClick={saveDrawn}>
          {busy ? "Saving…" : "Save signature"}
        </button>
        <label className="btn ghost sm" style={{ margin: 0 }}>
          Upload signature
          <input type="file" accept="image/*" hidden onChange={(e) => (upload(e.target.files?.[0]), (e.target.value = ""))} />
        </label>
        {value && (
          <button type="button" className="btn ghost sm" disabled={busy} onClick={clear}>
            Clear
          </button>
        )}
      </p>
      <div className="err">{err}</div>
    </div>
  );
}

/** Office edit form for one trainee. Used on the certificate page and the job detail. */
export function TraineeEditor({
  job,
  attendee,
  onSaved,
  onDeleted,
  extraButtons,
}: {
  job: Job;
  attendee: Attendee;
  onSaved: () => void;
  onDeleted?: () => void;
  extraButtons?: React.ReactNode;
}) {
  const courses = jobCourses(job);
  const options = courses.length ? courses : [attendee.course || job.course || ""];
  const [f, setF] = useState({
    name: attendee.name || "",
    idOrVisaNo: attendee.idOrVisaNo || "",
    mobileNumber: attendee.mobileNumber || "",
    company: attendee.company || "",
    course: attendee.course || job.course || options[0] || "",
  });

  async function save() {
    try {
      await api("PATCH", `/api/training/${job.id}/attendees/${attendee.id}`, f);
      onSaved();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function uploadIdFile(file: File) {
    const { card, portrait, ocrCard } = await prepareIdPhoto(file);
    let text = "";
    let fetched: Record<string, string> = {};
    try {
      text = await ocrEmiratesCard([ocrCard]);
      if (text.trim()) fetched = await api("POST", `/api/training/${job.id}/id-fetch`, { ocrText: text });
    } catch {
      /* still save the photo */
    }
    const eid = (fetched.idOrVisaNo || formatEidLocal(text) || "").trim();
    await api("PATCH", `/api/training/${job.id}/attendees/${attendee.id}`, {
      idCardDataUrl: card,
      photoDataUrl: portrait || card,
      ...(eid ? { idOrVisaNo: eid } : {}),
      ...(fetched.name ? { name: fetched.name } : {}),
      nationality: fetched.nationality || undefined,
      dateOfBirth: fetched.dateOfBirth || undefined,
      autoFetched: !!eid,
    });
    if (eid) setF((x) => ({ ...x, idOrVisaNo: eid, name: x.name || fetched.name || x.name }));
    if (fetched.name) setF((x) => ({ ...x, name: fetched.name || x.name }));
    onSaved();
  }

  async function uploadFace(file: File) {
    await api("PATCH", `/api/training/${job.id}/attendees/${attendee.id}`, { photoDataUrl: await shrinkImage(file) });
    onSaved();
  }

  async function remove() {
    if (!confirm("Remove " + (attendee.name || "this trainee") + " from attendance?")) return;
    await api("DELETE", `/api/training/${job.id}/attendees/${attendee.id}`);
    onDeleted?.();
    onSaved();
  }

  return (
    <>
      <div className="attacts" style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label className="btn ghost sm" htmlFor={`repid_${attendee.id}`}>
          Re-upload EID
        </label>
        <input
          id={`repid_${attendee.id}`}
          className="sr-only"
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) uploadIdFile(file).catch((err) => alert((err as Error).message));
          }}
        />
        <label className="btn ghost sm" htmlFor={`repph_${attendee.id}`}>
          New photo
        </label>
        <input
          id={`repph_${attendee.id}`}
          className="sr-only"
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) uploadFace(file).catch((err) => alert((err as Error).message));
          }}
        />
        <button type="button" className="btn ghost sm" onClick={() => remove().catch((err) => alert((err as Error).message))}>
          Delete
        </button>
      </div>
      <div className="grid" style={{ marginTop: 10 }}>
        <div>
          <label>Name</label>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div>
          <label>Emirates ID</label>
          <input value={f.idOrVisaNo} onChange={(e) => setF({ ...f, idOrVisaNo: e.target.value })} />
        </div>
        <div>
          <label>Phone</label>
          <input value={f.mobileNumber} onChange={(e) => setF({ ...f, mobileNumber: e.target.value })} />
        </div>
        <div>
          <label>Company</label>
          <input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} />
        </div>
        <div className="span-2">
          <label>Course</label>
          <select value={f.course} onChange={(e) => setF({ ...f, course: e.target.value })}>
            {options.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="span-2">
          <label>Emirates ID card</label>
          <IdDropZone
            current={attendee.idCardDataUrl}
            hasCard={!!(attendee.hasIdCard || attendee.idCardDataUrl)}
            onFile={uploadIdFile}
          />
        </div>
        <div className="span-2">
          <SignBox
            label="Trainee signature"
            hint="Draw here or upload a signed picture. Certificate Coordinators can complete this in the office."
            value={attendee.signature}
            onSave={async (signature) => {
              await api("PATCH", `/api/training/${job.id}/attendees/${attendee.id}`, { signature });
              onSaved();
            }}
          />
        </div>
      </div>
      <p style={{ margin: "10px 0 0" }}>
        <button className="btn sec sm" onClick={save}>
          Save trainee
        </button>{" "}
        {extraButtons}
      </p>
    </>
  );
}

/** Drop an ID card image here or click to pick one. */
export function IdDropZone({
  current,
  hasCard,
  onFile,
}: {
  current?: string;
  hasCard?: boolean;
  onFile: (file: File) => Promise<void>;
}) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const showCard = current && current.startsWith("data:");

  async function take(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setErr("Drop a photo of the ID card (JPG or PNG).");
    setErr("");
    setBusy(true);
    try {
      await onFile(file);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <label
        className={"id-drop" + (over ? " over" : "")}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files[0]);
        }}
      >
        <input type="file" accept="image/*" hidden onChange={(e) => (take(e.target.files?.[0]), (e.target.value = ""))} />
        {showCard && <img src={current} alt="Emirates ID card" />}
        <span>
          {busy
            ? "Reading ID card…"
            : showCard || hasCard
              ? "Drag a new ID card here or click to replace"
              : "Drag the ID card photo here or click to upload"}
        </span>
      </label>
      <div className="err">{err}</div>
    </>
  );
}
