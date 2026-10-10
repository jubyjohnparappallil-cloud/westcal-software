import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import type { Job } from "../types";
import { fapi } from "./api";
import { useField } from "./FieldApp";
import { formatEidLocal, ocrEmiratesCard, prepareIdPhoto } from "./ocr";
import { useDropImage } from "./useDropImage";

interface Fetched {
  name?: string;
  idOrVisaNo?: string;
  nationality?: string;
  mobileNumber?: string;
  dateOfBirth?: string;
  company?: string;
  course?: string;
  trainingDate?: string;
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
  const [scanBox, setScanBox] = useState<ReactNode>(null);
  const [showPaste, setShowPaste] = useState(false);

  const fill = (f: Fetched, paste: boolean) => {
    setFetched(f);
    setShowPaste(paste);
  };
  const pickGen = useRef(0);

  async function onIdPicked(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("Please choose an image.");
    const gen = ++pickGen.current;
    try {
      const { card, portrait, ocrCard } = await prepareIdPhoto(file);
      if (gen !== pickGen.current) return;
      setPhoto(portrait);
      setExtra(null);
      setIdCard(card);
      setMode("photo");
      setFetched({ ...BLANK });
      setScanBox(
        <div className="scanning">
          <span className="spin" aria-hidden="true"></span>
          <span role="status">Reading the card and filling the fields…</span>
        </div>,
      );
      await new Promise((r) => setTimeout(r, 40));
      if (gen !== pickGen.current) return;
      let text = "";
      try {
        text = await ocrEmiratesCard([ocrCard]);
      } catch {
        text = "";
      }
      if (gen !== pickGen.current) return;
      let f: Fetched = { ...BLANK };
      if (text.trim()) {
        try {
          f = await fapi<Fetched>("POST", `/api/training/${job.id}/id-fetch`, { ocrText: text });
        } catch {
          f = { ...BLANK };
        }
      }
      if (!f.idOrVisaNo) f.idOrVisaNo = formatEidLocal(text);
      const percent = Math.round((f.confidence || 0) * 100);
      setScanBox(
        f.name || f.idOrVisaNo ? (
          <p className="okmsg" role="status">
            Auto-filled {percent ? percent + "% of " : ""}the fields. Check them, then add to attendance.
          </p>
        ) : (
          <p className="muted" style={{ margin: "12px 0 0" }}>
            Could not read every field. Tap Fill from ID photo, or type the missing ones.
          </p>
        ),
      );
      fill(f, false);
    } catch {
      toast("Could not read that image.");
    }
  }

  const { dragging, dropProps } = useDropImage((file) => onIdPicked(file));

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
    fill({ ...BLANK }, false);
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
            <label className="btn sec" style={{ marginTop: 10 }} htmlFor="idfile2">
              Replace from gallery
            </label>
            <input
              id="idfile2"
              className="sr-only"
              type="file"
              accept="image/*"
              onChange={(e) => onIdPicked(e.target.files?.[0])}
            />
            <label className="btn ghost" style={{ marginTop: 8 }} htmlFor="idfile">
              Replace ID (camera)
            </label>
            <input
              id="idfile"
              className="sr-only"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => onIdPicked(e.target.files?.[0])}
            />
            <button
              type="button"
              className="btn ghost"
              style={{ marginTop: 8 }}
              onClick={() => {
                setIdCard(null);
                setPhoto(null);
                setExtra(null);
                setFetched(null);
                setScanBox(null);
              }}
            >
              Delete photos
            </button>
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
        job={job}
        fetched={fetched || {}}
        showPaste={showPaste}
        onPasted={(f) => fill(f, false)}
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
    name: "",
    id: "",
    dob: "",
    trainDate: job.trainingDate || "",
    certified: (job.certificateUnder || job.customerName || "").trim(),
    nat: "",
    mob: "",
    company: f.company || job.customerName || "",
  });
  const [ticked, setTicked] = useState<string[]>(f.course ? [f.course] : []);
  const [paste, setPaste] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  function applyCard(next: Fetched) {
    const write = () =>
      setV((prev) => ({
        ...prev,
        name: next.name || prev.name,
        id: next.idOrVisaNo || prev.id,
        dob: next.dateOfBirth || prev.dob,
        nat: next.nationality || prev.nat,
        mob: next.mobileNumber || prev.mob,
        company: next.company || prev.company,
        trainDate: next.trainingDate || prev.trainDate,
      }));
    write();
    window.setTimeout(write, 80);
    window.setTimeout(write, 400);
    if (next.course && courses.includes(next.course)) {
      setTicked((cur) => (cur.includes(next.course!) ? cur : [...cur, next.course!]));
    }
  }

  useEffect(() => {
    if (f.name || f.idOrVisaNo || f.nationality || f.dateOfBirth || f.company || f.trainingDate) applyCard(f);
  }, [f.name, f.idOrVisaNo, f.nationality, f.dateOfBirth, f.mobileNumber, f.company, f.trainingDate, f.course]);

  const set = (k: keyof typeof v) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV({ ...v, [k]: e.target.value });

  async function fillFromId() {
    setErr("");
    setBusy(true);
    try {
      let text = paste.trim();
      if (!text) {
        const pics = [images.idCard, images.extra].filter((x): x is string => !!x);
        if (!pics.length) {
          setErr("Upload the Emirates ID first, then tap Fill from ID photo.");
          return;
        }
        toast("Reading the card…");
        text = await ocrEmiratesCard(pics);
      }
      if (!text.trim()) {
        setErr("Could not read the card. Type the name and ID, or paste the card text.");
        return;
      }
      const got = await fapi<Fetched>("POST", `/api/training/${job.id}/id-fetch`, { ocrText: text });
      if (!got.idOrVisaNo) got.idOrVisaNo = formatEidLocal(text);
      applyCard(got);
      props.onPasted(got);
      toast(
        got.name || got.idOrVisaNo
          ? "Filled from the ID. Check the name and number, then add to attendance."
          : "Read the card but some fields are missing. Type them below.",
      );
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setErr("");
    const mob = v.mob.replace(/[\s\-+]/g, "");
    if (!v.name.trim()) return setErr("Name is required.");
    const picked = (courses.length > 1 ? ticked : [courses[0] || job.course || ""])
      .map((s) => s.trim())
      .filter((s) => s && (!courses.length || courses.includes(s)));
    if (courses.length > 1 && !picked.length) return setErr("Tick at least one training course.");
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
    <form autoComplete="off" onSubmit={(e) => e.preventDefault()}>
      {images.idCard && (
        <button className="btn" style={{ marginTop: 12 }} disabled={busy} type="button" onClick={fillFromId}>
          Fill fields from this photo
        </button>
      )}
      <p className="mini" style={{ margin: "8px 0 0" }}>
        If name or ID is empty, tap Fill fields from this photo.
      </p>
      {props.showPaste && (
        <>
          <label className="fl" htmlFor="ocr">
            Or paste card text
          </label>
          <textarea
            id="ocr"
            name="wc-paste"
            autoComplete="off"
            value={paste}
            placeholder={"Name: HAROON UR RASHEED\nID Number: 784-1990-1234567-1"}
            onChange={(e) => setPaste(e.target.value)}
          />
          <button className="btn sec" style={{ marginTop: 10 }} type="button" disabled={busy} onClick={fillFromId}>
            Fill from text
          </button>
        </>
      )}
      <label className="fl">Full name *</label>
      <input
        name="wc-attendee-fullname"
        value={v.name}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        readOnly
        onFocus={(e) => e.currentTarget.removeAttribute("readonly")}
        onChange={set("name")}
      />
      <label className="fl">Emirates ID / Visa no</label>
      <input
        name="wc-attendee-eid"
        value={v.id}
        autoComplete="off"
        readOnly
        onFocus={(e) => e.currentTarget.removeAttribute("readonly")}
        onChange={set("id")}
      />
      <label className="fl">Date of birth</label>
      <input type="date" name="wc-attendee-dob" value={v.dob} autoComplete="off" onChange={set("dob")} />
      <label className="fl">Training date *</label>
      <input type="date" value={v.trainDate} required onChange={set("trainDate")} />
      <label className="fl">Certified to *</label>
      <input value={v.certified} placeholder="Name printed as Certified to" autoComplete="off" onChange={set("certified")} />
      <label className="fl">Nationality</label>
      <input
        name="wc-attendee-nat"
        value={v.nat}
        autoComplete="off"
        readOnly
        onFocus={(e) => e.currentTarget.removeAttribute("readonly")}
        onChange={set("nat")}
      />
      <label className="fl">Phone number (optional)</label>
      <input value={v.mob} inputMode="tel" autoComplete="off" onChange={set("mob")} />
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
      <button className="btn ok" style={{ marginTop: 16 }} type="button" disabled={busy} onClick={save}>
        Add to attendance
      </button>
      <div className="err" role="alert">
        {err}
      </div>
    </form>
  );
}
