import { useState, type FormEvent } from "react";
import { api, setApiToken, signIn } from "../api";
import { AuthLayout } from "../components/AuthLayout";
import { permissions } from "../permissions";
import type { Course, Session } from "../types";

export function SignIn({
  onSignedIn,
  onRegister,
  initialUser,
}: {
  onSignedIn: (session: Session, courses: Course[]) => void;
  onRegister: () => void;
  initialUser?: string;
}) {
  const [user, setUser] = useState(initialUser ?? "");
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const session = await signIn(user.trim().toLowerCase(), pass.trim());
      setApiToken(session.token);
      const courses = await api<Course[]>("GET", "/api/courses").catch(() => []);
      const p = permissions(session);
      if (p.isFieldUser() && !p.isAdmin()) {
        location.href = "/m";
        return;
      }
      onSignedIn(session, courses);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h1>Welcome back</h1>
      <p className="sub">Sign in to your Westcal account to continue.</p>
      <form onSubmit={submit}>
        <label htmlFor="signin-user">User ID or email</label>
        <input
          id="signin-user"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder="Enter your User ID or email"
          autoComplete="username"
          autoFocus={!initialUser}
          required
        />
        <label htmlFor="signin-pass">Password</label>
        <div className="pw-field">
          <input
            id="signin-pass"
            type={showPass ? "text" : "password"}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="Enter your password"
            autoComplete="current-password"
            autoFocus={!!initialUser}
            required
          />
          <button type="button" className="pw-toggle" onClick={() => setShowPass((s) => !s)}>
            {showPass ? "Hide" : "Show"}
          </button>
        </div>
        <button className="btn primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <div className="err">{error}</div>
      </form>
      <p className="auth-foot">
        New Super Admin?{" "}
        <a href="#" onClick={(e) => (e.preventDefault(), onRegister())}>
          Create an account
        </a>
      </p>
    </AuthLayout>
  );
}
