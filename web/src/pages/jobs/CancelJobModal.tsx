import { useState } from "react";
import { api } from "../../api";
import { useApp } from "../../app-context";
import { Modal } from "../../components/Modal";
import type { Job } from "../../types";

/** Super Admin cancels directly; everyone else sends a cancel request with a reason. */
export function CancelJobModal({ job, onClose, onCancelled }: { job: Job; onClose: () => void; onCancelled: () => void }) {
  const { perms } = useApp();
  const direct = perms.isSuper();
  const [reason, setReason] = useState(direct ? job.cancelRequest?.reason || "" : "");
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");
    if (!reason.trim()) {
      setErr("Enter the reason. The Super Admin needs to see why this job should be cancelled.");
      return;
    }
    try {
      await api("POST", `/api/training/${job.id}/${direct ? "cancel" : "cancel-request"}`, { reason: reason.trim() });
      if (!direct) alert("Cancel request sent. The Super Admin will approve or reject it.");
      onCancelled();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <Modal
      title={direct ? `Cancel job ${job.jobNo}` : `Request cancellation of ${job.jobNo}`}
      subtitle={
        direct
          ? "The job stays on the list as Cancelled."
          : "The job is not cancelled yet. The Super Admin will see your reason and approve or reject it."
      }
      onClose={onClose}
    >
      <div className="job-form">
        <label>Reason *</label>
        <textarea rows={4} autoFocus value={reason} placeholder="Why should this job be cancelled?" onChange={(e) => setReason(e.target.value)} />
        <button className="btn warn wide" style={{ marginTop: 14 }} onClick={submit}>
          {direct ? "Cancel job" : "Send cancel request"}
        </button>
        <div className="err">{err}</div>
      </div>
    </Modal>
  );
}
