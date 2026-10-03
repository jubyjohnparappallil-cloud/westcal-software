import { Fragment, useState } from "react";
import { api } from "../../api";
import { useApp } from "../../app-context";
import { CertificatePreview } from "../../components/CertificatePreview";
import { Modal } from "../../components/Modal";
import { Pagination, usePaged } from "../../components/Pagination";
import { downloads } from "../../lib/downloads";
import type { Certificate, Job } from "../../types";

function CertDownloads({ j, c, compact }: { j: Job; c: Certificate; compact?: boolean }) {
  const no = c.certificateNo;
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
      <button className={"btn sm " + (compact ? "dark" : "sec")} onClick={() => downloads.card(j.id, c.id, no)}>
        ID card
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
        Click <b>Preview</b> to see a certificate. Use <b>Download</b> for the full certificate.
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
                      <div className="muted">{c.company || j.certificateUnder || ""}</div>
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
                        <CertDownloads j={j} c={c} compact />
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
  const [f, setF] = useState({
    name: c.name || "",
    idOrVisaNo: c.idOrVisaNo || "",
    company: c.company || j.certificateUnder || j.customerName || "",
    course: c.course || "",
    trainingDate: c.trainingDate || "",
    expiresOn: c.expiresOn || "",
  });
  const [err, setErr] = useState("");
  const ref = c.verificationRef ? encodeURIComponent(c.verificationRef) : "";
  const field = (k: keyof typeof f) => ({
    value: f[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value }),
  });

  async function save() {
    setErr("");
    try {
      const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()]));
      await api("PATCH", `/api/training/${j.id}/certificates/${c.id}`, body);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
      {ref && (
        <div className="qr-mini">
          <img src={`/verify/${ref}/qr.png`} alt="QR" />
          <div>Scan to verify</div>
        </div>
      )}
      <div style={{ flex: 1, minWidth: 240 }}>
        <div className="grid">
          <div className="span-2">
            <label>Name</label>
            <input {...field("name")} />
          </div>
          <div>
            <label>Emirates ID</label>
            <input {...field("idOrVisaNo")} />
          </div>
          <div>
            <label>Company</label>
            <input {...field("company")} />
          </div>
          <div className="span-2">
            <label>Course</label>
            <input {...field("course")} />
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
