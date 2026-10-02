import { useState } from "react";
import { api } from "../api";
import { usePageData } from "../app-context";
import { PageError, PageLoading } from "../components/PageLoading";
import { Pagination, usePaged } from "../components/Pagination";
import { presetPermissions, type User } from "../lib/roles";
import { TrainingTabs } from "./Courses";

export function Trainers() {
  const { loading, data, error, reload } = usePageData(() => api<User[]>("GET", "/api/users"));
  const [f, setF] = useState({ id: "", name: "", pw: "pw", role: "role-trainer" });
  const [err, setErr] = useState("");
  const people = (data || []).filter((u) => u.roleIds.includes("role-trainer") || u.roleIds.includes("role-site-engineer"));
  const paged = usePaged(people);
  if (loading) return <PageLoading />;
  if (error || !data) return <PageError message={error} onRetry={reload} />;

  async function create() {
    setErr("");
    const identifier = f.id.trim();
    try {
      await api("POST", "/api/users", {
        identifier,
        displayName: f.name.trim() || identifier,
        credential: f.pw.trim() || "pw",
        roleIds: [f.role],
        permissions: presetPermissions(f.role),
      });
      setF({ id: "", name: "", pw: "pw", role: f.role });
      reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function remove(u: User) {
    if (!confirm(`Delete "${u.identifier}"?`)) return;
    try {
      await api("DELETE", `/api/users/${u.id}`);
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <>
      <TrainingTabs />
      <div className="card">
        <h3>Add trainer or site engineer</h3>
        <p className="hint">
          They can sign in on the PWA at /m. Trainers get training jobs; site engineers get testing, calibration and inspection jobs.
        </p>
        <div className="grid">
          <div>
            <label>Username *</label>
            <input value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })} />
          </div>
          <div>
            <label>Full name *</label>
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
          <div>
            <label>Password</label>
            <input value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} />
          </div>
          <div>
            <label>Role</label>
            <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              <option value="role-trainer">Trainer</option>
              <option value="role-site-engineer">Site Engineer</option>
            </select>
          </div>
        </div>
        <button className="btn" style={{ marginTop: 16 }} onClick={create}>
          Create account
        </button>
        <div className="err">{err}</div>
      </div>
      <div className="card">
        <h3>Trainers & site engineers ({people.length})</h3>
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {paged.rows.map((u) => (
              <tr key={u.id}>
                <td>{u.identifier}</td>
                <td>{u.displayName}</td>
                <td>{u.roleIds.includes("role-trainer") ? "Trainer" : "Site Engineer"}</td>
                <td>
                  <span className="chip">{u.status}</span>
                </td>
                <td>
                  {u.identifier !== "admin" && (
                    <button className="btn ghost sm" onClick={() => remove(u)}>
                      Delete
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
