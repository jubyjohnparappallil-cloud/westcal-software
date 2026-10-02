import { useState } from "react";
import { api } from "../api";
import { usePageData } from "../app-context";
import { Modal } from "./Modal";
import { PageLoading } from "./PageLoading";
import type { Job } from "../types";

interface Design {
  id: string;
  name: string;
  preview: string;
}

/** Asks for a reason and sends the job back to the trainer. Returns true when done. */
export async function rejectJob(jobId: string): Promise<boolean> {
  const reason = prompt("Reason to return this job?");
  if (reason == null) return false;
  try {
    await api("POST", `/api/training/${jobId}/reject`, { reason: reason || "" });
    return true;
  } catch (e) {
    alert((e as Error).message);
    return false;
  }
}

export function IssueModal({ job, onClose, onIssued, onRejected }: { job: Job; onClose: () => void; onIssued: () => void; onRejected: () => void }) {
  const { loading, data } = usePageData(() => api<Design[]>("GET", "/api/certificate-designs").catch(() => [] as Design[]));
  const [design, setDesign] = useState(job.certificateDesign || "achievement");
  const [err, setErr] = useState("");
  const people = job.attendees?.length
    ? job.attendees.map((a) => a.name).join(", ")
    : ((job.lineItems || []) as { description: string }[]).map((l) => l.description).join(", ");

  async function issue() {
    setErr("");
    try {
      await api("POST", `/api/training/${job.id}/approve`, { design });
      onIssued();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <Modal title="Issue certificates" subtitle={`${job.jobNo} · ${job.customerName || ""}`} onClose={onClose}>
      <div className="job-form">
        <p>
          <b>People:</b> {people || "-"}
        </p>
        <p>
          <b>Course:</b> {job.course || "-"} · <b>Date:</b> {job.trainingDate || "-"}
        </p>
        <label>Certificate design</label>
        {loading || !data ? (
          <PageLoading />
        ) : (
          <div className="cert-pick">
            {data.length ? (
              data.map((d) => (
                <label key={d.id} className={design === d.id ? "on" : ""}>
                  <img src={d.preview} alt={d.name} />
                  <input type="radio" name="cert_design" checked={design === d.id} onChange={() => setDesign(d.id)} />
                  {d.name}
                </label>
              ))
            ) : (
              <span className="muted">Westcal Achievement</span>
            )}
          </div>
        )}
        <button className="btn ok wide" onClick={issue}>
          Issue now
        </button>
        <button
          className="btn warn"
          style={{ marginTop: 8 }}
          onClick={async () => {
            if (await rejectJob(job.id)) onRejected();
          }}
        >
          Return to trainer
        </button>
        <div className="err">{err}</div>
      </div>
    </Modal>
  );
}
