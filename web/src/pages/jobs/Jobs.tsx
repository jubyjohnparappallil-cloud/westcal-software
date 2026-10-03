import { useState } from "react";
import { api } from "../../api";
import { useApp, usePageData } from "../../app-context";
import { InvoiceModal } from "../../components/InvoiceModal";
import { PageLoading } from "../../components/PageLoading";
import { Pagination, usePaged } from "../../components/Pagination";
import { downloads } from "../../lib/downloads";
import { jobCompanyNames, jobDateRange, jobExpiryDate, jobInDateRange, newestFirst, statusClass } from "../../lib/jobs";
import type { Job } from "../../types";
import { TrainingTabs } from "../Courses";
import { CancelJobModal } from "./CancelJobModal";
import { JobDetail } from "./JobDetail";
import { JobFormModal } from "./JobFormModal";

const STAT_FILTERS = [
  { id: "all", label: "Total jobs", cls: "a" },
  { id: "open", label: "In progress", cls: "d" },
  { id: "submitted", label: "Submitted", cls: "b" },
  { id: "issued", label: "Issued – waiting for invoice", cls: "c" },
  { id: "closed", label: "Closed (invoiced)", cls: "c" },
  { id: "cancelled", label: "Cancelled", cls: "e" },
];

function matchesStat(j: Job, stat: string): boolean {
  if (stat === "all") return true;
  if (stat === "submitted") return j.status === "Submitted";
  if (stat === "issued") return j.status === "Issued" || j.status === "Approved";
  if (stat === "closed") return j.status === "Closed";
  if (stat === "cancelled") return j.status === "Cancelled";
  return ["Created", "Assigned", "In Progress", "Rejected"].includes(j.status);
}

export function Jobs() {
  const { nav, perms } = useApp();
  const service = nav.jobService;
  const { loading, data, reload } = usePageData(() => api<Job[]>("GET", "/api/training"));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [time, setTime] = useState("");
  const [openId, setOpenId] = useState(nav.jobId);
  const [form, setForm] = useState<{ editId?: string } | null>(null);
  const [cancelling, setCancelling] = useState<Job | null>(null);
  const [invoicing, setInvoicing] = useState<Job | null>(null);
  const [stat, setStat] = useState("all");
  const all = newestFirst((data ?? []).filter((j) => (j.serviceType || "Training") === service));
  const dated = all.filter((j) => jobInDateRange(j, from, to) && (!time || (j.trainingTime || "").startsWith(time)));
  const shown = dated.filter((j) => matchesStat(j, stat));
  const paged = usePaged(shown, from + "|" + to + "|" + time + "|" + stat);
  if (loading || !data) return <PageLoading />;

  const canCreate = perms.canCreateService(service);
  const canDelete = perms.canDeleteJob();
  const canEdit = perms.canEditJob();
  const canCancel = perms.canCancelJob();
  const training = service === "Training";
  const openForm = (editId?: string) => setForm({ editId });

  async function remove(j: Job) {
    if (!confirm(`Delete job ${j.jobNo}? This cannot be undone.`)) return;
    try {
      await api("DELETE", `/api/training/${j.id}`);
      if (openId === j.id) setOpenId("");
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <>
      <TrainingTabs />
      <div className="stats stats-6">
        {STAT_FILTERS.map((s) => (
          <button
            key={s.id}
            className={`stat ${s.cls}${!openId && stat === s.id ? " on" : ""}`}
            onClick={() => {
              setStat(s.id);
              setOpenId("");
            }}
          >
            <div className="n">{dated.filter((j) => matchesStat(j, s.id)).length}</div>
            <div className="l">{s.label}</div>
          </button>
        ))}
      </div>
      {openId ? (
        <>
          <p>
            <button className="btn sec sm" onClick={() => setOpenId("")}>
              ← Back to {service} jobs
            </button>
          </p>
          <JobDetail key={openId} jobId={openId} onEdit={() => openForm(openId)} onCancel={(j) => setCancelling(j)} onChanged={reload} />
        </>
      ) : (
        <div className="card">
          <div className="toolbar">
            <div>
              <h3 style={{ margin: 0 }}>
                {service} jobs
                {stat !== "all" && ` — ${STAT_FILTERS.find((s) => s.id === stat)?.label}`} ({shown.length}
                {shown.length !== all.length ? ` of ${all.length}` : ""})
              </h3>
              <p className="hint" style={{ margin: "6px 0 0" }}>
                {canCreate ? "Click Add job — a window opens with only the fields you need." : "Open a job to view it."}
              </p>
            </div>
            {canCreate && (
              <button className="btn" onClick={() => openForm()}>
                + Add {service} job
              </button>
            )}
          </div>
          <div className="filters">
            <div>
              <label>From date</label>
              <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label>To date</label>
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div>
              <label>Time</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div style={{ alignSelf: "end" }}>
              <button
                className="btn ghost sm"
                disabled={!from && !to && !time}
                onClick={() => {
                  setFrom("");
                  setTo("");
                  setTime("");
                }}
              >
                Clear filters
              </button>
            </div>
          </div>
          {shown.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Job No</th>
                    <th>Date</th>
                    <th>Time</th>
                    {training && <th>Expiry</th>}
                    <th>Location</th>
                    <th>Scope / Course</th>
                    <th>Customer</th>
                    <th>Assigned to</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((j) => (
                    <tr key={j.id}>
                      <td>
                        <a
                          href="#"
                          className="job-link"
                          onClick={(e) => {
                            e.preventDefault();
                            setOpenId(j.id);
                          }}
                        >
                          {j.jobNo}
                        </a>
                      </td>
                      <td>{jobDateRange(j)}</td>
                      <td>{j.trainingTime || "-"}</td>
                      {training && <td>{jobExpiryDate(j) || "-"}</td>}
                      <td>{j.location || "-"}</td>
                      <td>{j.course}</td>
                      <td>{jobCompanyNames(j).join(" · ") || j.customerName}</td>
                      <td>{j.assigneeName || j.trainerName || "-"}</td>
                      <td>
                        <span className={statusClass(j.status)}>{j.status}</span>
                        {j.status === "Closed" && j.invoiceNumber && (
                          <div className="muted" style={{ marginTop: 4 }}>
                            Invoice {j.invoiceNumber}
                          </div>
                        )}
                        {j.cancelRequest && j.status !== "Cancelled" && (
                          <div style={{ marginTop: 4 }}>
                            <span className="chip e" title={j.cancelRequest.reason}>
                              Cancel requested
                            </span>
                          </div>
                        )}
                        {j.status === "Cancelled" && j.cancelledReason && (
                          <div className="muted" style={{ maxWidth: 220, marginTop: 4 }}>
                            {j.cancelledReason}
                            {j.cancelledBy ? " — " + j.cancelledBy : ""}
                          </div>
                        )}
                      </td>
                      <td className="row-actions">
                        <button className="btn sec sm" onClick={() => setOpenId(j.id)}>
                          Open
                        </button>
                        {perms.canDownload() && (
                          <button className="btn dark sm" style={{ marginLeft: 6 }} onClick={() => downloads.jobSheet(j.id, j.jobOrderNo || j.jobNo)}>
                            Job sheet
                          </button>
                        )}
                        {perms.canDownload() && (j.serviceType || "Training") === "Training" && (
                          <button className="btn dark sm" style={{ marginLeft: 6 }} onClick={() => downloads.review(j.id, j.jobOrderNo || j.jobNo)}>
                            Review form
                          </button>
                        )}
                        {(j.serviceType || "") === "Mapping" && (
                          <button className="btn sm" style={{ marginLeft: 6 }} onClick={() => downloads.mappingProtocol(j.id)}>
                            Protocol report
                          </button>
                        )}
                        {(perms.isSuper() || perms.has("Invoice:create")) && (j.status === "Issued" || j.status === "Approved") && (
                          <button className="btn ok sm" style={{ marginLeft: 6 }} onClick={() => setInvoicing(j)}>
                            Invoiced
                          </button>
                        )}
                        {canEdit && j.status !== "Cancelled" && perms.canChangeJob(j.status) && (
                          <button className="btn sm" style={{ marginLeft: 6 }} onClick={() => openForm(j.id)}>
                            Edit
                          </button>
                        )}
                        {canDelete && j.status !== "Approved" && (
                          <button className="btn ghost sm" style={{ marginLeft: 6 }} onClick={() => remove(j)}>
                            Delete
                          </button>
                        )}
                        {canCancel && !j.cancelRequest && ["Created", "Assigned"].includes(j.status) && (
                          <button className="btn warn sm" style={{ marginLeft: 6 }} onClick={() => setCancelling(j)}>
                            {perms.isSuper() ? "Cancel" : "Request cancel"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination {...paged} />
            </div>
          ) : (
            <p className="muted">
              {all.length ? "No jobs match these filters." : `No ${service.toLowerCase()} jobs yet. ${canCreate ? "Click Add job to create one." : ""}`}
            </p>
          )}
        </div>
      )}
      {form && (
        <JobFormModal
          service={service}
          editId={form.editId}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            reload();
          }}
        />
      )}
      {invoicing && (
        <InvoiceModal
          job={invoicing}
          onClose={() => setInvoicing(null)}
          onSuccess={() => {
            setInvoicing(null);
            reload();
          }}
        />
      )}
      {cancelling && (
        <CancelJobModal
          job={cancelling}
          onClose={() => setCancelling(null)}
          onCancelled={() => {
            setOpenId(cancelling.id);
            setCancelling(null);
            reload();
          }}
        />
      )}
    </>
  );
}
