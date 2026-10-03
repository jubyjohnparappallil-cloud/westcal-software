import { useState } from "react";
import { Modal } from "./Modal";
import { api } from "../api";
import type { Job } from "../types";

interface InvoiceModalProps {
  job: Job;
  onClose: () => void;
  onSuccess: () => void;
}

export function InvoiceModal({ job, onClose, onSuccess }: InvoiceModalProps) {
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setError("");
    if (!invoiceNumber.trim()) {
      setError("Invoice number is required");
      return;
    }

    setBusy(true);
    try {
      await api("POST", `/api/training/${job.id}/invoice`, { invoiceNumber: invoiceNumber.trim() });
      onSuccess();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Mark job as invoiced" subtitle={`${job.jobNo} \u00b7 ${job.customerName}`} onClose={onClose}>
      <div className="job-form">
        <p className="hint">
          Type the invoice number from your accounts system. Saving it changes the job to Closed.
        </p>
        
        <div className="grid">
          <div>
            <label>Invoice number *</label>
            <input
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="Enter invoice number"
              autoFocus
            />
          </div>
        </div>

        <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
          <button className="btn ok" onClick={handleSubmit} disabled={busy}>
            {busy ? "Saving..." : "Save & close job"}
          </button>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
        </div>

        {error && <div className="err" style={{ marginTop: 10 }}>{error}</div>}
      </div>
    </Modal>
  );
}