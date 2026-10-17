import { useRef, useState } from "react";
import { api } from "../api";
import { useApp } from "../app-context";
import { usePhotoCrop } from "./PhotoCropper";
import { fieldsFromCardText, imageForRead, ocrEmiratesCard, prepareIdPhoto, shrinkImage } from "../field/ocr";
import { jobCompanyNames, jobCourses, normalizeEid } from "../lib/jobs";
import type { Job } from "../types";
import { IdDropZone } from "./TraineeEditor";

/** Office form to put trainees on the attendance sheet: one at a time (with ID card) or many at once. */
export function AddTrainee({ job: j, onAdded }: { job: Job; onAdded: () => void }) {
  const { perms } = useApp();
  const companies = jobCompanyNames(j);
  const courses = jobCourses(j);
  const [mode, setMode] = useState<"one" | "many">("one");
  const [f, setF] = useState({
    name: "",
    eid: "",
    phone: "",
    company: j.customerName || companies[0] || "",
    course: courses.length > 1 ? courses[0] : j.course || "",
  });
  const [card, setCard] = useState<{ idCardDataUrl: string; photoDataUrl?: string; nationality?: string; dateOfBirth?: string } | null>(null);
  const sourceRef = useRef<File | null>(null);
  const pendingSource = useRef<File | null>(null);
  const { crop, dialog: cropDialog } = usePhotoCrop();
  const [backPreview, setBackPreview] = useState("");
  const [bulk, setBulk] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function readCard(file: File) {
    sourceRef.current = pendingSource.current || file;
    const { card, portrait, ocrCard } = await prepareIdPhoto(file, { ocrSide: 1800, clarify: true });
    let text = "";
    let fetched: Record<string, string> = {};
    try {
      text = await ocrEmiratesCard([ocrCard]);
      if (text.trim()) fetched = await api("POST", `/api/training/${j.id}/id-fetch`, { ocrText: text });
    } catch {
      /* office types the details */
    }
    setCard({
      idCardDataUrl: card,
      photoDataUrl: portrait || card,
      nationality: fetched.nationality,
      dateOfBirth: fetched.dateOfBirth,
    });
    const local = fieldsFromCardText(text);
    setF((x) => ({
      ...x,
      name: local.name,
      eid: local.id,
      phone: x.phone || fetched.mobileNumber || "",
    }));
  }

  const post = (row: { name: string; eid: string; phone: string }, extra: Record<string, unknown> = {}) =>
    api("POST", `/api/training/${j.id}/attendees`, {
      name: row.name.trim(),
      company: f.company.trim() || j.customerName || "",
      mobileNumber: row.phone.replace(/[\s-+]/g, ""),
      nationality: "",
      idOrVisaNo: normalizeEid(row.eid),
      course: f.course || j.course || "",
      autoFetched: false,
      ...extra,
    });

  async function addOne() {
    setErr("");
    setMsg("");
    if (!f.name.trim()) return setErr("Enter the trainee name.");
    if (!(f.company.trim() || j.customerName)) return setErr("Enter the trainee company.");
    setBusy(true);
    try {
      await post(f, card ? { ...card, nationality: card.nationality || "", autoFetched: true } : {});
      setMsg(`${f.name.trim()} added.`);
      setF({ ...f, name: "", eid: "", phone: "" });
      setCard(null);
      setBackPreview("");
      onAdded();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function readBack(file: File) {
    setErr("");
    const image = await shrinkImage(file, 1400);
    setBackPreview(image);
    let employer = "";
    try {
      const text = await ocrEmiratesCard([await imageForRead(file)]);
      if (text.trim()) {
        const fetched = await api<{ employer?: string; company?: string }>("POST", `/api/training/${j.id}/id-fetch`, { ocrText: text });
        employer = (fetched.employer || fetched.company || "").trim();
      }
    } catch {
      /* coordinator can type the employer */
    }
    if (!employer) return setErr("Could not read the Employer line on the ID back. Type it in Company.");
    setF((x) => ({ ...x, company: employer }));
    setMsg(`Employer from the ID back: ${employer}`);
  }

  async function addMany() {
    setErr("");
    setMsg("");
    const rows = bulk
      .split(/\r?\n/)
      .map((line) => line.split(/[,\t]/).map((s) => s.trim()))
      .filter((p) => p[0])
      .map(([name, eid = "", phone = ""]) => ({ name, eid, phone }));
    if (!rows.length) return setErr("Type one trainee per line.");
    if (!(f.company.trim() || j.customerName)) return setErr("Enter the trainee company.");
    setBusy(true);
    const failed: { row: (typeof rows)[number]; why: string }[] = [];
    for (const row of rows) {
      try {
        await post(row);
      } catch (e) {
        failed.push({ row, why: (e as Error).message });
      }
    }
    setBusy(false);
    const added = rows.length - failed.length;
    setMsg(added ? `${added} trainee${added === 1 ? "" : "s"} added.` : "");
    setErr(failed.map((x) => `${x.row.name}: ${x.why}`).join("\n"));
    setBulk(failed.map((x) => [x.row.name, x.row.eid, x.row.phone].filter(Boolean).join(", ")).join("\n"));
    if (added) onAdded();
  }

  async function cropFace() {
    const file = sourceRef.current;
    if (!file) return;
    const face = await crop(file, "photo");
    if (!face) return;
    const photoDataUrl = await shrinkImage(face, 800);
    setCard((current) => (current ? { ...current, photoDataUrl } : current));
  }

  async function fetchAgain() {
    const file = sourceRef.current;
    if (!file) return;
    setErr("");
    const cropped = await crop(file, "id");
    if (!cropped) return;
    setBusy(true);
    try {
      await readCard(cropped);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const shared = (
    <>
      <div>
        <label>Company</label>
        {companies.length > 1 ? (
          <select value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })}>
            {companies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        ) : (
          <input value={f.company} placeholder="Employer of this trainee" onChange={(e) => setF({ ...f, company: e.target.value })} />
        )}
      </div>
      <div>
        <label>Course</label>
        {courses.length > 1 ? (
          <select value={f.course} onChange={(e) => setF({ ...f, course: e.target.value })}>
            {courses.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        ) : (
          <input value={j.course || ""} readOnly />
        )}
      </div>
    </>
  );

  return (
    <div className="job-block" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h4 style={{ margin: 0 }}>Add trainees to the attendance sheet</h4>
        <div className="subtabs" style={{ margin: 0 }}>
          <button className={mode === "one" ? "on" : ""} onClick={() => setMode("one")}>
            One by one
          </button>
          <button className={mode === "many" ? "on" : ""} onClick={() => setMode("many")}>
            Many at once
          </button>
        </div>
      </div>

      {mode === "one" ? (
        <>
          <p className="hint">Drop the Emirates ID. Zoom in until the name and ID number are clear, then fetch the details. You can also type them.</p>
          <IdDropZone current={card?.idCardDataUrl} onFile={readCard} onPicked={(file) => (pendingSource.current = file)} cropPurpose="id" />
          {card?.photoDataUrl && (
            <div className="id-face-row">
              <img src={card.photoDataUrl} alt="Photo from the ID card" />
              <div>
                <p className="hint" style={{ margin: 0 }}>
                  Photo from the card. Zoom in if the face is not clear, or zoom the card again and fetch the data.
                </p>
                <p style={{ margin: "8px 0 0", display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="btn sec sm" onClick={() => cropFace().catch((e) => setErr((e as Error).message))}>
                    Zoom and crop photo
                  </button>
                  <button type="button" className="btn ghost sm" disabled={busy} onClick={() => fetchAgain().catch((e) => setErr((e as Error).message))}>
                    Zoom and fetch again
                  </button>
                </p>
              </div>
            </div>
          )}
          {cropDialog}
          {perms.canIssueCerts() && (
            <div style={{ marginTop: 10 }}>
              <label>ID back side</label>
              <p className="hint">Upload the back of the Emirates ID. The Employer on that side is what prints on the special certificate.</p>
              <IdDropZone
                current={backPreview}
                onFile={readBack}
                cropPurpose="back"
                idle="Drag the ID back side here or click to upload"
                replace="Drag a new ID back side here or click to replace"
                busyText="Reading employer…"
                alt="Emirates ID back"
              />
            </div>
          )}
          <div className="grid">
            <div>
              <label>Name *</label>
              <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addOne()} />
            </div>
            <div>
              <label>Emirates ID</label>
              <input value={f.eid} placeholder="784-1990-1234567-1" onChange={(e) => setF({ ...f, eid: e.target.value })} />
            </div>
            <div>
              <label>Phone</label>
              <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
            </div>
            {shared}
          </div>
          <button className="btn sm" style={{ marginTop: 10 }} disabled={busy} onClick={addOne}>
            {busy ? "Adding…" : "+ Add trainee"}
          </button>
        </>
      ) : (
        <>
          <p className="hint">One trainee per line: Name, Emirates ID, Phone. Only the name is required. You can paste from Excel.</p>
          <textarea
            rows={6}
            value={bulk}
            placeholder={"Ahmed Ali, 784-1990-1234567-1, 0501234567\nJohn Mathew\nRavi Kumar, 784-1985-7654321-2"}
            onChange={(e) => setBulk(e.target.value)}
          />
          <div className="grid" style={{ marginTop: 8 }}>
            {shared}
          </div>
          <button className="btn sm" style={{ marginTop: 10 }} disabled={busy} onClick={addMany}>
            {busy ? "Adding…" : "+ Add all trainees"}
          </button>
        </>
      )}
      {msg && <div className="ok-msg">{msg}</div>}
      <div className="err" style={{ whiteSpace: "pre-line" }}>
        {err}
      </div>
    </div>
  );
}
