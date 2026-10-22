import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import type { Job } from "../types";
import { fapi } from "./api";
import { useField } from "./FieldApp";
import { dateFromCardText, employerFromCardText, enhanceCard, fieldsFromCardText, nationalityFromCardText, ocrEmiratesCard, ocrSelection, shrinkImage } from "./ocr";
import { IdKindChoice } from "../components/IdKindChoice";
import { IdWorkbench } from "../components/IdWorkbench";
import { useDropImage } from "./useDropImage";

interface Fetched {
  name?: string;
  idOrVisaNo?: string;
  nationality?: string;
  mobileNumber?: string;
  dateOfBirth?: string;
  company?: string;
  employer?: string;
  course?: string;
  trainingDate?: string;
  confidence?: number;
}
const BLANK: Fetched = { name: "", idOrVisaNo: "", nationality: "", mobileNumber: "", dateOfBirth: "", confidence: 0 };

export function Capture({
  job,
  onSaved,
  readEmployer = false,
  startFiles = [],
  onBulkFiles,
}: {
  job: Job;
  onSaved: () => void;
  readEmployer?: boolean;
  /** Photos kept after a person is added, so the next card in a bulk upload can be cropped. */
  startFiles?: File[];
  onBulkFiles?: (files: File[]) => void;
}) {
  const { toast } = useField();
  const [mode, setMode] = useState<"photo" | "sample" | "manual">("photo");
  const [idCard, setIdCard] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [extra, setExtra] = useState<string | null>(null);
  const [sharp, setSharp] = useState<string | null>(null);
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [scanBox, setScanBox] = useState<ReactNode>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [files, setFiles] = useState<File[]>(startFiles);
  const [fileIndex, setFileIndex] = useState(0);
  const [benchKey, setBenchKey] = useState(0);
  const [savedFront, setSavedFront] = useState<File | null>(null);
  const [savedBack, setSavedBack] = useState<File | null>(null);
  const sourceRef = useRef<File | null>(startFiles[0] ?? null);
  const photoLock = useRef(false);
  const [reading, setReading] = useState(false);

  const fill = (f: Fetched, paste: boolean) => {
    setFetched(f);
    setShowPaste(paste);
  };
  const pickGen = useRef(0);

  function openFiles(list: FileList | File[] | null | undefined) {
    const next = Array.from(list || []).filter((f) => f.type.startsWith("image/"));
    if (!next.length) return toast("Please choose a photo of the ID cards.");
    setFiles(next);
    setFileIndex(0);
    setBenchKey((k) => k + 1);
    sourceRef.current = next[0];
    onBulkFiles?.(next);
    setMode("photo");
    setIdCard(null);
    setPhoto(null);
    setSharp(null);
    setSavedFront(null);
    setSavedBack(null);
    setFetched({ ...BLANK });
    photoLock.current = false;
    setScanBox(null);
  }

  /** New sheet photo only — keep Front / Back cuts and filled name fields. */
  function replaceSheet(list: FileList | File[] | null | undefined) {
    const next = Array.from(list || []).filter((f) => f.type.startsWith("image/"));
    if (!next.length) return toast("Please choose a photo of the ID cards.");
    setFiles(next);
    setFileIndex(0);
    setBenchKey((k) => k + 1);
    sourceRef.current = next[0];
    onBulkFiles?.(next);
    setMode("photo");
    setScanBox(
      <p className="okmsg" role="status">
        New photo loaded. Front and Back cuts were kept — crop the other side if needed.
      </p>,
    );
    toast("New photo loaded. Front / Back cuts kept.");
  }

  function differentCard() {
    setIdCard(null);
    setPhoto(null);
    setExtra(null);
    setSharp(null);
    setSavedFront(null);
    setSavedBack(null);
    setFetched({ ...BLANK });
    fill({ ...BLANK }, false);
    photoLock.current = false;
    setBenchKey((k) => k + 1);
    if (files.length > 1) {
      setFileIndex((i) => {
        const next = (i + 1) % files.length;
        sourceRef.current = files[next] ?? null;
        return next;
      });
    }
    setScanBox(
      <p className="muted" style={{ margin: "12px 0 0" }}>
        Move the blue box onto the next card, then extract it.
      </p>,
    );
    toast(files.length > 1 ? "Next photo. Crop that card and extract it." : "Move the box onto the next card, then extract it.");
  }

  async function readLens(cropped: File) {
    sourceRef.current = files[fileIndex] ?? sourceRef.current;
    const gen = ++pickGen.current;
    setReading(true);
    setScanBox(
      <div className="scanning">
        <span className="spin" aria-hidden="true"></span>
        <span role="status">Enhancing the selected writing and reading it…</span>
      </div>,
    );
    try {
      const stored = await shrinkImage(cropped, 2200, 0.95);
      if (gen !== pickGen.current) return;
      setMode("photo");
      let text = "";
      try {
        text = await ocrSelection(stored);
      } catch {
        text = "";
      }
      if (!fieldsFromCardText(text).name && !fieldsFromCardText(text).id) {
        try {
          const clear = await enhanceCard(stored);
          const more = await ocrSelection(clear);
          text = [text, more].filter(Boolean).join("\n");
        } catch {
          /* the first read stands */
        }
      }
      if (gen !== pickGen.current) return;
      const local = fieldsFromCardText(text);
      const dob = dateFromCardText(text);
      const nationality = nationalityFromCardText(text);
      const letters = (text.match(/[A-Za-z]/g) || []).length;
      const digits = (text.match(/\d/g) || []).length;
      const name = local.name;
      const id = local.id;
      setFetched((cur) => {
        const base = { ...BLANK, ...(cur || {}) };
        return {
          ...base,
          name: name || (letters >= 8 ? "" : base.name || ""),
          idOrVisaNo: id || (digits >= 8 ? "" : base.idOrVisaNo || ""),
          ...(dob ? { dateOfBirth: dob } : {}),
          ...(nationality ? { nationality } : {}),
        };
      });
      setScanBox(
        name || id ? (
          <p className="okmsg" role="status">
            {name && id
              ? "Read the name after Name and the ID number. Check both before you add."
              : name
                ? "Read the name. Click the lens on the ID number if that box is empty."
                : "Read the ID number. The name line was not clear, so the name was left empty."}
          </p>
        ) : (
          <p className="muted" style={{ margin: "12px 0 0" }}>
            The letters in the lens were not sharp enough. The name and ID were left empty so a wrong name is not saved. Zoom in and click the lens on the line after Name.
          </p>
        ),
      );
    } catch {
      toast("Could not read that area.");
    } finally {
      if (gen === pickGen.current) setReading(false);
    }
  }

  async function readBackCard(cropped: File) {
    const gen = ++pickGen.current;
    setReading(true);
    setScanBox(
      <div className="scanning">
        <span className="spin" aria-hidden="true"></span>
        <span role="status">Reading the back of the ID…</span>
      </div>,
    );
    try {
      const stored = await shrinkImage(cropped, 2200, 0.95);
      if (gen !== pickGen.current) return;
      let text = "";
      try {
        text = await ocrSelection(stored);
      } catch {
        text = "";
      }
      let employer = employerFromCardText(text);
      if (!employer) {
        try {
          const clear = await enhanceCard(stored);
          const more = await ocrSelection(clear);
          text = [text, more].filter(Boolean).join("\n");
          employer = employerFromCardText(text);
        } catch {
          /* the first read stands */
        }
      }
      if (!employer && text.trim()) {
        try {
          const server = await fapi<Fetched>("POST", `/api/training/${job.id}/id-fetch`, { ocrText: text });
          employer = (server.employer || "").trim();
        } catch {
          employer = "";
        }
      }
      if (gen !== pickGen.current) return;
      if (employer) {
        setFetched((cur) => ({ ...BLANK, ...(cur || {}), company: employer, employer }));
      }
      setScanBox(
        employer ? (
          <p className="okmsg" role="status">
            Read the employer from the back: {employer}. Check it before you add.
          </p>
        ) : (
          <p className="muted" style={{ margin: "12px 0 0" }}>
            The Employer line on the back was not clear. Zoom in and press Read back again, or type the company.
          </p>
        ),
      );
    } catch {
      toast("Could not read the back of that ID.");
    } finally {
      if (gen === pickGen.current) setReading(false);
    }
  }

  async function keepCard(cropped: File) {
    try {
      setIdCard(await shrinkImage(cropped, 1800));
    } catch {
      toast("Could not crop that card.");
    }
  }

  async function keepPhoto(cropped: File) {
    try {
      photoLock.current = true;
      setPhoto(await shrinkImage(cropped, 900));
      toast("Photo cropped.");
    } catch {
      toast("Could not crop that photo.");
    }
  }

  const scanFile = files[fileIndex] ?? null;
  const { dragging, dropProps } = useDropImage((file) => openFiles([file]));

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
      {mode === "photo" && (
        <>
          {files.length > 1 && (
            <div className="id-bulk-switch">
              {files.map((f, i) => (
                <button
                  key={f.name + i}
                  type="button"
                  className={i === fileIndex ? "on" : ""}
                  onClick={() => {
                    setFileIndex(i);
                    sourceRef.current = files[i];
                    setBenchKey((k) => k + 1);
                  }}
                >
                  Photo {i + 1}
                </button>
              ))}
            </div>
          )}
          {scanFile && (
            <IdWorkbench
              key={benchKey + ":" + fileIndex + ":" + scanFile.name + ":" + scanFile.size}
              file={scanFile}
              read={fetched}
              busy={reading}
              onCard={(cropped) => void keepCard(cropped)}
              onPhoto={(cropped) => void keepPhoto(cropped)}
              onRead={(cropped) => readLens(cropped)}
              onReadBack={(cropped) => readBackCard(cropped)}
              onEdit={(patch) => setFetched((cur) => ({ ...(cur || BLANK), ...patch }))}
              savedFront={savedFront}
              savedBack={savedBack}
              onSavedFront={setSavedFront}
              onSavedBack={setSavedBack}
              onClearCard={() => {
                setIdCard(null);
                setPhoto(null);
                setSavedFront(null);
                photoLock.current = false;
              }}
              onReplace={(list) => replaceSheet(list)}
              onRemovePhoto={() => {
                setFiles([]);
                setFileIndex(0);
                sourceRef.current = null;
                onBulkFiles?.([]);
                setIdCard(null);
                setPhoto(null);
                setExtra(null);
                setSharp(null);
                setSavedFront(null);
                setSavedBack(null);
                setFetched(null);
                setScanBox(null);
                photoLock.current = false;
                setBenchKey((k) => k + 1);
              }}
            />
          )}
          {scanFile && (
            <button type="button" className="btn sec" style={{ marginTop: 8 }} onClick={differentCard}>
              Next card
            </button>
          )}
        </>
      )}
      {mode === "photo" &&
        (idCard && !scanFile ? (
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
              Upload again
            </label>
            <input
              id="idfile2"
              className="sr-only"
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                openFiles(e.target.files);
                e.target.value = "";
              }}
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
              onChange={(e) => {
                openFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="btn ghost"
              style={{ marginTop: 8 }}
              onClick={() => {
                setFiles([]);
                setFileIndex(0);
                onBulkFiles?.([]);
                setIdCard(null);
                setPhoto(null);
                setExtra(null);
                setSharp(null);
                setSavedFront(null);
                setSavedBack(null);
                setFetched(null);
                setScanBox(null);
              }}
            >
              Delete photos
            </button>
          </>
        ) : !scanFile ? (
          <>
            <div className={"capture" + (dragging ? " dragover" : "")} {...dropProps}>
              <span className="big" aria-hidden="true">
                📷
              </span>
              <p style={{ margin: "0 0 12px" }}>
                <b>Upload Emirates ID</b>
              </p>
              <p className="drop-hint">Upload the ID photo. Drag the blue box onto one card, crop it, crop the face, then extract the name and ID.</p>
              <label className="btn" style={{ marginTop: 8 }} htmlFor="idfile">
                Open camera
              </label>
              <input
                id="idfile"
                className="sr-only"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  openFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <label className="btn sec" style={{ marginTop: 10 }} htmlFor="idfile2">
                Choose photos
              </label>
              <input
                id="idfile2"
                className="sr-only"
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  openFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            <button className="btn ghost" style={{ marginTop: 8 }} onClick={useSample}>
              Try sample ID
            </button>
            <button className="btn ghost" onClick={manualEntry}>
              Type details without ID
            </button>
          </>
        ) : null)}
      <div>{scanBox}</div>
      <TraineeFields
        job={job}
        fetched={fetched || {}}
        showPaste={showPaste}
        onPasted={(f) => fill(f, false)}
        images={{ idCard, photo, extra, sharp }}
        onSaved={onSaved}
        readEmployer={readEmployer}
      />
    </>
  );
}

function TraineeFields(props: {
  job: Job;
  fetched: Fetched;
  showPaste: boolean;
  onPasted: (f: Fetched) => void;
  images: { idCard: string | null; photo: string | null; extra: string | null; sharp?: string | null };
  onSaved: () => void;
  readEmployer?: boolean;
}) {
  const { job, fetched: f, images } = props;
  const { toast } = useField();
  const courses = String(job.course || "")
    .split(" · ")
    .map((s) => s.trim())
    .filter(Boolean);
  const [v, setV] = useState({
    name: "",
    id: "",
    idKind: "eid" as "eid" | "passport",
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
        name: next.name ?? prev.name,
        id: next.idOrVisaNo ?? prev.id,
        idKind: next.idOrVisaNo ? "eid" : prev.idKind,
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
    if (f) applyCard(f);
  }, [f]);

  const set = (k: keyof typeof v) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV({ ...v, [k]: e.target.value });

  async function fillFromId() {
    setErr("");
    setBusy(true);
    try {
      let text = paste.trim();
      if (!text) {
        const pics = [images.sharp, images.idCard, images.extra].filter((x): x is string => !!x);
        if (!pics.length) {
          setErr("Upload the Emirates ID first, then tap Fill from ID photo.");
          return;
        }
        toast("Reading the zoomed card…");
        text = await ocrEmiratesCard(images.sharp ? [images.sharp] : pics);
      }
      if (!text.trim()) {
        setErr("Could not read the card. Type the name and ID, or paste the card text.");
        return;
      }
      const got = await fapi<Fetched>("POST", `/api/training/${job.id}/id-fetch`, { ocrText: text });
      const local = fieldsFromCardText(text);
      got.name = local.name;
      got.idOrVisaNo = local.id;
      if (!got.dateOfBirth) got.dateOfBirth = dateFromCardText(text);
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
        idDocument: v.idKind,
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
      <IdKindChoice kind={v.idKind} onChange={(idKind) => setV({ ...v, idKind })} />
      <label className="fl">{v.idKind === "passport" ? "Passport No" : "Emirates ID / Visa no"}</label>
      <input
        name="wc-attendee-eid"
        value={v.id}
        autoComplete="off"
        placeholder={v.idKind === "passport" ? "Passport number" : "784-...."}
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
      <label className="fl">{props.readEmployer ? "Employed by *" : "Company *"}</label>
      <input
        value={v.company}
        placeholder={props.readEmployer ? "Filled from the ID back" : "Employer of this trainee"}
        onChange={set("company")}
      />
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
