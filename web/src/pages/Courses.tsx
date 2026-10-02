import { useState } from "react";
import { api } from "../api";
import { useApp, usePageData } from "../app-context";
import { PageError, PageLoading } from "../components/PageLoading";
import { Pagination, usePaged } from "../components/Pagination";
import type { Course } from "../types";

/** Back link plus the Training sub-tabs (Jobs, Courses, Trainers & Engineers, Reports, Certificates). */
export function TrainingTabs() {
  const { nav, perms, go, goToCertificates } = useApp();
  const back = (
    <p>
      <button className="btn ghost sm" onClick={() => go("dashboard")}>
        ← Dashboard
      </button>
    </p>
  );
  if (nav.jobService !== "Training") return back;
  const tab = (id: string, label: string) => (
    <button className={nav.trainingTab === id ? "on" : ""} onClick={() => go("jobs", { trainingTab: id })}>
      {label}
    </button>
  );
  return (
    <>
      {back}
      <div className="subtabs">
        {tab("jobs", "Jobs")}
        {perms.isSuper() && tab("courses", "Courses")}
        {perms.isSuper() && tab("people", "Trainers & Engineers")}
        {perms.canReports() && <button onClick={() => go("reports")}>Reports</button>}
        {perms.canViewCerts() && <button onClick={() => goToCertificates("pending")}>Certificates</button>}
      </div>
    </>
  );
}

export function Courses() {
  const { setCourses } = useApp();
  const { loading, data, error, reload } = usePageData(async () => {
    const list = await api<Course[]>("GET", "/api/courses");
    setCourses(list);
    return list;
  });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState("");
  const paged = usePaged(data || []);
  if (loading) return <PageLoading />;
  if (error || !data) return <PageError message={error} onRetry={reload} />;
  const courses = data;

  async function add() {
    setErr("");
    try {
      await api("POST", "/api/courses", { name: name.trim(), description: description.trim() });
      setName("");
      setDescription("");
      reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function remove(c: Course) {
    if (typeof c == "string" || !c.id) return;
    if (!confirm(`Remove course "${c.name || "this course"}" from the dropdown?`)) return;
    try {
      await api("DELETE", "/api/courses/" + c.id);
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <>
      <TrainingTabs />
      <div className="card">
        <h3>Add a training course</h3>
        <p className="hint">
          New courses appear in the Course dropdown on the Jobs tab. This is the same master list as the WESTCAL spreadsheet.
        </p>
        <div className="grid">
          <div>
            <label>Course name *</label>
            <input value={name} placeholder="e.g. Working at Height" onChange={(e) => setName(e.target.value)} />
          </div>
          <div style={{ gridColumn: "1/-1" }}>
            <label>Description</label>
            <textarea
              rows={2}
              value={description}
              placeholder="Shown automatically in the job description box"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <button className="btn dark" style={{ marginTop: 16 }} onClick={add}>
          Add course
        </button>
        <div className="err">{err}</div>
      </div>
      <div className="card">
        <h3>Courses ({courses.length})</h3>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Course name</th>
              <th>Description</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {paged.rows.map((c, i) => (
              <tr key={typeof c == "string" ? c : c.id || c.name}>
                <td>{(paged.page - 1) * paged.size + i + 1}</td>
                <td>{typeof c == "string" ? c : c.name}</td>
                <td>{typeof c == "string" ? "" : c.description || ""}</td>
                <td>
                  {typeof c != "string" && c.id && (
                    <button className="btn ghost sm" onClick={() => remove(c)}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination {...paged} />
      </div>
    </>
  );
}
