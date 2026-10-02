import { useState } from "react";
import { api } from "../api";
import { cropPortrait, formatEidLocal, ocrEmiratesCard } from "../field/ocr";
import { jobCompanyNames, jobCourses, normalizeEid } from "../lib/jobs";
import type { Job } from "../types";
import { IdDropZone } from "./TraineeEditor";

/** Office form to put trainees on the attendance sheet: one at a time (with ID card) or many at once. */
export function AddTrainee({ job: j, onAdded }: { job: Job; onAdded: () => void }) {
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
  const [bulk, setBulk] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function readCard(idCardDataUrl: string) {
    const photoDataUrl = (await cropPortrait(idCardDataUrl)) || undefined;
    let text = "";
    let fetched: Record<string, string> = {};
    try {
      text = await ocrEmiratesCard([idCardDataUrl]);
      if (text.trim()) fetched = await api("POST", `/api/training/${j.id}/id-fetch`, { ocrText: text });
    } catch {
      // unreadable card: the office types the details
    }
    setCard({ idCardDataUrl, photoDataUrl, nationality: fetched.nationality, dateOfBirth: fetched.dateOfBirth });
    setF((x) => ({
      ...x,
      name: x.name || fetched.name || "",
      eid: x.eid || fetched.idOrVisaNo || formatEidLocal(text) || "",
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
      onAdded();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
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
          <p className="hint">Drop the Emirates ID card to fill the details, or type them.</p>
          <IdDropZone current={card?.idCardDataUrl} onImage={readCard} />
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
