import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { api } from "../api";
import { AuthLayout } from "../components/AuthLayout";

const RESEND_WAIT_S = 60;

type Step =
  | { name: "details" }
  | { name: "otp"; registrationId: string; email: string }
  | { name: "done"; identifier: string };

type Form = { displayName: string; identifier: string; email: string; credential: string; confirm: string };

export function Register({ onBack, onRegistered }: { onBack: () => void; onRegistered: (identifier: string) => void }) {
  const [enabled, setEnabled] = useState<boolean | "error" | null>(null);
  const [step, setStep] = useState<Step>({ name: "details" });
  const [form, setForm] = useState<Form>({ displayName: "", identifier: "", email: "", credential: "", confirm: "" });
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [domain, setDomain] = useState("");
  const [fixedEmail, setFixedEmail] = useState("");

  useEffect(() => {
    api<{ enabled?: boolean; domain?: string; email?: string } | null>("GET", "/api/register/status")
      .then((s) => {
        setDomain(s?.domain ?? "");
        setFixedEmail(s?.email ?? "");
        setEnabled(typeof s?.enabled == "boolean" ? s.enabled : "error");
      })
      .catch(() => setEnabled("error"));
  }, []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const field = (key: keyof Form) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });
  const onLocalPart = (e: ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, email: e.target.value.split("@")[0].replace(/\s/g, "") });

  async function run(task: () => Promise<void>) {
    setError("");
    setInfo("");
    setBusy(true);
    try {
      await task();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function start(e: FormEvent) {
    e.preventDefault();
    if (form.credential !== form.confirm) {
      setError("The two passwords do not match.");
      return;
    }
    run(async () => {
      const r = await api<{ registrationId: string; email: string }>("POST", "/api/register/start", {
        displayName: form.displayName.trim(),
        identifier: form.identifier.trim().toLowerCase(),
        email: fixedEmail || (domain ? `${form.email.trim().toLowerCase()}@${domain}` : form.email.trim()),
        credential: form.credential,
      });
      setStep({ name: "otp", registrationId: r.registrationId, email: r.email });
      setCode("");
      setCooldown(RESEND_WAIT_S);
      setInfo(`We sent a 6-digit code to ${r.email}. It expires in 10 minutes.`);
    });
  }

  function verify(e: FormEvent) {
    e.preventDefault();
    if (step.name !== "otp") return;
    run(async () => {
      const r = await api<{ identifier: string }>("POST", "/api/register/verify", {
        registrationId: step.registrationId,
        code: code.trim(),
      });
      setStep({ name: "done", identifier: r.identifier });
    });
  }

  function resend() {
    if (step.name !== "otp") return;
    run(async () => {
      await api("POST", "/api/register/resend", { registrationId: step.registrationId });
      setCooldown(RESEND_WAIT_S);
      setInfo(`A new code was sent to ${step.email}.`);
    });
  }

  const signInLink = (
    <p className="auth-foot">
      Already have an account?{" "}
      <a href="#" onClick={(e) => (e.preventDefault(), onBack())}>
        Sign in
      </a>
    </p>
  );

  if (step.name === "done")
    return (
      <AuthLayout>
        <h1>Account created</h1>
        <p className="sub">
          Your Super Admin account <b>{step.identifier}</b> is ready. Sign in with your User ID or email and the password you chose.
        </p>
        <button className="btn primary" onClick={() => onRegistered(step.identifier)}>
          Continue to sign in
        </button>
      </AuthLayout>
    );

  if (step.name === "otp" && enabled === true)
    return (
      <AuthLayout>
        <h1>Verify your email</h1>
        <p className="sub">{info || `Enter the 6-digit code we sent to ${step.email}.`}</p>
        <form onSubmit={verify}>
          <label htmlFor="reg-code">Verification code</label>
          <input
            id="reg-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="••••••"
            style={{ fontSize: 24, letterSpacing: 10, textAlign: "center" }}
            autoFocus
          />
          <button className="btn primary" disabled={busy || code.length !== 6}>
            {busy ? "Verifying…" : "Verify and create account"}
          </button>
          <div className="err">{error}</div>
        </form>
        <p className="auth-foot" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setStep({ name: "details" });
              setError("");
              setInfo("");
            }}
          >
            Change details
          </a>
          {cooldown > 0 ? (
            <span>Resend code in {cooldown}s</span>
          ) : (
            <a href="#" onClick={(e) => (e.preventDefault(), !busy && resend())}>
              Resend code
            </a>
          )}
        </p>
      </AuthLayout>
    );

  return (
    <AuthLayout>
      <h1>Create Super Admin account</h1>
      {enabled === null && <p className="sub">Checking…</p>}
      {enabled === false && (
        <>
          <p className="sub">Registration is turned off on this server. Ask your Super Admin to create your account.</p>
          {signInLink}
        </>
      )}
      {enabled === "error" && (
        <>
          <p className="sub">Could not reach the server. Please check your connection and try again.</p>
          {signInLink}
        </>
      )}
      {enabled === true && (
        <>
          <p className="sub">Choose your User ID and password. We'll send a verification code to the email below.</p>
          <form onSubmit={start}>
            <label htmlFor="reg-name">Full name</label>
            <input
              id="reg-name"
              value={form.displayName}
              onChange={field("displayName")}
              placeholder="e.g. Sara Ahmed"
              autoComplete="name"
            />
            <label htmlFor="reg-id">User ID</label>
            <input
              id="reg-id"
              value={form.identifier}
              onChange={field("identifier")}
              placeholder="e.g. sara.admin"
              autoComplete="username"
              required
            />
            <label htmlFor="reg-email">Email</label>
            {fixedEmail ? (
              <input id="reg-email" className="locked" value={fixedEmail} readOnly tabIndex={-1} />
            ) : domain ? (
              <div className="email-field">
                <input
                  id="reg-email"
                  value={form.email}
                  onChange={onLocalPart}
                  placeholder="your.name"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                />
                <span>@{domain}</span>
              </div>
            ) : (
              <input
                id="reg-email"
                type="email"
                value={form.email}
                onChange={field("email")}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            )}
            <label htmlFor="reg-pass">Password</label>
            <div className="pw-field">
              <input
                id="reg-pass"
                type={showPass ? "text" : "password"}
                value={form.credential}
                onChange={field("credential")}
                placeholder="6+ characters, a letter and a symbol (@ # !)"
                autoComplete="new-password"
                required
              />
              <button type="button" className="pw-toggle" onClick={() => setShowPass((s) => !s)}>
                {showPass ? "Hide" : "Show"}
              </button>
            </div>
            <label htmlFor="reg-confirm">Confirm password</label>
            <input
              id="reg-confirm"
              type={showPass ? "text" : "password"}
              value={form.confirm}
              onChange={field("confirm")}
              placeholder="Re-enter your password"
              autoComplete="new-password"
              required
            />
            <button className="btn primary" disabled={busy}>
              {busy ? "Sending code…" : "Send verification code"}
            </button>
            <div className="err">{error}</div>
          </form>
          {signInLink}
        </>
      )}
    </AuthLayout>
  );
}
