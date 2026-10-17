import { useState, type MouseEvent } from "react";
import { api } from "../api";
import { useApp, usePageData } from "../app-context";
import { PageError, PageLoading } from "../components/PageLoading";
import { Paged } from "../components/Pagination";
import {
  addDaysIso,
  isoToday,
  jobCompanyNames,
  jobDateRange,
  jobExpiryDate,
  jobInDateRange,
  jobInReportPeriod,
  newestFirst,
  openedAt,
  statusClass,
} from "../lib/jobs";
import type { Job, Session } from "../types";

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
    "Certificate numbers",
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
      certificateNumbers(j).join(", "),
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

function jobIsInvoiced(j: Job): boolean {
  return j.status === "Closed" || !!String(j.invoiceNumber || "").trim();
}

function jobIsIssued(j: Job): boolean {
  return j.status === "Issued" || j.status === "Approved";
}

/** The accountant sees issued jobs that still need an invoice, and jobs already invoiced. */
function isAccountant(session: Session): boolean {
  const id = String(session.identifier || "").trim().toLowerCase();
  if (id) return id === "accountant";
  return session.displayName.trim().toLowerCase() === "munaveer";
}

function certificateNumbers(j: Job): string[] {
  return (j.certificates || []).map((c) => String(c.certificateNo || "").trim()).filter(Boolean);
}

function InvoiceCloseBox({ job, onSaved }: { job: Job; onSaved: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (jobIsInvoiced(job)) return <span>{job.invoiceNumber || "Closed"}</span>;

  async function save(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!value.trim()) return setErr("Type the invoice number.");
    setBusy(true);
    setErr("");
    try {
      await api("POST", `/api/training/${job.id}/invoice`, { invoiceNumber: value.trim() });
      onSaved();
    } catch (caught) {
      setErr((caught as Error).message);
      setBusy(false);
    }
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input value={value} placeholder="Invoice number" onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save(e as unknown as MouseEvent)} />
        <button className="btn sm" type="button" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Close"}
        </button>
      </div>
      {err && <div className="err">{err}</div>}
    </div>
  );
}

const STATUS_TABS: [string, string, (j: Job) => boolean][] = [
  ["all", "All", () => true],
  ["created", "Created", (j) => j.status === "Created"],
  ["assigned", "Assigned", (j) => j.status === "Assigned"],
  ["open", "In progress", (j) => j.status === "In Progress"],
  ["pending", "Submitted", (j) => j.status === "Submitted"],
  ["returned", "Returned", (j) => j.status === "Rejected"],
  ["issued", "Issued", (j) => j.status === "Issued" || j.status === "Approved"],
  ["invoiced", "Invoiced", jobIsInvoiced],
  ["not-invoiced", "Not invoiced", (j) => !jobIsInvoiced(j)],
  ["cancelled", "Cancelled", (j) => j.status === "Cancelled"],
];

function periodLabel(period: string, ref: string): string {
  if (period === "all") return "all dates";
  if (period === "yearly") return ref.slice(0, 4);
  if (period === "daily") return ref.split("-").reverse().join("-");
  if (period === "weekly") return "the week of " + ref.split("-").reverse().join("-");
  const [year, month] = ref.split("-");
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return (names[Number(month) - 1] || month) + " " + year;
}

const PERIODS: [string, string][] = [
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
  ["yearly", "Yearly"],
  ["all", "All dates"],
];

export function Reports() {
  const { nav, go, perms, session, goToCertificates, openJob } = useApp();
  const accountant = isAccountant(session);
  const { data, error, reload } = usePageData(() => api<Job[]>("GET", "/api/training"));
  const [period, setPeriod] = useState("monthly");
  const [refDate, setRefDate] = useState(isoToday());
  const requested = nav.reportStatus === "closed" ? "invoiced" : nav.reportStatus;
  const statusTabs = accountant
    ? (["not-invoiced", "invoiced"] as const).map((id) => STATUS_TABS.find(([tab]) => tab === id)!)
    : STATUS_TABS;
  const status = statusTabs.some(([id]) => id === requested) ? requested : accountant ? "not-invoiced" : "all";
  const setStatus = (id: string) => go("reports", { reportStatus: id });
  const [customer, setCustomer] = useState("");
  const [trainer, setTrainer] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  if (error || !data) {
    if (error) return <PageError message={error} onRetry={reload} />;
    return <PageLoading label="Loading reports…" />;
  }

  const training = newestFirst(data.filter((j) => (j.serviceType || "Training") === "Training"));
  const accountantNotInvoiced = (j: Job) => jobIsIssued(j) && !jobIsInvoiced(j);
  const inStatus = (j: Job, id: string) =>
    accountant && id === "not-invoiced" ? accountantNotInvoiced(j) : (STATUS_TABS.find(([t]) => t === id)?.[2](j) ?? true);
  const trainerOf = (j: Job) => j.assigneeName || j.trainerName || "";
  const customers = [...new Set(training.flatMap((j) => jobCompanyNames(j).concat(j.customerName || "")).filter(Boolean))].sort();
  const trainers = [...new Set(training.map(trainerOf).filter(Boolean))].sort();
  const q = query.trim().toLowerCase();
  const invoiceQuery = invoiceNo.trim().toLowerCase().replace(/\s+/g, "");
  const runSearch = () => setQuery(search.trim());
  const invoiceText = (j: Job) => String(j.invoiceNumber || j.invoiceNo || "");
  const inDates = (j: Job) => (from || to ? jobInDateRange(j, from, to) : jobInReportPeriod(j, period, refDate));
  const dated = training.filter(
    (j) =>
      inDates(j) &&
      (!customer || jobCompanyNames(j).includes(customer) || j.customerName === customer) &&
      (!trainer || trainerOf(j) === trainer) &&
      (!invoiceQuery || invoiceText(j).toLowerCase().replace(/\s+/g, "").includes(invoiceQuery)) &&
      (!q ||
        [j.jobNo, j.jobOrderNo, j.course, j.customerName, invoiceText(j), trainerOf(j), ...jobCompanyNames(j)]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))),
  );
  const shown = dated.filter((j) => inStatus(j, status));
  const statusCount = (id: string) => dated.filter((j) => inStatus(j, id)).length;
  const shownCustomers = [...new Set(shown.flatMap((j) => jobCompanyNames(j)).filter(Boolean))];
  const certCount = shown.reduce((n, j) => n + (j.certificates || []).length, 0);
  const hasFilters = !!(customer || trainer || q || invoiceNo || from || to || status !== (accountant ? "not-invoiced" : "all"));
  const openThisJob = (j: Job) => openJob(j.serviceType || "Training", j.id);
  const today = isoToday();
  const expiringSoon = shown.filter((j) => {
    const exp = jobExpiryDate(j);
    return exp && exp >= today && exp <= addDaysIso(today, 30);
  });
  const statusName = STATUS_TABS.find(([id]) => id === status)?.[1] || "All";
  const when =
    from || to
      ? [from, to].filter(Boolean).map((d) => d.split("-").reverse().join("-")).join(" to ")
      : periodLabel(period, refDate);
  const summary = `Showing ${shown.length} ${status === "all" ? "" : statusName + " "}job${shown.length === 1 ? "" : "s"} for ${when}. Click a job number to open it.`;

  return (
    <>
      <div className="card">
        <h3>Training report</h3>
        <p className="hint" style={{ marginTop: 0 }}>{summary}</p>

        <div className="sect">Date</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", marginBottom: 8 }}>
          <div className="subtabs" style={{ margin: 0 }}>
            {PERIODS.map(([id, label]) => (
              <button key={id} className={period === id ? "on" : ""} onClick={() => setPeriod(id)}>
                {label}
              </button>
            ))}
          </div>
          {period !== "all" && !from && !to && (
            <div>
              <label>{period === "yearly" ? "Year" : period === "monthly" ? "Month" : "Date"}</label>
              <input type="date" value={refDate} onChange={(e) => setRefDate(e.target.value || isoToday())} />
            </div>
          )}
          <div>
            <label>From</label>
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label>To</label>
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        {(from || to) && <p className="hint">From and To are the dates used. Clear them to go back to Daily, Weekly, Monthly, or Yearly.</p>}

        <div className="sect">Status</div>
        <div className="subtabs">
          {statusTabs.map(([id, label]) => (
            <button key={id} className={status === id ? "on" : ""} onClick={() => setStatus(id)}>
              {label} ({statusCount(id)})
            </button>
          ))}
        </div>
        {accountant && (
          <p className="hint">Not invoiced shows issued jobs only. Type the invoice number and choose Close to mark the job Closed.</p>
        )}

        <div className="filters">
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
            <label>Invoice number</label>
            <input value={invoiceNo} placeholder="Type the invoice number" onChange={(e) => setInvoiceNo(e.target.value)} />
          </div>
          <div>
            <label>Search</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={search}
                placeholder="Job no, course, customer…"
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runSearch();
                }}
              />
              <button className="btn sm" type="button" onClick={runSearch}>
                Search
              </button>
            </div>
          </div>
          <div style={{ alignSelf: "end" }}>
            <button
              className="btn ghost sm"
              disabled={!hasFilters && !search}
              onClick={() => {
                setCustomer("");
                setTrainer("");
                setSearch("");
                setQuery("");
                setFrom("");
                setTo("");
                setInvoiceNo("");
                setStatus(accountant ? "not-invoiced" : "all");
              }}
            >
              Clear filters
            </button>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          {certCount} certificate{certCount === 1 ? "" : "s"} · {shownCustomers.length} customer{shownCustomers.length === 1 ? "" : "s"} · {expiringSoon.length} expiring in 30 days
        </p>
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
          <Paged items={shown} resetKey={status + "|" + period + "|" + refDate + "|" + from + "|" + to + "|" + invoiceNo + "|" + customer + "|" + trainer + "|" + q}>
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
                      {accountant && <th>Certificate numbers</th>}
                      <th>Trainees</th>
                      {!accountant && <th>Certs</th>}
                      <th>Expiry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((j) => (
                      <tr key={j.id} style={{ cursor: "pointer" }} onClick={() => openThisJob(j)}>
                        <td>
                          <a href="#" className="job-link" onClick={(e) => (e.preventDefault(), openThisJob(j))}>
                            <b>{j.jobNo}</b>
                          </a>
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
                        <td>{accountant ? <InvoiceCloseBox job={j} onSaved={reload} /> : j.invoiceNumber || "-"}</td>
                        {accountant && (
                          <td>
                            {certificateNumbers(j).length ? certificateNumbers(j).join(", ") : "-"}
                          </td>
                        )}
                        <td>{(j.attendees || []).length}</td>
                        {!accountant && <td>{(j.certificates || []).length}</td>}
                        <td>{jobExpiryDate(j) || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Paged>
        ) : (
          <p className="muted">
            {accountant
              ? status === "invoiced"
                ? "No invoiced jobs in this period."
                : "No issued jobs are waiting for an invoice."
              : "No jobs match. Choose All, or All dates."}
          </p>
        )}
      </div>
    </>
  );
}
