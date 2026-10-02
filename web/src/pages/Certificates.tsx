import { useState } from "react";
import { api } from "../api";
import { useApp, usePageData } from "../app-context";
import { IssueModal } from "../components/IssueModal";
import { PageLoading } from "../components/PageLoading";
import { Paged } from "../components/Pagination";
import { jobSearchText, matchesSearch, newestFirst } from "../lib/jobs";
import type { Attendee, Job } from "../types";
import { CertJobView, type CertKind, type InnerTab } from "./certificates/CertJobView";

type RequestRow = { a: Attendee; j: Job; st: string };

export function Certificates() {
  const { nav, go, perms } = useApp();
  const { loading, data, reload } = usePageData(() => api<Job[]>("GET", "/api/training").catch(() => [] as Job[]));
  const [openId, setOpenId] = useState("");
  const [inner, setInner] = useState<InnerTab>("docs");
  const [search, setSearch] = useState("");
  const [issuing, setIssuing] = useState<Job | null>(null);
  const canIssue = perms.canIssueCerts();
  const tab = canIssue ? nav.certTab : "issued";

  if (loading || !data) return <PageLoading />;

  const jobs = newestFirst(data);
  const switchTab = (t: string) => {
    setOpenId("");
    go("approvals", { certTab: t });
  };
  const openJob = (t: string, id: string) => {
    setOpenId(id);
    setInner("docs");
    if (t !== tab) go("approvals", { certTab: t });
  };

  const pending = jobs.filter((j) => j.status === "Submitted");
  const issued = jobs.filter((j) => (j.certificates || []).length);
  const issuedCount = issued.reduce((n, j) => n + (j.certificates || []).length, 0);
  const requests: RequestRow[] = jobs
    .filter((j) => (j.serviceType || "Training") === "Training")
    .flatMap((j) =>
      (j.attendees || []).map((a: Attendee) => {
        let st: string;
        if (j.status === "Approved") st = "Issued";
        else if (j.status === "Submitted") st = "Waiting for certificate";
        else if (!a.signature || !(a.photoDataUrl || a.extraPhotoDataUrl)) st = "Trainee request";
        else st = "Ready on job";
        return { a, j, st };
      }),
    )
    .filter((r) => r.st !== "Issued");
  const open = jobs.find((j) => j.id === openId);

  const tabButton = (t: string, label: string, count: number) => (
    <button className={tab === t ? "on" : ""} onClick={() => switchTab(t)}>
      {label} ({count})
    </button>
  );
  const searchBox = (placeholder: string) => (
    <input value={search} placeholder={placeholder} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 420, marginBottom: 14 }} />
  );

  function jobTable(list: Job[], kind: CertKind) {
    if (!list.length)
      return (
        <div className="card">
          <p className="muted">Nothing here yet.</p>
        </div>
      );
    return (
      <div className="card">
        {searchBox("Search job no, company, trainee, course")}
        <p className="hint">Large lists stay in this table. Open one job at a time.</p>
        <Paged items={list.filter((j) => matchesSearch(jobSearchText(j), search))} resetKey={kind + "|" + search}>
          {(rows) => (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Customer</th>
                    <th>Course</th>
                    <th>Date</th>
                    <th>People</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((j) => (
                    <tr key={j.id}>
                      <td>
                        <b>{j.jobNo}</b>
                      </td>
                      <td>{j.customerName || ""}</td>
                      <td>{j.course || "-"}</td>
                      <td>{j.trainingDate || "-"}</td>
                      <td>
                        {(j.attendees || []).length}
                        {(j.certificates || []).length ? ` / ${(j.certificates || []).length} certs` : ""}
                      </td>
                      <td>
                        <button className="btn sm" onClick={() => openJob(kind, j.id)}>
                          Open
                        </button>{" "}
                        {kind === "pending" && canIssue && (
                          <button className="btn ok sm" onClick={() => setIssuing(j)}>
                            Issue
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Paged>
      </div>
    );
  }

  let body;
  if (tab === "pending") {
    body =
      open && pending.some((j) => j.id === open.id) ? (
        <CertJobView
          job={open}
          kind="pending"
          inner={inner}
          setInner={setInner}
          onBack={() => setOpenId("")}
          onIssue={() => setIssuing(open)}
          onChanged={reload}
        />
      ) : (
        <>
          <h3>Pending</h3>
          <p className="hint">Search, then open one job. Do not load every form at once.</p>
          {jobTable(pending, "pending")}
        </>
      );
  } else if (tab === "requests") {
    body = (
      <>
        <h3>Trainee requests</h3>
        <p className="hint">Search by name or job. Open the job only when you need to edit.</p>
        {requests.length ? (
          <div className="card">
            {searchBox("Search name, phone, job, course")}
            <Paged
              items={requests.filter(({ a, j }) =>
                matchesSearch(
                  [a.name, a.idOrVisaNo, a.mobileNumber, a.company, a.course, j.jobNo, j.customerName].join(" ").toLowerCase(),
                  search,
                ),
              )}
              resetKey={search}
            >
              {(rows) => (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Phone</th>
                        <th>Company</th>
                        <th>Course</th>
                        <th>Job</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ a, j, st }) => (
                        <tr key={j.id + a.id}>
                          <td>
                            <b>{a.name || "-"}</b>
                            <div className="muted">{a.idOrVisaNo || "No EID"}</div>
                          </td>
                          <td>{a.mobileNumber || "-"}</td>
                          <td>{a.company || j.customerName || ""}</td>
                          <td>{a.course || j.course || ""}</td>
                          <td>{j.jobNo}</td>
                          <td>
                            <span className={"chip " + (j.status === "Submitted" ? "Submitted" : "")}>{st}</span>
                          </td>
                          <td>
                            <button className="btn sm" onClick={() => openJob(j.status === "Approved" ? "issued" : "pending", j.id)}>
                              Open job
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Paged>
          </div>
        ) : (
          <div className="card">
            <p className="muted">No trainee requests.</p>
          </div>
        )}
      </>
    );
  } else {
    body =
      open && issued.some((j) => j.id === open.id) ? (
        <CertJobView
          job={open}
          kind="issued"
          inner={inner}
          setInner={setInner}
          onBack={() => setOpenId("")}
          onIssue={() => setIssuing(open)}
          onChanged={reload}
        />
      ) : (
        <>
          <h3>Issued</h3>
          <p className="hint">When many certificates arrive, stay on this list. Search, then open one job.</p>
          {jobTable(issued, "issued")}
        </>
      );
  }

  return (
    <>
      {canIssue ? (
        <div className="subtabs">
          {tabButton("pending", "Pending", pending.length)}
          {tabButton("issued", "Issued", issuedCount)}
          {tabButton("requests", "Trainee requests", requests.length)}
        </div>
      ) : (
        <p className="hint">Certificates appear here after the Office Coordinator issues them.</p>
      )}
      {body}
      {issuing && (
        <IssueModal
          job={issuing}
          onClose={() => setIssuing(null)}
          onIssued={() => {
            setIssuing(null);
            setOpenId("");
            go("approvals", { certTab: "issued" });
            reload();
          }}
          onRejected={() => {
            setIssuing(null);
            reload();
          }}
        />
      )}
    </>
  );
}
