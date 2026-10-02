import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Job, Session } from "../types";
import { NATIVE, apiBase, fapi, setApiBase, setFieldSession } from "./api";
import { JobView } from "./JobView";
type Tab = "dashboard" | "jobs" | "submitted" | "alerts";
interface FieldNotification {
  id?: string;
  message: string;
  read: boolean;
  createdAt?: string;
  jobId?: string;
}

export interface FieldCtx {
  session: Session;
  toast: (msg: string) => void;
  openJob: (id: string) => Promise<void>;
}
const Ctx = createContext<FieldCtx>(null as unknown as FieldCtx);
export const useField = () => useContext(Ctx);
export const FieldProvider = Ctx.Provider;

export const isTrainer = (s: Session) => s.roles.includes("role-trainer");
export const isSiteEngineer = (s: Session) => s.roles.includes("role-site-engineer");
export const isTrainingJob = (j: Job) => !j.serviceType || j.serviceType === "Training";
export const statusLabel = (s: string) =>
  ({
    Assigned: "Assigned — ready to start",
    "In Progress": "In progress",
    Submitted: "Certificate requested", 
    Approved: "Certificate approved",
    Issued: "Certificates issued",
    Rejected: "Returned by office",
    Cancelled: "Cancelled",
    Closed: "Completed & Invoiced",
  })[s] || s;
export const chipClass = (s: string) => "chip " + String(s || "").replace(" ", "");

function useFieldHead() {
  useEffect(() => {
    document.title = "Westcal Field — Site Engineers & Trainers";
    const add = (tag: string, attrs: Record<string, string>) => {
      const el = document.createElement(tag);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      document.head.appendChild(el);
    };
    add("link", { rel: "manifest", href: "/app/manifest.webmanifest" });
    add("meta", { name: "theme-color", content: "#0b4f9c" });
    add("meta", { name: "mobile-web-app-capable", content: "yes" });
    add("meta", { name: "apple-mobile-web-app-capable", content: "yes" });
    add("meta", { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" });
    document.querySelector('meta[name="viewport"]')?.setAttribute("content", "width=device-width, initial-scale=1, viewport-fit=cover");
    if (!NATIVE && "serviceWorker" in navigator) navigator.serviceWorker.register("/app/sw.js").catch(() => {});
  }, []);
}

export function FieldApp() {
  useFieldHead();
  const [session, setSession] = useState<Session | null>(null);
  const [toastMsg, setToastMsg] = useState("");
  const timer = useRef<number>();
  const toast = (msg: string) => {
    setToastMsg(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToastMsg(""), 3200);
  };
  const signOut = () => {
    setFieldSession(null);
    setSession(null);
  };

  return (
    <>
      {session ? (
        <Shell key={session.token} session={session} toast={toast} onSignOut={signOut} />
      ) : (
        <SignIn
          toast={toast}
          onSignedIn={(s) => {
            setFieldSession(s);
            setSession(s);
          }}
        />
      )}
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </>
  );
}

function SignIn({ onSignedIn, toast }: { onSignedIn: (s: Session) => void; toast: (m: string) => void }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const [showServer, setShowServer] = useState(NATIVE && !apiBase());
  const [server, setServer] = useState(apiBase());

  async function doSignIn() {
    setErr("");
    try {
      const s = await fapi<Session>("POST", "/api/sign-in", { identifier: u.trim().toLowerCase(), credential: p.trim() });
      if (!isTrainer(s) && !isSiteEngineer(s)) {
        setErr("This app is for Site Engineers and Trainers. Please use the desktop console.");
        return;
      }
      onSignedIn(s);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <form
      className="signin"
      onSubmit={(e) => {
        e.preventDefault();
        doSignIn();
      }}
    >
      <img src="/logo.jpg" alt="Westcal" />
      <h1>Westcal Field</h1>
      <p className="s">Trainers mark attendance · Site engineers record tests</p>
      <label className="fl" htmlFor="u">
        Username
      </label>
      <input id="u" value={u} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Enter your User ID" onChange={(e) => setU(e.target.value)} />
      <label className="fl" htmlFor="p">
        Password
      </label>
      <input id="p" type="password" value={p} autoComplete="current-password" placeholder="Enter your password" onChange={(e) => setP(e.target.value)} />
      <button className="btn" type="submit" style={{ marginTop: 22 }}>
        Sign in
      </button>
      <div className="err" role="alert">
        {err}
      </div>
      <button className="btn ghost" type="button" style={{ marginTop: 14 }} onClick={() => setShowServer(!showServer)}>
        Server settings
      </button>
      {showServer && (
        <div>
          <label className="fl" htmlFor="apibase">
            Server address
          </label>
          <input
            id="apibase"
            autoFocus
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="https://app.caltech-eng.com"
            value={server}
            onChange={(e) => setServer(e.target.value)}
          />
          <p className="muted" style={{ margin: "8px 0 0" }}>
            Leave blank when opening the app from the server itself.
          </p>
          <button
            className="btn sec"
            type="button"
            style={{ marginTop: 10 }}
            onClick={() => {
              setApiBase(server);
              toast("Server address saved.");
              setShowServer(false);
            }}
          >
            Save address
          </button>
        </div>
      )}
    </form>
  );
}

const TITLES: Record<Tab, string> = { dashboard: "Dashboard", jobs: "My Jobs", submitted: "Submitted Documents", alerts: "Alerts" };

function Shell({ session, toast, onSignOut }: { session: Session; toast: (m: string) => void; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [noti, setNoti] = useState<FieldNotification[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [openSeq, setOpenSeq] = useState(0);

  async function refresh() {
    const [j, n] = await Promise.all([
      fapi<Job[]>("GET", "/api/training").catch(() => [] as Job[]),
      fapi<FieldNotification[]>("GET", "/api/notifications").catch(() => [] as FieldNotification[]),
    ]);
    setJobs(j);
    setNoti(n);
    return j;
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function go(t: Tab) {
    setTab(t);
    setCurrentId(null);
    if (t === "alerts") await fapi("POST", "/api/notifications/read", {}).catch(() => {});
    await refresh();
    if (t === "alerts") setNoti((list) => list.map((n) => ({ ...n, read: true })));
  }

  async function openJob(id: string) {
    setTab("jobs");
    const list = await fapi<Job[]>("GET", "/api/training").catch(() => [] as Job[]);
    setJobs(list);
    if (!list.some((x) => x.id === id)) {
      toast("That job is no longer assigned to you.");
      setCurrentId(null);
      return;
    }
    setCurrentId(id);
    setOpenSeq((n) => n + 1);
  }

  const unread = noti.filter((n) => !n.read).length;
  const role = isTrainer(session) ? "Trainer" : isSiteEngineer(session) ? "Site Engineer" : "Field";
  const current = currentId ? jobs.find((j) => j.id === currentId) || null : null;

  let body;
  if (tab === "dashboard") body = <Dashboard jobs={jobs} go={go} />;
  else if (tab === "jobs")
    body = current ? (
      <JobView key={currentId + ":" + openSeq} job={current} onBack={() => setCurrentId(null)} reload={refresh} />
    ) : (
      <JobList jobs={jobs} />
    );
  else if (tab === "submitted") body = <Submitted jobs={jobs} />;
  else body = <Alerts noti={noti} />;

  return (
    <Ctx.Provider value={{ session, toast, openJob }}>
      <header className="appbar">
        <h1>
          {TITLES[tab] || "Westcal Field"}
          <span className="sub">
            {session.displayName} · {role}
          </span>
        </h1>
        <span className="badge-wrap">
          <button className="iconbtn" onClick={() => go("alerts")} aria-label={`Alerts${unread ? `, ${unread} unread` : ""}`}>
            &#128276;
          </button>
          {unread > 0 && (
            <span className="badge" aria-hidden="true">
              {unread}
            </span>
          )}
        </span>
        <button className="iconbtn" onClick={onSignOut} aria-label="Sign out">
          &#9099;
        </button>
      </header>
      <main>{body}</main>
      <nav className="tabs" aria-label="Sections">
        {(
          [
            ["dashboard", "\u{1F3E0}", "Home"],
            ["jobs", "\u{1F4CB}", "Jobs"],
            ["submitted", "\u{1F4C4}", "Submitted"],
            ["alerts", "\u{1F514}", "Alerts"],
          ] as [Tab, string, string][]
        ).map(([id, ic, label]) => (
          <button key={id} onClick={() => go(id)} aria-current={tab === id ? "page" : undefined}>
            <span className="ic" aria-hidden="true">
              {ic}
            </span>
            {label}
          </button>
        ))}
      </nav>
    </Ctx.Provider>
  );
}

function JobCard({ j, children }: { j: Job; children?: React.ReactNode }) {
  const { openJob } = useField();
  return (
    <button className="job" onClick={() => openJob(j.id)}>
      <div className="row">
        <span className="no grow">{j.jobNo}</span>
        <span className={chipClass(j.status)}>{statusLabel(j.status)}</span>
      </div>
      <div className="cust">{j.customerName}</div>
      {children}
    </button>
  );
}

function Dashboard({ jobs, go }: { jobs: Job[]; go: (t: Tab) => void }) {
  const { session } = useField();
  const active = jobs.filter((j) => j.status === "Assigned" || j.status === "In Progress");
  const requested = jobs.filter((j) => j.status === "Submitted");
  const issued = jobs.filter((j) => j.status === "Approved");
  const stat = (label: string, count: number, meta: string, t: Tab, cls = "") => (
    <button className="job" onClick={() => go(t)}>
      <div className="row">
        <span className="grow">
          <b>{label}</b>
        </span>
        <span className={"chip " + cls}>{count}</span>
      </div>
      <div className="meta">{meta}</div>
    </button>
  );
  return (
    <>
      <div className="card">
        <h2>Welcome, {session.displayName}</h2>
        <p className="muted">
          {isTrainer(session)
            ? "Open an assigned job, complete the review, mark attendance and send the certificate request."
            : "Open an assigned job, record results and submit it to the office."}
        </p>
      </div>
      {stat("Active jobs", active.length, "Assigned or in progress", "jobs")}
      {stat("Certificate requested", requested.length, "Waiting for Office Admin", "submitted", "Submitted")}
      {stat("Certificates issued", issued.length, "Completed documents", "submitted", "Issued")}
      <div className="sect">What to do next</div>
      {active.length ? (
        active.map((j) => (
          <JobCard key={j.id} j={j}>
            <div className="meta">{j.course}</div>
          </JobCard>
        ))
      ) : (
        <div className="card">
          <p className="muted">No active jobs. Check Submitted Documents or wait for a new assignment.</p>
        </div>
      )}
    </>
  );
}

function Submitted({ jobs }: { jobs: Job[] }) {
  const docs = jobs.filter((j) => ["Submitted", "Approved", "Rejected"].includes(j.status));
  if (!docs.length)
    return (
      <div className="empty">
        <span className="big">&#128196;</span>
        <p>No submitted documents yet.</p>
        <p className="muted">After attendance or testing is complete, send the certificate request from the job.</p>
      </div>
    );
  return (
    <>
      {docs.map((j) => (
        <JobCard key={j.id} j={j}>
          <div className="meta">{j.course}</div>
          <div className="meta">
            {j.status === "Submitted"
              ? "Sent to office — waiting for approval"
              : j.status === "Approved" || j.status === "Issued"
                ? (j.certificates || []).length + " certificate(s) issued"
                : "Returned: " + (j.rejectedReason || "review required")}
          </div>
        </JobCard>
      ))}
    </>
  );
}

export function fieldDate(v: string | undefined): string {
  const m = String(v || "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v || "-";
}

function JobList({ jobs }: { jobs: Job[] }) {
  const { session } = useField();
  if (!jobs.length) {
    const who = isSiteEngineer(session) ? "site engineer" : "trainer";
    return (
      <div className="empty">
        <span className="big" aria-hidden="true">
          &#128203;
        </span>
        <p>No jobs on your list yet.</p>
        <p className="muted">This screen stays empty until the office creates a job and assigns it to you.</p>
        <p className="muted">Office: create the job → Assign to this {who}. Then refresh this page.</p>
      </div>
    );
  }

  return (
    <>
      {jobs.map((j) => (
        <JobCard key={j.id} j={j}>
          <div className="meta">
            {j.serviceType || "Training"} · {j.course}
          </div>
          <div className="meta">
            {fieldDate(j.trainingDate)}
            {j.trainingTime ? " · " + j.trainingTime : ""}
          </div>
        </JobCard>
      ))}
    </>
  );
}

function Alerts({ noti }: { noti: FieldNotification[] }) {
  const { openJob } = useField();
  if (!noti.length)
    return (
      <div className="empty">
        <span className="big" aria-hidden="true">
          &#128276;
        </span>
        <p>No alerts.</p>
      </div>
    );
  return (
    <>
      {noti.map((n, i) => (
        <div className="card" key={n.id || i}>
          <div>{n.message}</div>
          <div className="muted" style={{ marginTop: 6 }}>
            {n.createdAt ? new Date(n.createdAt).toLocaleString() : ""}
          </div>
          {n.jobId && (
            <button className="btn sec" style={{ marginTop: 12 }} onClick={() => openJob(n.jobId!)}>
              Open job
            </button>
          )}
        </div>
      ))}
    </>
  );
}
