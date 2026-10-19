import { Fragment, useState } from "react";
import { api } from "../../api";
import { useApp } from "../../app-context";
import { CertificatePreview } from "../../components/CertificatePreview";
import { IdKindChoice } from "../../components/IdKindChoice";
import { Modal } from "../../components/Modal";
import { Pagination, usePaged } from "../../components/Pagination";
import { usePhotoCrop } from "../../components/PhotoCropper";
import { shrinkImage } from "../../field/ocr";
import { downloads } from "../../lib/downloads";
import { coursesForPerson, jobCourses } from "../../lib/jobs";
import type { Certificate, Job } from "../../types";

function CertDownloads({ j, c, compact, onChanged }: { j: Job; c: Certificate; compact?: boolean; onChanged: () => void }) {
  const { perms } = useApp();
  const no = c.certificateNo;
  const fit = j.companyFit === "shrink" ? "shrink" : "same";
  const specialFit = j.specialCompanyFit === "shrink" || j.specialCompanyFit === "same" ? j.specialCompanyFit : fit;
  async function setFit(next: "same" | "shrink") {
    if (next === fit) return;
    await api("PATCH", `/api/training/${j.id}`, { companyFit: next });
    onChanged();
  }
  async function setSpecialFit(next: "same" | "shrink") {
    if (next === specialFit) return;
    await api("PATCH", `/api/training/${j.id}`, { specialCompanyFit: next });
    onChanged();
  }
  return (
    <>
      <button className="btn dark sm" onClick={() => downloads.certificate(j.id, c.id, no)}>
        Download
      </button>
      <button className="btn sec sm" onClick={() => downloads.certificateNoPhoto(j.id, c.id, no)}>
        Without photo
      </button>
      <button className="btn sec sm" onClick={() => downloads.certificateContent(j.id, c.id, no)}>
        Inside data
      </button>
      <button className="btn sec sm" onClick={() => downloads.certificateContentNoPhoto(j.id, c.id, no)}>
        Inside data without photo
      </button>
      <button className="btn sec sm" onClick={() => downloads.certificateOld(j.id, c.id, no)}>
        Old design data
      </button>
      <button className={"btn sm " + (fit === "same" ? "dark" : "sec")} onClick={() => void setFit("same")}>
        Same size
      </button>
      <button className={"btn sm " + (fit === "shrink" ? "dark" : "sec")} onClick={() => void setFit("shrink")}>
        Shrink
      </button>
      {perms.canIssueCerts() && (
        <>
          <button className="btn sec sm" onClick={() => downloads.certificateSpecial(j.id, c.id, no)}>
            Special design
          </button>
          <button className={"btn sm " + (specialFit === "same" ? "dark" : "sec")} onClick={() => void setSpecialFit("same")}>
            Same size
          </button>
          <button className={"btn sm " + (specialFit === "shrink" ? "dark" : "sec")} onClick={() => void setSpecialFit("shrink")}>
            Shrink
          </button>
        </>
      )}
      <button className="btn sec sm" onClick={() => downloads.certificateLayout(j.id, c.id, no)}>
        Certificate design
      </button>
      <button className={"btn sm " + (compact ? "dark" : "sec")} onClick={() => downloads.card(j.id, c.id, no)}>
        ID card
      </button>
      <button className="btn sec sm" onClick={() => downloads.cardClassic(j.id, c.id, no)}>
        Old ID card
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

  if (!certs.length) return <p className="muted">No certificates on this job.</p>;

  return (
    <>
      <p className="hint">
        Click <b>Preview</b> to see a certificate. Use <b>Download</b> for the full certificate. For the new design, print <b>Certificate design</b> first, then <b>Inside data</b>. Use <b>Inside data without photo</b> when the photo must stay off that sheet. For the old design, download <b>Old design data</b> and print that Word file on the old certificate. <b>Same size</b> keeps a long company name as large as the trainee name. <b>Shrink</b> makes that long name smaller. Choose one, then download again.
        {perms.canIssueCerts() && (
          <>
            {" "}
            <b>Special design</b> is the Qannati-style Word file. It prints the employer from the ID back and the TR job number. The <b>Same size</b> and <b>Shrink</b> buttons beside it change only that file.
          </>
        )}
      </p>
      {viewing && (
        <Modal
          title={viewing.certificateNo}
          subtitle={viewing.name}
          width={560}
          onClose={() => setViewing(null)}
          actions={
            <button className="btn dark sm" onClick={() => downloads.certificate(j.id, viewing.id, viewing.certificateNo)}>
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
                      <div className="muted">{j.certificateUnder || c.company || ""}</div>
                    </td>
                    <td>{c.course}</td>
                    <td>{c.trainingDate}</td>
                    <td>
                      <div className="cert-downloads" style={{ justifyContent: "flex-start", margin: 0 }}>
                        {perms.canIssueCerts() && (
                          <button className="btn sm" onClick={() => setEditing(isOpen ? "" : c.id)}>
                            {isOpen ? "Close" : "Edit"}
                          </button>
                        )}
                        <button className="btn sec sm" onClick={() => setViewing(c)}>
                          Preview
                        </button>
                        <CertDownloads j={j} c={c} compact onChanged={onChanged} />
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={5}>
                        <CertificateEditor
                          j={j}
                          c={c}
                          onSaved={() => {
                            setEditing("");
                            onChanged();
                          }}
                        />
                      </td>
                    </tr>
                  )}
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
      const body = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v.trim()]));
      await api("PATCH", `/api/training/${j.id}`, {
        certificateUnder: certifiedTo.trim(),
      });
      if (c.attendeeId) {
        await api("PATCH", `/api/training/${j.id}/attendees/${c.attendeeId}`, {
          name: String(body.name || ""),
          idOrVisaNo: String(body.idOrVisaNo || ""),
          idDocument: f.idDocument,
          courses: chosen.map((row) => row.name.trim()),
        });
      }
      await api("PATCH", `/api/training/${j.id}/certificates/${c.id}`, { ...body, course: printed });
      if (c.attendeeId && photo !== (attendee?.photoDataUrl || "")) {
        await api("PATCH", `/api/training/${j.id}/attendees/${c.attendeeId}`, { photoDataUrl: photo });
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
