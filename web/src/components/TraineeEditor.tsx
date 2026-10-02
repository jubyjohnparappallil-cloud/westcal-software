import { useState } from "react";
import { api } from "../api";
import { cropPortrait, formatEidLocal, ocrEmiratesCard, shrinkImage } from "../field/ocr";
import { jobCourses } from "../lib/jobs";
import type { Attendee, Job } from "../types";

/** Office edit form for one trainee. Used on the certificate page and the job detail. */
export function TraineeEditor({
  job,
  attendee,
  onSaved,
  extraButtons,
}: {
  job: Job;
  attendee: Attendee;
  onSaved: () => void;
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

  async function uploadId(idCardDataUrl: string) {
    const photoDataUrl = await cropPortrait(idCardDataUrl);
    let text = "";
    let fetched: Record<string, string> = {};
    try {
      text = await ocrEmiratesCard([idCardDataUrl]);
      if (text.trim()) fetched = await api("POST", `/api/training/${job.id}/id-fetch`, { ocrText: text });
    } catch {
      // unreadable card: keep the image, the office types the details
    }
    const eid = (fetched.idOrVisaNo || formatEidLocal(text) || "").trim();
    await api("PATCH", `/api/training/${job.id}/attendees/${attendee.id}`, {
      idCardDataUrl,
      photoDataUrl: photoDataUrl || undefined,
      idOrVisaNo: !f.idOrVisaNo && eid ? eid : undefined,
      name: !f.name && fetched.name ? fetched.name : undefined,
      nationality: fetched.nationality || undefined,
      dateOfBirth: fetched.dateOfBirth || undefined,
    });
    if (!f.idOrVisaNo && eid) setF((x) => ({ ...x, idOrVisaNo: eid }));
    onSaved();
  }

  return (
    <>
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
          <IdDropZone current={attendee.idCardDataUrl} onImage={uploadId} />
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
export function IdDropZone({ current, onImage }: { current?: string; onImage: (dataUrl: string) => Promise<void> }) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function take(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setErr("Drop a photo of the ID card (JPG or PNG).");
    setErr("");
    setBusy(true);
    try {
      await onImage(await shrinkImage(file, 1800));
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
        {current && <img src={current} alt="Emirates ID card" />}
        <span>
          {busy ? "Reading ID card…" : current ? "Drag a new ID card here or click to replace" : "Drag the ID card photo here or click to upload"}
        </span>
      </label>
      <div className="err">{err}</div>
    </>
  );
}
