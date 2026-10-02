import { useState } from "react";
import { api } from "../api";
import { useApp, usePageData } from "../app-context";
import { PageLoading } from "../components/PageLoading";
import { Paged } from "../components/Pagination";
import {
  addDaysIso,
  isoToday,
  jobCompanyNames,
  jobDateRange,
  jobExpiryDate,
  jobInReportPeriod,
  newestFirst,
  openedAt,
  statusClass,
} from "../lib/jobs";
import type { Certificate, Job } from "../types";

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function downloadCsv(jobs: Job[], period: string, date: string) {
  const header = [
    "Job No",
    "Job Order",
    "Customer",
    "Course",
    "Date from",
    "Date to",
    "Job time",
    "Opened at",
    "Location",
    "Trainer",
    "Status",
    "Invoice no",
    "Trainees",
    "Certificates",
    "Expiry date",
    "Closed",
  ];
  const rows = jobs.map((j) =>
    [
      j.jobNo,
      j.jobOrderNo || "",
      jobCompanyNames(j).join(" · ") || j.customerName,
      j.course,
      j.trainingDate || "",
      j.trainingDateTo || j.trainingDate || "",
      j.trainingTime || "",
      openedAt(j),
      j.location || "",
      j.assigneeName || j.trainerName || "",
      j.status,
      j.invoiceNumber || "",
      (j.attendees || []).length,
      (j.certificates || []).length,
      jobExpiryDate(j),
      j.status === "Closed" ? "Yes" : "No",
    ]
      .map(csvCell)
      .join(","),
  );
  const text = ["\uFEFF" + header.join(","), ...rows].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  a.download = `WESTCAL-training-${period}-${date}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

const STATUS_TABS: [string, string, (j: Job) => boolean][] = [
  ["all", "All jobs", () => true],
  ["open", "In progress", (j) => ["Created", "Assigned", "In Progress"].includes(j.status)],
  ["pending", "Submitted", (j) => j.status === "Submitted"],
  ["returned", "Returned", (j) => j.status === "Rejected"],
  ["issued", "Issued – waiting for invoice", (j) => j.status === "Issued" || j.status === "Approved"],
  ["closed", "Closed (invoiced)", (j) => j.status === "Closed"],
  ["cancelled", "Cancelled", (j) => j.status === "Cancelled"],
];

const PERIODS: [string, string][] = [
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
  ["yearly", "Yearly"],
  ["all", "All dates"],
];

export function Reports() {
  const { nav, go, perms, goToCertificates } = useApp();
  const { loading, data } = usePageData(() => api<Job[]>("GET", "/api/training"));
  const [period, setPeriod] = useState("monthly");
  const [refDate, setRefDate] = useState(isoToday());
  const status = STATUS_TABS.some(([id]) => id === nav.reportStatus) ? nav.reportStatus : "all";
  const setStatus = (id: string) => go("reports", { reportStatus: id });
  const [customer, setCustomer] = useState("");
  const [trainer, setTrainer] = useState("");
  const [search, setSearch] = useState("");
  if (loading || !data) return <PageLoading />;

  const training = newestFirst(data.filter((j) => (j.serviceType || "Training") === "Training"));
  const inStatus = (j: Job, id: string) => STATUS_TABS.find(([t]) => t === id)?.[2](j) ?? true;
  const trainerOf = (j: Job) => j.assigneeName || j.trainerName || "";
  const customers = [...new Set(training.flatMap((j) => jobCompanyNames(j).concat(j.customerName || "")).filter(Boolean))].sort();
  const trainers = [...new Set(training.map(trainerOf).filter(Boolean))].sort();
  const q = search.trim().toLowerCase();
  const filtered = training.filter(
    (j) =>
      (!customer || jobCompanyNames(j).includes(customer) || j.customerName === customer) &&
      (!trainer || trainerOf(j) === trainer) &&
      (!q ||
        [j.jobNo, j.jobOrderNo, j.course, j.customerName, j.invoiceNumber, trainerOf(j), ...jobCompanyNames(j)]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))),
  );
  const shown = filtered.filter((j) => inStatus(j, status)).filter((j) => jobInReportPeriod(j, period, refDate));
  const closed = shown.filter((j) => j.status === "Closed");
  const shownCustomers = [...new Set(shown.flatMap((j) => jobCompanyNames(j)).filter(Boolean))];
  const certCount = shown.reduce((n, j) => n + (j.certificates || []).length, 0);
  const hasFilters = !!(customer || trainer || q);
  const today = isoToday();
  const expiringSoon = shown.filter((j) => {
    const exp = jobExpiryDate(j);
    return exp && exp >= today && exp <= addDaysIso(today, 30);
  });
  const certs: { c: Certificate; j: Job }[] = shown.flatMap((j) => (j.certificates || []).map((c) => ({ c, j })));

  return (
    <>
      <div className="subtabs">
        {STATUS_TABS.map(([id, label, test]) => (
          <button key={id} className={status === id ? "on" : ""} onClick={() => setStatus(id)}>
            {label} ({filtered.filter(test).length})
          </button>
        ))}
      </div>
      <div className="card">
        <h3>Training report</h3>
        <p className="hint">Pick a status above, then filter by customer, trainer or period.</p>
        <div className="filters">
          <div>
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_TABS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Customer</label>
            <select value={customer} onChange={(e) => setCustomer(e.target.value)}>
              <option value="">All customers</option>
              {customers.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Trainer</label>
            <select value={trainer} onChange={(e) => setTrainer(e.target.value)}>
              <option value="">All trainers</option>
              {trainers.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Search</label>
            <input value={search} placeholder="Job no, course, invoice no…" onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div style={{ alignSelf: "end" }}>
            <button
              className="btn ghost sm"
              disabled={!hasFilters}
              onClick={() => {
                setCustomer("");
                setTrainer("");
                setSearch("");
              }}
            >
              Clear filters
            </button>
          </div>
        </div>
        <div className="subtabs">
          {PERIODS.map(([id, label]) => (
            <button key={id} className={period === id ? "on" : ""} onClick={() => setPeriod(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="grid" style={{ marginBottom: 16, maxWidth: 520 }}>
          <div>
            <label>Report date</label>
            <input type="date" value={refDate} onChange={(e) => setRefDate(e.target.value || isoToday())} />
          </div>
          <div>
            <label>Period</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value || "monthly")}>
              {PERIODS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="kpis">
          <div className="kpi">
            <span>Jobs in view</span>
            <b>{shown.length}</b>
          </div>
          <div className="kpi">
            <span>Closed (invoiced)</span>
            <b>{closed.length}</b>
          </div>
          <div className="kpi">
            <span>Certificates</span>
            <b>{certCount}</b>
          </div>
          <div className="kpi">
            <span>Customers</span>
            <b>{shownCustomers.length}</b>
          </div>
          <div className="kpi">
            <span>Expiring in 30 days</span>
            <b>{expiringSoon.length}</b>
          </div>
        </div>
        {perms.has("Invoice:monitor") && <InvoiceMonitoringSection />}
        <p>
          <button className="btn dark" disabled={!shown.length} onClick={() => downloadCsv(shown, period, refDate)}>
            Download Excel
          </button>{" "}
          {perms.canViewCerts() && (
            <button className="btn sec" onClick={() => goToCertificates(status === "issued" ? "issued" : "pending")}>
              Open certificates
            </button>
          )}
        </p>
        {shown.length ? (
          <Paged items={shown} resetKey={status + "|" + shown.length}>
            {(rows) => (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Job No</th>
                      <th>Customer</th>
                      <th>Course</th>
                      <th>Date</th>
                      <th>Time</th>
                      <th>Status</th>
                      <th>Invoice no</th>
                      <th>Trainees</th>
                      <th>Certs</th>
                      <th>Expiry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((j) => (
                      <tr key={j.id}>
                        <td>
                          <b>{j.jobNo}</b>
                        </td>
                        <td>{jobCompanyNames(j).join(" · ") || j.customerName || "-"}</td>
                        <td>{j.course || "-"}</td>
                        <td>{jobDateRange(j)}</td>
                        <td>{j.trainingTime || "-"}</td>
                        <td>
                          <span className={statusClass(j.status)}>
                            {j.status === "Approved" ? "Issued" : j.status === "Rejected" ? "Returned" : j.status}
                          </span>
                        </td>
                        <td>{j.invoiceNumber || "-"}</td>
                        <td>{(j.attendees || []).length}</td>
                        <td>{(j.certificates || []).length}</td>
                        <td>{jobExpiryDate(j) || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Paged>
        ) : (
          <p className="muted">Nothing in this report.</p>
        )}
        {status !== "pending" && certs.length > 0 && (
          <>
            <h3 style={{ marginTop: 22 }}>Certificates in this period ({certs.length})</h3>
            <Paged items={certs} resetKey={status + "|" + certs.length}>
              {(rows) => (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Certificate No</th>
                        <th>Trainee</th>
                        <th>Customer</th>
                        <th>Course</th>
                        <th>Date</th>
                        <th>Expiry</th>
                        <th>Job</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ c, j }) => (
                        <tr key={c.id}>
                          <td>
                            <b>{c.certificateNo}</b>
                          </td>
                          <td>{c.name}</td>
                          <td>{c.company || j.certificateUnder || j.customerName}</td>
                          <td>{c.course}</td>
                          <td>
                            {c.trainingDate}
                            {j.trainingTime ? " " + j.trainingTime : ""}
                          </td>
                          <td>{c.expiresOn}</td>
                          <td>{j.jobNo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Paged>
          </>
        )}
      </div>
    </>
  );
}

interface InvoiceStats {
  approved: number;
  pendingInvoice: number;
  closed: number;
  jobs: {
    id: string;
    jobNo: string;
    customerName: string;
    course?: string;
    status: string;
    invoiceNumber?: string;
    closedBy?: string;
    closedAt?: string;
  }[];
}

export function InvoiceMonitoringSection() {
  const { loading, data } = usePageData(async () => {
    try {
      return await api<InvoiceStats>("GET", "/api/training/invoice-stats");
    } catch (err) {
      console.error("Failed to load invoice stats:", err);
      return null;
    }
  });
  if (loading) return <div>Loading invoice statistics...</div>;
  if (!data) return <div>Error loading invoice statistics</div>;
  const fmt = (d?: string) => (d ? new Date(d).toLocaleDateString() : "-");
  return (
    <>
      <div className="sect">Invoice Monitoring (Super Admin)</div>
      <p className="hint">Monitor invoice workflow across all jobs</p>
      <div className="kpis" style={{ marginBottom: 16 }}>
        <div className="kpi">
          <span>Approved Jobs</span>
          <b style={{ color: "#007acc" }}>{data.approved}</b>
        </div>
        <div className="kpi">
          <span>Pending Invoice</span>
          <b style={{ color: "#ff8c00" }}>{data.pendingInvoice}</b>
        </div>
        <div className="kpi">
          <span>Closed Jobs</span>
          <b style={{ color: "#28a745" }}>{data.closed}</b>
        </div>
      </div>
      {data.jobs.length > 0 && (
        <>
          <div className="sect">Recent Invoice Activity</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job No</th>
                  <th>Customer</th>
                  <th>Course</th>
                  <th>Status</th>
                  <th>Invoice #</th>
                  <th>Closed By</th>
                  <th>Closed Date</th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <strong>{j.jobNo}</strong>
                    </td>
                    <td>{j.customerName}</td>
                    <td>{j.course}</td>
                    <td>
                      <span className={`chip ${j.status === "Closed" ? "closed" : "approved"}`}>{j.status}</span>
                    </td>
                    <td>{j.invoiceNumber || "-"}</td>
                    <td>{j.closedBy || "-"}</td>
                    <td>{fmt(j.closedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
