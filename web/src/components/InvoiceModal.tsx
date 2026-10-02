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
    <Modal title="Add Invoice & Close Job" subtitle={`${job.jobNo} · ${job.customerName}`} onClose={onClose}>
      <div className="job-form">
        <p className="hint">
          Adding an invoice number will close this job and mark it as completed for accounting purposes.
        </p>
        
        <div className="grid">
          <div>
            <label>Invoice Number *</label>
            <input
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="INV-2024-001"
              autoFocus
            />
          </div>
        </div>

        <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
          <button className="btn ok" onClick={handleSubmit} disabled={busy}>
            {busy ? "Processing..." : "Add Invoice & Close"}
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