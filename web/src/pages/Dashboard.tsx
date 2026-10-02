import { useState } from "react";
import { api } from "../api";
import { useApp, usePageData } from "../app-context";
import { PageLoading } from "../components/PageLoading";
import { Paged, Pagination, usePaged } from "../components/Pagination";
import { SERVICES, SUBCONTRACT } from "../constants";
import { newestFirst } from "../lib/jobs";
import type { Job } from "../types";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function Dashboard() {
  const { session, perms, go, openService, openJob, goToCertificates } = useApp();
  const { loading, data } = usePageData(() => api<Job[]>("GET", "/api/training").catch(() => [] as Job[]));
  const [listService, setListService] = useState("All");
  const all = data ?? [];
  const listed = newestFirst(listService === "All" ? all : all.filter((j) => (j.serviceType || "Training") === listService));
  const paged = usePaged(listed, listService);

  if (loading || !data) return <PageLoading />;
  const jobs = newestFirst(data);

  const bySvc = (s: string) => jobs.filter((j) => (j.serviceType || "Training") === s).length;
  const waiting = jobs.filter((j) => j.status === "Submitted");
  const unassigned = jobs.filter((j) => j.status === "Created");
  const cancelRequests = jobs.filter((j) => j.cancelRequest && j.status !== "Cancelled");
  const services = SERVICES.filter((s) => perms.canSeeService(s.id));
  const firstName = session.displayName.split(" ")[0];
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const openJobOf = (j: Job) => openJob(j.serviceType || "Training", j.id);

  return (
    <>
      <div className="welcome">
        <div>
          <h1>Hi {firstName}, welcome back 👋</h1>
          <p>
            {greeting()} — {today}
          </p>
        </div>
      </div>
      <div className="svc-row">
        {services.map((s) => (
          <button key={s.id} className="svc-pill" onClick={() => openService(s.id)}>
            <span className="ico">{s.icon}</span>
            <b>{s.id}</b>
            <span className="n">{bySvc(s.id)}</span>
          </button>
        ))}
        {perms.moduleAllowed(SUBCONTRACT.id) && (
          <button className="svc-pill" onClick={() => go("subcontract")}>
            <span className="ico">{SUBCONTRACT.icon}</span>
            <b>{SUBCONTRACT.id}</b>
          </button>
        )}
      </div>
      {perms.canIssueCerts() && waiting.length > 0 && (
        <div className="card">
          <h3>Pending certificates ({waiting.length})</h3>
          <p className="hint">These jobs are finished and waiting for a certificate.</p>
          <button className="btn ok" onClick={() => goToCertificates("pending")}>
            Open pending certificates
          </button>
        </div>
      )}
      {perms.isSuper() && cancelRequests.length > 0 && (
        <div className="card" style={{ borderColor: "#f0d9a8", background: "#fffaf0" }}>
          <h3>Cancel requests waiting for you ({cancelRequests.length})</h3>
          <Paged items={cancelRequests}>
            {(rows) => (
              <table>
                <thead>
                  <tr>
                    <th>Job No</th>
                    <th>Requested by</th>
                    <th>Reason</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((j) => (
                    <tr key={j.id}>
                      <td>{j.jobNo}</td>
                      <td>{j.cancelRequest?.requestedBy}</td>
                      <td>{j.cancelRequest?.reason}</td>
                      <td>
                        <button className="btn sec sm" onClick={() => openJobOf(j)}>
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Paged>
        </div>
      )}
      {(perms.isSuper() || perms.has("Training:create") || perms.has("Training:assign")) && unassigned.length > 0 && (
        <div className="card">
          <h3>Needs assignment ({unassigned.length})</h3>
          <Paged items={unassigned}>
            {(rows) => (
              <table>
                <thead>
                  <tr>
                    <th>Job No</th>
                    <th>Service</th>
                    <th>Customer</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((j) => (
                    <tr key={j.id}>
                      <td>
                        <a href="#" className="job-link" onClick={(e) => (e.preventDefault(), openJobOf(j))}>
                          {j.jobNo}
                        </a>
                      </td>
                      <td>{j.serviceType || "Training"}</td>
                      <td>{j.customerName}</td>
                      <td>
                        <button className="btn sec sm" onClick={() => openJobOf(j)}>
                          Assign
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Paged>
        </div>
      )}
      <div className="card">
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>Recent jobs</h3>
          <div className="subtabs" style={{ margin: 0 }}>
            {["All", ...services.map((s) => s.id)].map((s) => (
              <button key={s} className={listService === s ? "on" : ""} onClick={() => setListService(s)}>
                {s}
                {s !== "All" && ` (${bySvc(s)})`}
              </button>
            ))}
          </div>
        </div>
        {listed.length ? (
          <table>
            <thead>
              <tr>
                <th>Job No</th>
                <th>Service</th>
                <th>Customer</th>
                <th>Assigned to</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((j) => (
                <tr key={j.id}>
                  <td>
                    <a href="#" className="job-link" onClick={(e) => (e.preventDefault(), openJobOf(j))}>
                      {j.jobNo}
                    </a>
                  </td>
                  <td>
                    <span className="chip">{j.serviceType || "Training"}</span>
                  </td>
                  <td>{j.customerName}</td>
                  <td>{j.assigneeName || j.trainerName || "-"}</td>
                  <td>
                    <span className={"chip " + j.status.replace(" ", "")}>{j.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {listed.length ? (
          <Pagination {...paged} />
        ) : (
          <p className="muted">{listService === "All" ? "No jobs yet." : `No ${listService.toLowerCase()} jobs yet.`}</p>
        )}
      </div>
    </>
  );
}
