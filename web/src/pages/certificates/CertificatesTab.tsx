import { Fragment, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { useApp } from "../../app-context";
import { CertificatePreview } from "../../components/CertificatePreview";
import { IdKindChoice } from "../../components/IdKindChoice";
import { Modal } from "../../components/Modal";
import { Pagination, usePaged } from "../../components/Pagination";
import { usePhotoCrop } from "../../components/PhotoCropper";
import { shrinkImage } from "../../field/ocr";
import { downloads, type FieldFit, type FieldFits } from "../../lib/downloads";
import { coursesForPerson, jobCourses } from "../../lib/jobs";
import type { Certificate, Job } from "../../types";

function asFit(value: unknown): FieldFit {
  return value === "shrink" ? "shrink" : "same";
}

const SHRINK_FIELDS: Array<{ key: keyof FieldFits; label: string }> = [
  { key: "name", label: "Name" },
  { key: "company", label: "Company" },
  { key: "course", label: "Course" },
];

function shrinkLabel(prefix: string, fits: FieldFits): string {
  const on = SHRINK_FIELDS.filter((item) => fits[item.key] === "shrink").map((item) => item.label);
  return on.length ? `${prefix}: ${on.join(", ")}` : `${prefix}: none`;
}

function ShrinkPick({
  prefix,
  fits,
  onToggle,
}: {
  prefix: string;
  fits: FieldFits;
  onToggle: (field: keyof FieldFits) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const box = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const active = fits.name === "shrink" || fits.company === "shrink" || fits.course === "shrink";
  function place() {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const width = 188;
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    setPos({ top: r.bottom + 4, left });
  }
  useEffect(() => {
    if (!open) return;
    place();
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onMove = () => place();
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);
  return (
    <span className="shrink-pick" ref={box}>
      <button
        type="button"
        ref={btn}
        className={"btn sm " + (active ? "dark" : "sec")}
        onClick={() => setOpen((value) => !value)}
      >
        {shrinkLabel(prefix, fits)} ▾
      </button>
      {open && (
        <div className="shrink-pick-menu" style={{ top: pos.top, left: pos.left }}>
          {SHRINK_FIELDS.map((item) => (
            <label key={item.key}>
              <input
                type="checkbox"
                checked={fits[item.key] === "shrink"}
                onChange={() => onToggle(item.key)}
              />
              {item.label}
            </label>
          ))}
        </div>
      )}
    </span>
  );
}

function CertDownloads({ j, c, compact, onChanged }: { j: Job; c: Certificate; compact?: boolean; onChanged: () => void }) {
  const { perms } = useApp();
  const no = c.certificateNo;
  const [fitPick, setFitPick] = useState<Partial<FieldFits>>({});
  const [specialPick, setSpecialPick] = useState<Partial<FieldFits>>({});
  const fits: FieldFits = {
    name: fitPick.name ?? asFit(j.nameFit),
    company: fitPick.company ?? asFit(j.companyFit),
    course: fitPick.course ?? asFit(j.courseFit),
  };
  const specialFits: FieldFits = {
    name: specialPick.name ?? asFit(j.specialNameFit ?? j.nameFit),
    company: specialPick.company ?? asFit(j.specialCompanyFit ?? j.companyFit),
    course: specialPick.course ?? asFit(j.specialCourseFit ?? j.courseFit),
  };
  const signature = j.certificateSignature === "2" || j.certificateSignature === "3" ? j.certificateSignature : "1";
  const signSize = j.certificateSignatureSize === "normal" ? "normal" : "medium";
  const qrPosition = j.qrPosition === "left" ? "left" : "right";
  async function toggleFit(field: keyof FieldFits) {
    const next: FieldFit = fits[field] === "shrink" ? "same" : "shrink";
    setFitPick({ ...fits, [field]: next });
    const key = field === "name" ? "nameFit" : field === "course" ? "courseFit" : "companyFit";
    await api("PATCH", `/api/training/${j.id}`, { [key]: next });
    onChanged();
  }
  async function toggleSpecialFit(field: keyof FieldFits) {
    const next: FieldFit = specialFits[field] === "shrink" ? "same" : "shrink";
    setSpecialPick({ ...specialFits, [field]: next });
    const key = field === "name" ? "specialNameFit" : field === "course" ? "specialCourseFit" : "specialCompanyFit";
    await api("PATCH", `/api/training/${j.id}`, { [key]: next });
    onChanged();
  }
  async function setSignature(next: "1" | "2" | "3") {
    if (next === signature) return;
    await api("PATCH", `/api/training/${j.id}`, { certificateSignature: next });
    onChanged();
  }
  async function setSignSize(next: "normal" | "medium") {
    if (next === signSize) return;
    await api("PATCH", `/api/training/${j.id}`, { certificateSignatureSize: next });
    onChanged();
  }
  async function setQrPosition(next: "right" | "left") {
    if (next === qrPosition) return;
    await api("PATCH", `/api/training/${j.id}`, { qrPosition: next });
    onChanged();
  }
  return (
    <>
      <button className="btn dark sm" onClick={() => downloads.certificate(j.id, c.id, no, fits)}>
        Download
      </button>
      <button className="btn sec sm" onClick={() => downloads.certificateNoPhoto(j.id, c.id, no, fits)}>
        Without photo
      </button>
      <button className="btn sec sm" onClick={() => downloads.certificateContent(j.id, c.id, no, fits)}>
        Inside data
      </button>
      <button className="btn sec sm" onClick={() => downloads.certificateContentNoPhoto(j.id, c.id, no, fits)}>
        Inside data without photo
      </button>
      <button className="btn sec sm" onClick={() => downloads.certificateOld(j.id, c.id, no, fits)}>
        Old design data
      </button>
      <ShrinkPick prefix="Shrink" fits={fits} onToggle={(field) => void toggleFit(field)} />
      {(["1", "2", "3"] as const).map((n) => (
        <button
          key={n}
          type="button"
          className={"btn sm " + (signature === n ? "dark" : "sec")}
          title={`Authorised signature ${n}`}
          onClick={() => void setSignature(n)}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          Signature {n}
          <img src={`/certificate-signature-${n}.png?v=20261117slope`} alt="" style={{ height: n === "2" ? 36 : 20, maxWidth: n === "2" ? 120 : 64, objectFit: "contain" }} />
        </button>
      ))}
      <button
        className={"btn sm " + (signSize === "normal" ? "dark" : "sec")}
        title="Earlier smaller Signature 2 size on old + special design"
        onClick={() => void setSignSize("normal")}
      >
        Sign normal
      </button>
      <button
        className={"btn sm " + (signSize === "medium" ? "dark" : "sec")}
        title="Medium Signature 2 size on old + special design"
        onClick={() => void setSignSize("medium")}
      >
        Sign medium
      </button>
      <button
        className={"btn sm " + (qrPosition === "right" ? "dark" : "sec")}
        title="QR on the right of the details — old and new certificate"
        onClick={() => void setQrPosition("right")}
      >
        QR right
      </button>
      <button
        className={"btn sm " + (qrPosition === "left" ? "dark" : "sec")}
        title="QR on the left of the details — old and new certificate"
        onClick={() => void setQrPosition("left")}
      >
        QR left
      </button>
      {perms.canIssueCerts() && (
        <>
          <button className="btn sec sm" onClick={() => downloads.certificateSpecial(j.id, c.id, no, specialFits)}>
            Special design
          </button>
          <ShrinkPick prefix="Special shrink" fits={specialFits} onToggle={(field) => void toggleSpecialFit(field)} />
        </>
      )}
      <button className="btn sec sm" onClick={() => downloads.certificateLayout(j.id, c.id, no)}>
        Certificate design
      </button>
      <button className={"btn sm " + (compact ? "dark" : "sec")} onClick={() => downloads.card(j.id, c.id, no)}>
        ID card
      </button>
      <button className="btn sec sm" onClick={() => downloads.cardShrink(j.id, c.id, no)}>
        ID card shrink
      </button>
      <button className="btn sec sm" onClick={() => downloads.cardClassic(j.id, c.id, no)}>
        Old ID card
      </button>
      <button className="btn sec sm" onClick={() => downloads.cardClassicShrink(j.id, c.id, no)}>
        Old card shrink
      </button>
      <button className="btn sec sm" onClick={() => downloads.cardClassicPrevious(j.id, c.id, no)}>
        Previous ID card
      </button>
      <button className="btn sec sm" onClick={() => downloads.cardClassicPreviousShrink(j.id, c.id, no)}>
        Previous card shrink
      </button>
      <button className="btn sec sm" onClick={() => downloads.cardLayout(j.id, c.id, no)}>
        Card design
      </button>
    </>
  );
}

export function CertificatesTab({ job: j, onChanged }: { job: Job; onChanged: () => void }) {
  const { perms } = useApp();
  const [editing, setEditing] = useState("");
  const [viewing, setViewing] = useState<Certificate | null>(null);
  const certs: Certificate[] = j.certificates || [];
  const paged = usePaged(certs, j.id);
  const editingCert = certs.find((c) => c.id === editing) || null;

  if (!certs.length) return <p className="muted">No certificates on this job.</p>;

  return (
    <>
      <p className="hint">
        Click <b>Preview</b> to see a certificate. Use <b>Download</b> for the full certificate. For the new design, print <b>Certificate design</b> first, then <b>Inside data</b>. Use <b>Inside data without photo</b> when the photo must stay off that sheet. For the old design, download <b>Old design data</b> and print that Word file on the old certificate. Open the <b>Shrink</b> dropdown and tick <b>Name</b>, <b>Company</b> and/or <b>Course</b> — the same ticks apply to both new design Download and old design Word. <b>Special shrink</b> does the same for Special design only. ID cards have two options each: <b>ID card</b> / <b>ID card shrink</b>, <b>Old ID card</b> / <b>Old card shrink</b>, and <b>Previous ID card</b> / <b>Previous card shrink</b>. <b>QR right</b> and <b>QR left</b> place the scan code on both the old and new certificate. <b>Signature 1</b>, <b>Signature 2</b> and <b>Signature 3</b> pick which authorised signature prints on the old, new, and special certificates. For Signature 2, <b>Sign normal</b> is the earlier smaller print and <b>Sign medium</b> is the larger medium print — both change old design and special design. Choose, then download again.
        {perms.canIssueCerts() && (
          <>
            {" "}
            <b>Special design</b> is the Qannati-style Word file. It prints the employer from the ID back, the TR job number, and the same authorised signature. Use <b>Special shrink</b> beside it to tick name, company or course for that file only.
          </>
        )}
      </p>
      {editingCert && (
        <Modal title={editingCert.certificateNo} subtitle={editingCert.name} width={760} onClose={() => setEditing("")}>
          <CertificateEditor
            j={j}
            c={editingCert}
            onSaved={() => {
              setEditing("");
              onChanged();
            }}
          />
        </Modal>
      )}
      {viewing && (
        <Modal
          title={viewing.certificateNo}
          subtitle={viewing.name}
          width={560}
          onClose={() => setViewing(null)}
          actions={
            <button className="btn dark sm" onClick={() => downloads.certificate(j.id, viewing.id, viewing.certificateNo, {
              name: asFit(j.nameFit),
              company: asFit(j.companyFit),
              course: asFit(j.courseFit),
            })}>
              Download
            </button>
          }
        >
          <div className="cert-modal">
            <CertificatePreview c={viewing} j={j} />
          </div>
        </Modal>
      )}      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Certificate</th>
              <th>Name</th>
              <th>Course</th>
              <th>Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {paged.rows.map((c) => {
              const isOpen = editing === c.id;
              return (
                <Fragment key={c.id}>
                  <tr>
                    <td>
                      <b>{c.certificateNo}</b>
                    </td>
                    <td>
                      {c.name}
                      <div className="muted">{c.company || j.customerName || ""}</div>
                    </td>
                    <td className="cert-course-cell">{c.course}</td>
                    <td>{c.trainingDate}</td>
                    <td>
                      <div className="cert-downloads" style={{ justifyContent: "flex-start", margin: 0 }}>
                        {perms.canIssueCerts() && (
                          <button type="button" className="btn sm" onClick={() => setEditing(isOpen ? "" : c.id)}>
                            {isOpen ? "Close" : "Edit"}
                          </button>
                        )}
                        <button className="btn sec sm" onClick={() => setViewing(c)}>
                          Preview
                        </button>
                        {perms.canIssueCerts() && (
                          <button
                            type="button"
                            className="btn warn sm"
                            onClick={() => {
                              if (!confirm(`Delete certificate ${c.certificateNo}? This cannot be undone.`)) return;
                              void api("DELETE", `/api/training/${j.id}/certificates/${c.id}`)
                                .then(() => {
                                  if (editing === c.id) setEditing("");
                                  if (viewing?.id === c.id) setViewing(null);
                                  onChanged();
                                })
                                .catch((e) => alert((e as Error).message));
                            }}
                          >
                            Delete
                          </button>
                        )}
                        <CertDownloads j={j} c={c} compact onChanged={onChanged} />
                      </div>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination {...paged} />
    </>
  );
}

function CertificateEditor({ j, c, onSaved }: { j: Job; c: Certificate; onSaved: () => void }) {
  const attendee = (j.attendees || []).find((a) => a.id === c.attendeeId);
  const courseOptions = jobCourses(j).length ? jobCourses(j) : [String(c.course || "")].filter(Boolean);
  const [courseRows, setCourseRows] = useState(() => {
    const held = coursesForPerson(j, { name: c.name, idOrVisaNo: c.idOrVisaNo, course: c.course });
    const selected = new Set(held.length ? held : [String(c.course || "")].filter(Boolean));
    const names = [...new Set([...courseOptions, String(c.course || "")].map((name) => name.trim()).filter(Boolean))];
    return names.map((name) => ({ key: name, name, on: selected.has(name) }));
  });
  const [f, setF] = useState({
    certificateNo: c.certificateNo || "",
    name: c.name || "",
    idOrVisaNo: c.idOrVisaNo || "",
    idDocument: ((c.idDocument || attendee?.idDocument) === "passport" ? "passport" : "eid") as "eid" | "passport",
    certifiedTo: j.certificateUnder || c.company || j.customerName || "",
    trainingDate: c.trainingDate || "",
    expiresOn: c.expiresOn || "",
  });
  const [photo, setPhoto] = useState(attendee?.photoDataUrl || "");
  const [err, setErr] = useState("");
  const { crop, dialog: cropDialog } = usePhotoCrop();
  const ref = c.verificationRef ? encodeURIComponent(c.verificationRef) : "";
  const field = (k: keyof typeof f) => ({
    value: f[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value }),
  });

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setErr("");
    try {
      const cropped = await crop(file, "photo");
      if (!cropped) return;
      setPhoto(await shrinkImage(cropped, 800));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function save() {
    setErr("");
    try {
      const chosen = courseRows.filter((row) => row.on && row.name.trim());
      if (!chosen.length) return setErr("Tick the course for this certificate.");
      const current = courseRows.find((row) => row.key === c.course && row.on);
      const printed = (current?.name || chosen[0].name).trim();
      const { certifiedTo, ...rest } = f;
      const body = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, String(v).trim()]));
      await api("PATCH", `/api/training/${j.id}/certificates/${c.id}`, { ...body, course: printed });
      const nextCertified = certifiedTo.trim();
      const prevCertified = String(j.certificateUnder || c.company || j.customerName || "").trim();
      if (nextCertified !== prevCertified) {
        await api("PATCH", `/api/training/${j.id}`, { certificateUnder: nextCertified });
      }
      if (c.attendeeId) {
        const nextCourses = chosen.map((row) => row.name.trim());
        const held = coursesForPerson(j, { name: c.name, idOrVisaNo: c.idOrVisaNo, course: c.course });
        const prevCourses = held.length ? held : [String(c.course || "")].filter(Boolean);
        const coursesChanged = nextCourses.join("\n") !== prevCourses.join("\n");
        const photoChanged = photo !== (attendee?.photoDataUrl || "");
        if (coursesChanged || photoChanged) {
          await api("PATCH", `/api/training/${j.id}/attendees/${c.attendeeId}`, {
            ...(coursesChanged ? { name: String(body.name || ""), idOrVisaNo: String(body.idOrVisaNo || ""), idDocument: f.idDocument, courses: nextCourses } : {}),
            ...(photoChanged ? { photoDataUrl: photo } : {}),
          });
        }
      }
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
      {cropDialog}
      {ref && (
        <div className="qr-mini">
          <img src={`/verify/${ref}/qr.png`} alt="QR" />
          <div>Scan to verify</div>
        </div>
      )}
      <div>
        <label>Photo</label>
        <div
          style={{
            width: 92,
            height: 122,
            border: "2px solid #c9a227",
            background: "#eee",
            overflow: "hidden",
          }}
        >
          {photo ? (
            <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 22%" }} />
          ) : null}
        </div>
        <label className="btn sec sm" style={{ marginTop: 8, display: "inline-block" }}>
          Replace photo
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void onPhoto(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div className="grid">
          <div className="span-2">
            <label>Certificate No</label>
            <input {...field("certificateNo")} placeholder="WC-TR4544-01" />
            <p className="hint">WC-TR4544-01: WC is Westcal, TR4544 is the job number, 01 is this certificate. You can edit this number.</p>
          </div>
          <div className="span-2">
            <label>Name</label>
            <input {...field("name")} />
          </div>
          <div>
            <IdKindChoice kind={f.idDocument} onChange={(idDocument) => setF({ ...f, idDocument })} />
            <label>{f.idDocument === "passport" ? "Passport No" : "Emirates ID"}</label>
            <input {...field("idOrVisaNo")} />
          </div>
          <div>
            <label>Certified to</label>
            <input {...field("certifiedTo")} />
          </div>
          <div className="span-2">
            <label>Training course</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {courseRows.map((row, index) => (
                <div key={row.key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={row.on}
                    onChange={(e) => setCourseRows((rows) => rows.map((item, i) => (i === index ? { ...item, on: e.target.checked } : item)))}
                  />
                  <input
                    value={row.name}
                    aria-label="Course name"
                    onChange={(e) => setCourseRows((rows) => rows.map((item, i) => (i === index ? { ...item, name: e.target.value } : item)))}
                  />
                </div>
              ))}
            </div>
          </div>
          <div>
            <label>Training date</label>
            <input type="date" {...field("trainingDate")} />
          </div>
          <div>
            <label>Expiry</label>
            <input type="date" {...field("expiresOn")} />
          </div>
        </div>
        <p style={{ margin: "10px 0 0" }}>
          <button className="btn sm" onClick={save}>
            Save certificate
          </button>
        </p>
        <div className="err">{err}</div>
      </div>
    </div>
  );
}
