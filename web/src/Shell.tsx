import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useApp, type View } from "./app-context";
import { ROLE_NAMES, initials } from "./constants";
import type { Notification } from "./types";
import { Certificates } from "./pages/Certificates";
import { Courses } from "./pages/Courses";
import { Numbering } from "./pages/Numbering";
import { Dashboard } from "./pages/Dashboard";
import { Jobs } from "./pages/jobs/Jobs";
import { Reports } from "./pages/Reports";
import { Subcontract } from "./pages/Subcontract";
import { Trainers } from "./pages/Trainers";
import { Users } from "./pages/Users";

export function Shell() {
  const { session, perms, nav, go, signOut, goToCertificates } = useApp();
  const [navOpen, setNavOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNoti, setShowNoti] = useState(false);
  const loadNotifications = useCallback(async () => {
    if (perms.has("Training:read") || perms.canIssueCerts())
      setNotifications(await api<Notification[]>("GET", "/api/notifications").catch(() => []));
  }, [perms]);
  useEffect(() => {
    loadNotifications();
    api("GET", "/api/training").catch(() => {});
    const t = window.setInterval(() => {
      if (!document.hidden) loadNotifications();
    }, 45000);
    return () => window.clearInterval(t);
  }, [loadNotifications]);

  function toggleNotifications() {
    setShowNoti((open) => !open);
    if (!showNoti) loadNotifications();
  }

  function openNotification(n: Notification) {
    setShowNoti(false);
    api("POST", "/api/notifications/read").then(loadNotifications);
    if (n.jobId) go("approvals", { certTab: "pending", jobId: n.jobId });
    else goToCertificates("pending");
  }

  const items: [View, string, string][] = [["dashboard", "🏠", "Dashboard"]];
  if (perms.canSeeService("Training") && (!perms.isFieldUser() || perms.isAdmin())) items.push(["training", "📋", "Training jobs"]);
  if (perms.canReports()) items.push(["reports", "📊", "Reports"]);
  if (perms.canViewCerts() && perms.moduleAllowed("Training")) items.push(["approvals", "📜", "Certificates"]);
  if (perms.has("Users:read") || perms.isSuper()) items.push(["users", "👥", "Add staff"]);
  if (perms.canAddCourse()) items.push(["courses", "🎓", "Add course"]);

  function isActive(id: View) {
    if (id === "courses") return nav.view === "jobs" && nav.jobService === "Training" && nav.trainingTab === "courses";
    if (id === "training") return nav.view === "jobs" && nav.jobService === "Training" && nav.trainingTab !== "courses";
    return id === nav.view;
  }
  function open(id: View) {
    setNavOpen(false);
    if (id === "courses") go("jobs", { jobService: "Training", trainingTab: "courses" });
    else if (id === "training") go("jobs", { jobService: "Training", trainingTab: "jobs" });
    else go(id);
  }

  const titles: Record<string, string> = {
    dashboard: perms.isSuper() ? "Super Admin dashboard" : perms.isAdmin() ? "Admin dashboard" : "Dashboard",
    users: "Add staff",
    jobs:
      perms.isFieldUser() && !perms.isAdmin()
        ? "My Assigned Jobs"
        : nav.jobService + (nav.jobService === "Training" ? "" : " jobs"),
    approvals: "Certificates",
    reports: "Reports",
    subcontract: "Subcontract",
  };
  const unread = notifications.filter((n) => !n.read).length;
  const roleText = session.roles.map((r) => ROLE_NAMES[r] || r).join(", ");

  return (
    <div className={"app" + (navOpen ? " nav-open" : "")}>
      <div className="nav-shade" onClick={() => setNavOpen(false)} />
      <aside className="sidebar">
        <div className="brand">
          <img
            src="/logo.jpg"
            alt="W"
            style={{ width: 36, height: 36, borderRadius: 9, objectFit: "cover", background: "#fff" }}
          />
          <b>
            Westcal
            <br />
            Platform
          </b>
        </div>
        <nav>
          {items.map(([id, icon, label]) => (
            <a key={id} className={isActive(id) ? "active" : ""} onClick={() => open(id)}>
              <span className="ic">{icon}</span>
              <span className="t">{label}</span>
            </a>
          ))}
        </nav>
        <div className="foot">v1.0 • Office dashboard</div>
      </aside>
      <div className="content">
        <div className="topbar">
          <div className="left">
            <button className="menu-btn" type="button" onClick={() => setNavOpen((o) => !o)}>
              ☰
            </button>
            <h2>{titles[nav.view]}</h2>
          </div>
          <div className="right">
            {(perms.has("Training:read") || perms.canIssueCerts()) && (
              <span className="bell" onClick={toggleNotifications} title="Certificate requests">
                🔔
                <span className={"dot" + (unread === 0 ? " hidden" : "")}>{unread || ""}</span>
              </span>
            )}
            <div className="who">
              <b>{session.displayName}</b>
              <span>{roleText}</span>
            </div>
            <div className="avatar">{initials(session.displayName)}</div>
            <button className="btn sec sm" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
        {showNoti && (
          <div className="noti">
            <div className="h">Notifications</div>
            {notifications.length ? (
              notifications.map((n, i) => (
                <button key={n.id ?? i} type="button" className="item" onClick={() => openNotification(n)}>
                  {n.read ? "" : "🔵 "}
                  {n.message}
                </button>
              ))
            ) : (
              <div className="item muted">No new certificate requests</div>
            )}
          </div>
        )}
        <div className="page">
          <ViewRouter key={`${nav.view}:${nav.jobService}:${nav.trainingTab}`} view={nav.view} />
        </div>
      </div>
    </div>
  );
}

function ViewRouter({ view }: { view: View }) {
  const { nav, perms } = useApp();
  switch (view) {
    case "dashboard":
      return <Dashboard />;
    case "users":
      return <Users />;
    case "reports":
      return <Reports />;
    case "approvals":
      return <Certificates />;
    case "subcontract":
      return <Subcontract />;
    case "jobs":
      if (nav.jobService === "Training" && nav.trainingTab === "courses" && perms.canAddCourse()) return <Courses />;
      if (nav.jobService === "Training" && nav.trainingTab === "people" && perms.isSuper()) return <Trainers />;
      if (nav.jobService === "Training" && nav.trainingTab === "numbers" && perms.isSuper()) return <Numbering />;
      return <Jobs key={nav.jobService} />;
  }
  return null;
}
