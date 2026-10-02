import { useState } from "react";
import { Modal } from "../components/Modal";
import { api } from "../api";
import { usePageData } from "../app-context";
import { PageError, PageLoading } from "../components/PageLoading";
import { Pagination, usePaged } from "../components/Pagination";
import { ALL_MODULES, initialModules, ModuleAccess, modulesPayload } from "../components/ModuleAccess";
import { initialPermSet, PermMatrix, permSetToPayload } from "../components/PermMatrix";
import { ROLE_NAMES } from "../constants";
import { PRESET, ROLE_HELP, type User } from "../lib/roles";

export function Users() {
  const { loading, data, error, reload } = usePageData(() => api<User[]>("GET", "/api/users"));
  const [role, setRole] = useState("role-front-desk");
  const [perms, setPerms] = useState(() => initialPermSet(PRESET["role-front-desk"]));
  const [modules, setModules] = useState(() => initialModules(undefined));
  const [form, setForm] = useState({ id: "", name: "", pw: "" });
  const [showPerms, setShowPerms] = useState(false);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<User | null>(null);
  const [editingBasic, setEditingBasic] = useState<User | null>(null);
  const [passwordUser, setPasswordUser] = useState<User | null>(null);
  const newestFirst = (data || [])
    .map((u, i) => ({ u, i }))
    .sort((a, b) => (Date.parse(b.u.createdAt || "") || 0) - (Date.parse(a.u.createdAt || "") || 0) || b.i - a.i)
    .map(({ u }) => u);
  const paged = usePaged(newestFirst, newestFirst.length);

  if (loading) return <PageLoading />;
  if (error || !data) return <PageError message={error} onRetry={reload} />;
  const users = data;

  function pickRole(id: string) {
    setRole(id);
    setPerms(initialPermSet(PRESET[id] || []));
  }

  async function createUser() {
    setErr("");
    if (!form.name.trim() || !form.id.trim()) return setErr("Enter the full name and username.");
    if (form.pw.length < 6) return setErr("Password must be at least 6 characters.");
    if (!modules.size) return setErr("Tick at least one module this person can use.");
    try {
      await api("POST", "/api/users", {
        identifier: form.id,
        displayName: form.name || form.id,
        credential: form.pw,
        roleIds: [role],
        permissions: permSetToPayload(perms),
        modules: modulesPayload(modules),
      });
      setForm({ id: "", name: "", pw: "" });
      setShowPerms(false);
      setModules(initialModules(undefined));
      reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function delUser(u: User) {
    if (!confirm(`Delete user "${u.identifier}"?`)) return;
    try {
      await api("DELETE", `/api/users/${u.id}`);
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <>
      {editing && (
        <EditPerms
          key={editing.id}
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {passwordUser && (
        <Modal
          key={passwordUser.id}
          title={`Change password: ${passwordUser.displayName}`}
          subtitle={`Username: ${passwordUser.identifier}`}
          onClose={() => setPasswordUser(null)}
        >
          <div style={{ padding: "0 24px 24px" }}>
            <ResetPassword user={passwordUser} />
          </div>
        </Modal>
      )}
      {editingBasic && (
        <EditUser
          key={editingBasic.id}
          user={editingBasic}
          onClose={() => setEditingBasic(null)}
          onSaved={() => {
            setEditingBasic(null);
            reload();
          }}
        />
      )}
      <div className="card">
        <h3>Add a person</h3>
        <div className="staff-form">
          <div>
            <label>Full name *</label>
            <input value={form.name} placeholder="e.g. Sara Ahmed" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label>Username *</label>
            <input value={form.id} placeholder="e.g. sara.desk" onChange={(e) => setForm({ ...form, id: e.target.value })} />
          </div>
          <div>
            <label>Password *</label>
            <input
              type="password"
              autoComplete="new-password"
              value={form.pw}
              placeholder="At least 6 characters"
              onChange={(e) => setForm({ ...form, pw: e.target.value })}
            />
          </div>
          <div>
            <label>Role *</label>
            <select value={role} onChange={(e) => pickRole(e.target.value)}>
              {ROLE_HELP.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="hint" style={{ marginTop: 6 }}>{ROLE_HELP.find((r) => r.id === role)?.who}</p>

        <label style={{ marginTop: 12 }}>Modules</label>
        <ModuleAccess value={modules} onChange={setModules} />

        <div className="staff-actions">
          <button className="btn" onClick={createUser}>
            Create person
          </button>
          <button type="button" className="btn sec sm" onClick={() => setShowPerms(!showPerms)}>
            {showPerms ? "Hide permissions" : "More permissions"}
          </button>
        </div>
        {showPerms && (
          <div style={{ marginTop: 12 }}>
            <PermMatrix value={perms} onChange={setPerms} />
          </div>
        )}
        <div className="err">{err}</div>
      </div>
      <div className="card">
        <h3>People ({users.length})</h3>
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Modules</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {paged.rows.map((u) => (
              <tr key={u.id}>
                <td>{u.identifier}</td>
                <td>{u.displayName}</td>
                <td>{u.email || "-"}</td>
                <td>{u.roleIds.map((r) => ROLE_NAMES[r] || r.replace("role-", "").replace(/-/g, " ")).join(", ")}</td>
                <td>
                  {u.roleIds.includes("role-super-admin") || !u.modules?.length
                    ? "All"
                    : ALL_MODULES.filter((m) => u.modules!.includes(m.id))
                        .map((m) => m.id)
                        .join(", ")}
                </td>
                <td>
                  <span className="chip">{u.status}</span>
                </td>
                <td>
                  <button className="btn sec sm" onClick={() => setPasswordUser(u)}>
                    Password
                  </button>{" "}
                  {u.identifier !== "admin" && (
                    <>
                      <button className="btn sm" onClick={() => setEditingBasic(u)}>
                        Edit
                      </button>{" "}
                      <button className="btn dark sm" onClick={() => setEditing(u)}>
                        Access
                      </button>{" "}
                      <button className="btn ghost sm" onClick={() => delUser(u)}>
                        Delete
                      </button>
                    </>
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

function EditPerms({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: () => void }) {
  const [perms, setPerms] = useState(() => initialPermSet(user.permissions));
  const [modules, setModules] = useState(() => initialModules(user.modules));
  const [err, setErr] = useState("");

  async function save() {
    setErr("");
    if (!modules.size) return setErr("Tick at least one module this person can use.");
    try {
      await api("POST", `/api/users/${user.id}/permissions`, {
        permissions: permSetToPayload(perms),
        modules: modulesPayload(modules),
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <Modal
      title={`Access for ${user.displayName}`}
      subtitle={`Username: ${user.identifier}`}
      width={760}
      onClose={onClose}
    >
      <div style={{ padding: "8px 24px 24px" }}>
      <label>Modules this person can use</label>
      <ModuleAccess value={modules} onChange={setModules} />
      <p className="hint">If only one module is ticked, this person sees and works only in that module.</p>
      <label style={{ marginTop: 14 }}>Permissions</label>
      <PermMatrix value={perms} onChange={setPerms} />
      <ResetPassword user={user} />
      <div className="err">{err}</div>
      <div className="staff-actions">
        <button className="btn dark" onClick={save}>
          Save access
        </button>
        <button className="btn sec sm" onClick={onClose}>
          Cancel
        </button>
      </div>
      </div>
    </Modal>
  );
}

function ResetPassword({ user }: { user: User }) {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState({ ok: false, text: "" });

  async function reset() {
    setMsg({ ok: false, text: "" });
    if (pw.length < 6 || !/[a-z]/i.test(pw) || !/[^a-z0-9]/i.test(pw)) {
      return setMsg({ ok: false, text: "Use 6+ characters with a letter and a special character." });
    }
    try {
      await api("POST", `/api/users/${user.id}/password`, { password: pw });
      setPw("");
      setMsg({ ok: true, text: `New password saved. ${user.identifier} signs in with it from now on.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <label>Reset password</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          type="password"
          autoComplete="new-password"
          value={pw}
          placeholder="New password for this person"
          style={{ flex: "1 1 220px" }}
          onChange={(e) => setPw(e.target.value)}
        />
        <button type="button" className="btn sec" onClick={reset}>
          Set new password
        </button>
      </div>
      {msg.text && (
        <p className={msg.ok ? "hint" : "err"} style={msg.ok ? { color: "#047857" } : undefined}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

function EditUser({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    displayName: user.displayName || "",
    identifier: user.identifier || "",
    email: user.email || "",
  });
  const [role, setRole] = useState(user.roleIds[0] || "role-front-desk");
  const [err, setErr] = useState("");

  async function save() {
    setErr("");
    if (!form.displayName.trim() || !form.identifier.trim()) {
      return setErr("Name and username are required.");
    }
    try {
      await api("PUT", `/api/users/${user.id}`, {
        displayName: form.displayName,
        identifier: form.identifier,
        email: form.email,
        roleIds: [role],
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <Modal title={`Edit User: ${user.displayName}`} onClose={onClose}>
      <div className="staff-form">
        <div>
          <label>Full name *</label>
          <input
            value={form.displayName}
            placeholder="e.g. Sara Ahmed"
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
        </div>
        <div>
          <label>Username *</label>
          <input
            value={form.identifier}
            placeholder="e.g. sara.desk"
            onChange={(e) => setForm({ ...form, identifier: e.target.value })}
          />
        </div>
        <div>
          <label>Email</label>
          <input
            type="email"
            value={form.email}
            placeholder="user@example.com"
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div>
          <label>Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLE_HELP.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} — {r.who}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ResetPassword user={user} />
      <div className="err">{err}</div>
      <div className="staff-actions">
        <button className="btn ok" onClick={save}>
          Save Changes
        </button>
        <button className="btn sec sm" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
