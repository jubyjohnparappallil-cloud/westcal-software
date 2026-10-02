import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import type { Job } from "../types";
import { fapi } from "./api";
import { useField } from "./FieldApp";
import { cropPortrait, formatEidLocal, ocrEmiratesCard, shrinkImage } from "./ocr";
import { useDropImage } from "./useDropImage";

interface Fetched {
  name?: string;
  idOrVisaNo?: string;
  nationality?: string;
  mobileNumber?: string;
  dateOfBirth?: string;
  company?: string;
  course?: string;
  confidence?: number;
}
const BLANK: Fetched = { name: "", idOrVisaNo: "", nationality: "", mobileNumber: "", dateOfBirth: "", confidence: 0 };

export function Capture({ job, onSaved }: { job: Job; onSaved: () => void }) {
  const { toast } = useField();
  const [mode, setMode] = useState<"photo" | "sample" | "manual">("photo");
  const [idCard, setIdCard] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [extra, setExtra] = useState<string | null>(null);
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [fetchSeq, setFetchSeq] = useState(0);
  const [scanBox, setScanBox] = useState<ReactNode>(null);
  const [showPaste, setShowPaste] = useState(false);

  const fill = (f: Fetched, paste: boolean) => {
    setFetched(f);
    setShowPaste(paste);
    setFetchSeq((n) => n + 1);
  };

  useEffect(() => {
    if (!idCard || fetched) return;
    let cancelled = false;
    (async () => {
      setScanBox(
        <div className="scanning">
          <span className="spin" aria-hidden="true"></span>
          <span role="status">Reading the card…</span>
        </div>,
      );
      let text = "";
      try {
        text = await ocrEmiratesCard([idCard, extra].filter((x): x is string => !!x));
      } catch {
        text = "";
      }
      if (cancelled) return;
      if (!text.trim()) {
        setScanBox(
          <p className="muted" style={{ margin: "12px 0 0" }}>
            Could not read the card automatically. Type the details below, or paste the card text. Photograph the lower
            ID-number strip or the back of the card.
          </p>,
        );
        fill({ ...BLANK }, true);
        return;
      }
      let f: Fetched;
      try {
        f = await fapi<Fetched>("POST", `/api/training/${job.id}/id-fetch`, { ocrText: text });
      } catch {
        f = { ...BLANK };
      }
      if (cancelled) return;
      if (!f.idOrVisaNo) f.idOrVisaNo = formatEidLocal(text);
      if (!f.idOrVisaNo) {
        const typed = (prompt("ID number was not read from the card. Type the Emirates ID (784-....)") || "").trim();
        if (typed) f.idOrVisaNo = formatEidLocal(typed) || typed;
      }
      const percent = Math.round((f.confidence || 0) * 100);
      const missingId = !f.idOrVisaNo;
      setScanBox(
        <>
          <p className="okmsg" role="status">
            Read {percent}% of the fields. Check them before saving.
          </p>
          {missingId && (
            <p className="muted">
              ID number was not in the first photo. Use <b>Upload ID back (number strip)</b> — the 784 number sits in
              the lower band and on the reverse.
            </p>
          )}
        </>,
      );
      fill(f, missingId);
    })();
    return () => {
      cancelled = true;
    };
  }, [idCard, extra, fetched, job.id]);

  async function onIdPicked(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("Please choose an image.");
    try {
      const card = await shrinkImage(file, 1800);
      setPhoto(await cropPortrait(card));
      setExtra(null);
      setFetched(null);
      setIdCard(card);
      setMode("photo");
    } catch {
      toast("Could not read that image.");
    }
  }

  const { dragging, dropProps } = useDropImage((file) => onIdPicked(file));

  async function onExtraPicked(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("Please choose an image.");
    try {
      setExtra(await shrinkImage(file, 1800));
      setFetched(null);
    } catch {
      toast("Could not read that image.");
    }
  }

  async function useSample() {
    const sample = [
      "Name: HAROON UR RASHEED",
      "ID Number: 784-1990-1234567-1",
      "Date of Birth: 05/09/1990",
      "Nationality: Pakistan",
      "+971 56 665 4326",
    ].join("\n");
    try {
      const f = await fapi<Fetched>("POST", `/api/training/${job.id}/id-fetch`, { ocrText: sample });
      setIdCard(null);
      setMode("sample");
      setScanBox(
        <p className="okmsg">Sample scan filled name, ID number, DOB and nationality. Check, then add to the list.</p>,
      );
      fill(f, true);
      toast("Sample Emirates ID loaded.");
    } catch (e) {
      toast((e as Error).message);
    }
  }

  function manualEntry() {
    setIdCard(null);
    setPhoto(null);
    setMode("manual");
    setScanBox(null);
    fill({ ...BLANK }, true);
  }

  return (
    <>
      {mode === "photo" &&
        (idCard ? (
          <>
            <div className={"shots" + (dragging ? " dragover" : "")} {...dropProps} title="Drop a new ID card photo here to replace it">
              <figure className="idshot">
                <img src={idCard} alt="Captured ID card" />
                <figcaption>ID card</figcaption>
              </figure>
              {photo && (
                <figure className="portrait">
                  <img src={photo} alt="Photo read from the ID card" />
                  <figcaption>Photo</figcaption>
                </figure>
              )}
              {extra && (
                <figure className="portrait">
                  <img src={extra} alt="Extra uploaded photo" />
                  <figcaption>Extra photo</figcaption>
                </figure>
              )}
            </div>
            <label className="btn sec" style={{ marginTop: 10 }} htmlFor="extrafile">
              Upload ID back (number strip)
            </label>
            <input
              id="extrafile"
              className="sr-only"
              type="file"
              accept="image/*"
              onChange={(e) => onExtraPicked(e.target.files?.[0])}
            />
            <label className="btn ghost" style={{ marginTop: 8 }} htmlFor="idfile">
              Replace ID
            </label>
            <input
              id="idfile"
              className="sr-only"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => onIdPicked(e.target.files?.[0])}
            />
          </>
        ) : (
          <>
            <div className={"capture" + (dragging ? " dragover" : "")} {...dropProps}>
              <span className="big" aria-hidden="true">
                📷
              </span>
              <p style={{ margin: "0 0 12px" }}>
                <b>Upload Emirates ID</b>
              </p>
              <p className="drop-hint">Drag the ID card photo here, or use a button below.</p>
              <label className="btn" style={{ marginTop: 8 }} htmlFor="idfile">
                Open camera
              </label>
              <input
                id="idfile"
                className="sr-only"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => onIdPicked(e.target.files?.[0])}
              />
              <label className="btn sec" style={{ marginTop: 10 }} htmlFor="idfile2">
                Choose photo
              </label>
              <input
                id="idfile2"
                className="sr-only"
                type="file"
                accept="image/*"
                onChange={(e) => onIdPicked(e.target.files?.[0])}
              />
            </div>
            <button className="btn ghost" style={{ marginTop: 8 }} onClick={useSample}>
              Try sample ID
            </button>
            <button className="btn ghost" onClick={manualEntry}>
              Type details without ID
            </button>
          </>
        ))}
      <div>{scanBox}</div>
      <TraineeFields
        key={fetchSeq}
        job={job}
        fetched={fetched || {}}
        showPaste={showPaste}
        onPasted={(f) => fill(f, true)}
        images={{ idCard, photo, extra }}
        onSaved={onSaved}
      />
    </>
  );
}

function TraineeFields(props: {
  job: Job;
  fetched: Fetched;
  showPaste: boolean;
  onPasted: (f: Fetched) => void;
  images: { idCard: string | null; photo: string | null; extra: string | null };
  onSaved: () => void;
}) {
  const { job, fetched: f, images } = props;
  const { toast } = useField();
  const courses = String(job.course || "")
    .split(" · ")
    .map((s) => s.trim())
    .filter(Boolean);
  const companies = [...new Set([job.customerName, ...(job.companies || [])].filter(Boolean))];
  const [v, setV] = useState({
    name: f.name || "",
    id: f.idOrVisaNo || "",
    dob: f.dateOfBirth || "",
    trainDate: job.trainingDate || "",
    certified: (job.certificateUnder || job.customerName || "").trim(),
    nat: f.nationality || "",
    mob: f.mobileNumber || "",
    company: f.company || job.customerName || "",
  });
  const [ticked, setTicked] = useState<string[]>(f.course ? [f.course] : []);
  const [paste, setPaste] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV({ ...v, [k]: e.target.value });

  async function parsePasted() {
    if (!paste.trim()) return;
    try {
      props.onPasted(await fapi<Fetched>("POST", `/api/training/${job.id}/id-fetch`, { ocrText: paste }));
      toast("Filled from the pasted text.");
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function save() {
    setErr("");
    const mob = v.mob.replace(/[\s\-+]/g, "");
    if (!v.name.trim()) return setErr("Name is required.");
    const picked = courses.length > 1 ? ticked : [courses[0] || job.course || ""].filter(Boolean);
    if (!picked.length) return setErr("Tick at least one training course.");
    const trainingDate = v.trainDate.trim();
    const certifiedBy = v.certified.trim();
    if (!trainingDate) return setErr("Training date is required. It prints on the attendance sheet.");
    if (!certifiedBy) return setErr("Certified to is required. It prints on the attendance sheet.");
    setBusy(true);
    try {
      if (job.status !== "Approved" && job.status !== "Cancelled")
        await fapi("POST", `/api/training/${job.id}/attendance-meta`, {
          trainingDate,
          trainingDateTo: trainingDate,
          certifiedBy,
        });
      await fapi("POST", `/api/training/${job.id}/attendees`, {
        name: v.name,
        company: v.company,
        idOrVisaNo: v.id.trim(),
        nationality: v.nat,
        mobileNumber: mob,
        dateOfBirth: v.dob || undefined,
        idCardDataUrl: images.idCard || undefined,
        photoDataUrl: images.photo || undefined,
        extraPhotoDataUrl: images.extra || undefined,
        autoFetched: !!(f.confidence && f.confidence > 0),
        course: picked[0],
        courses: picked,
        idCardFileName: images.idCard ? "emirates-id.jpg" : undefined,
      });
      toast("Trainee added.");
      props.onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div>
      {props.showPaste && (
        <>
          <label className="fl" htmlFor="ocr">
            Paste card text (optional)
          </label>
          <textarea
            id="ocr"
            value={paste}
            placeholder={"Name: HAROON UR RASHEED\nID Number: 784-1990-1234567-1"}
            onChange={(e) => setPaste(e.target.value)}
          />
          <button className="btn sec" style={{ marginTop: 10 }} onClick={parsePasted}>
            Fill from text
          </button>
        </>
      )}
      <label className="fl">Full name *</label>
      <input value={v.name} autoComplete="name" onChange={set("name")} />
      <label className="fl">Emirates ID / Visa no</label>
      <input value={v.id} autoComplete="off" onChange={set("id")} />
      <label className="fl">Date of birth</label>
      <input type="date" value={v.dob} onChange={set("dob")} />
      <label className="fl">Training date *</label>
      <input type="date" value={v.trainDate} required onChange={set("trainDate")} />
      <label className="fl">Certified to *</label>
      <input value={v.certified} placeholder="Name printed as Certified to" onChange={set("certified")} />
      <label className="fl">Nationality</label>
      <input value={v.nat} onChange={set("nat")} />
      <label className="fl">Phone number (optional)</label>
      <input value={v.mob} inputMode="tel" onChange={set("mob")} />
      <label className="fl">Company *</label>
      {companies.length > 1 ? (
        <select value={v.company} onChange={set("company")}>
          {companies.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      ) : (
        <input value={v.company} onChange={set("company")} />
      )}
      {courses.length > 1 && (
        <>
          <label className="fl">Training course *</label>
          <div className="course-list">
            {courses.map((c) => (
              <label className="course-pick" key={c}>
                <input
                  type="checkbox"
                  checked={ticked.includes(c)}
                  onChange={(e) => setTicked(e.target.checked ? [...ticked, c] : ticked.filter((x) => x !== c))}
                />{" "}
                {c}
              </label>
            ))}
          </div>
        </>
      )}
      <button className="btn ok" style={{ marginTop: 16 }} disabled={busy} onClick={save}>
        Add to attendance
      </button>
      <div className="err" role="alert">
        {err}
      </div>
    </div>
  );
}
