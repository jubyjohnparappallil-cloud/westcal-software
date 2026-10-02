import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { api } from "../../api";
import "../../styles.css";

interface JoinInfo {
  open: boolean;
  closedReason?: string;
  course?: string;
  courses?: string[];
  companies?: string[];
  customerName?: string;
  trainingDate?: string;
}
interface Slot {
  name?: string;
  idOrVisaNo?: string;
  mobileNumber?: string;
  company?: string;
  course?: string;
}

function SignaturePad({
  onChange,
  height = 240,
  clearLabel = "Clear signature",
}: {
  onChange: (dataUrl: string | null) => void;
  height?: number;
  clearLabel?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const reset = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let drawing = false;
    function setup() {
      const ratio = window.devicePixelRatio || 1;
      const box = canvas.getBoundingClientRect();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      canvas.width = Math.max(1, Math.round(box.width * ratio));
      canvas.height = Math.max(1, Math.round(box.height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineWidth = 2.6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#12203a";
      onChangeRef.current(null);
    }
    reset.current = setup;
    setup();
    const point = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => {
      e.preventDefault();
      drawing = true;
      const p = point(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {}
    };
    const move = (e: PointerEvent) => {
      if (!drawing) return;
      e.preventDefault();
      const p = point(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    };
    const up = () => {
      if (!drawing) return;
      drawing = false;
      onChangeRef.current(canvas.toDataURL("image/png"));
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    window.addEventListener("resize", setup);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      window.removeEventListener("resize", setup);
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="sig-pad" style={{ height }} />
      <button className="btn sec wide" type="button" style={{ marginTop: 10 }} onClick={() => reset.current()}>
        {clearLabel}
      </button>
    </>
  );
}

export function TraineeJoin({ token, editToken }: { token: string; editToken: string }) {
  const [state, setState] = useState<{ info: JoinInfo; slot: Slot | null } | { error: string } | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    document.title = "Westcal training — trainee sign-in";
    (async () => {
      try {
        const info = await api<JoinInfo>("GET", "/api/public/join/" + token);
        const slot = editToken ? await api<Slot>("GET", `/api/public/join/${token}/slot/${editToken}`) : null;
        setState({ info, slot });
      } catch (e) {
        setState({ error: (e as Error).message });
      }
    })();
  }, [token, editToken]);

  let body: ReactNode;
  if (!state) body = <p className="muted">Loading…</p>;
  else if ("error" in state) body = <p className="err">{state.error}</p>;
  else if (!state.info.open) body = <p>{state.info.closedReason || "This link is closed."}</p>;
  else if (sent) body = <p className="ok-msg">Sent. Your name is on the attendance sheet.</p>;
  else
    body = (
      <JoinForm token={token} editToken={editToken} info={state.info} slot={state.slot} onSent={() => setSent(true)} />
    );

  return (
    <div className="public-page">
      <div className="public-card">
        <div className="wc-top">
          <div className="wc-ct">
            T: +9714 576 2773
            <br />
            M: +971 56 665 4326
            <br />
            E: training@westcal.ae
            <br />
            W: www.westcal.ae
          </div>
          <img src="/logo.jpg" alt="WESTCAL" />
        </div>
        <div className="wc-bar">WESTCAL INSTRUMENTATION AND CALIBRATION SERVICES LLC</div>
        <div className="public-inner">{body}</div>
      </div>
    </div>
  );
}

function JoinForm({
  token,
  editToken,
  info,
  slot,
  onSent,
}: {
  token: string;
  editToken: string;
  info: JoinInfo;
  slot: Slot | null;
  onSent: () => void;
}) {
  const courses = info.courses || [info.course].filter((c): c is string => !!c);
  const companies = info.companies || [info.customerName].filter((c): c is string => !!c);
  const [f, setF] = useState({
    name: slot?.name || "",
    id: slot?.idOrVisaNo || "",
    dob: "",
    nat: "",
    mob: slot?.mobileNumber || "",
    company: (slot && slot.company) || companies[0] || "",
  });
  const [picked, setPicked] = useState<string[]>(() =>
    courses.length > 1 ? courses.filter((c) => (slot ? slot.course === c : true)) : courses.slice(0, 1),
  );
  const [signature, setSignature] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  async function send() {
    setErr("");
    const mob = f.mob.replace(/[\s\-+]/g, "");
    if (!f.name.trim()) return setErr("Name is required.");
    if (!signature) return setErr("Please sign.");
    const payload = {
      name: f.name,
      company: f.company,
      idOrVisaNo: f.id,
      nationality: f.nat,
      mobileNumber: mob,
      dateOfBirth: f.dob || undefined,
      signature,
      courses: picked,
      course: picked[0],
    };
    setBusy(true);
    try {
      if (editToken && slot) await api("PATCH", `/api/public/join/${token}/attendees/${editToken}`, payload);
      else await api("POST", `/api/public/join/${token}/attendees`, payload);
      onSent();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <h2 style={{ margin: "0 0 6px" }}>Trainee sign-in</h2>
      <p className="muted">
        {info.course || ""} · {info.trainingDate || ""} · {info.customerName || ""}
      </p>
      <p className="muted">Check your details, sign with your finger, then send.</p>
      <label>Full name *</label>
      <input value={f.name} onChange={set("name")} />
      <label>Emirates ID / Visa no</label>
      <input value={f.id} onChange={set("id")} />
      <label>Date of birth</label>
      <input type="date" value={f.dob} onChange={set("dob")} />
      <label>Nationality</label>
      <input value={f.nat} onChange={set("nat")} />
      <label>Phone number *</label>
      <input value={f.mob} inputMode="tel" onChange={set("mob")} />
      <label>Your company *</label>
      {companies.length > 1 ? (
        <select value={f.company} onChange={set("company")}>
          {companies.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      ) : (
        <input value={f.company} onChange={set("company")} />
      )}
      {courses.length > 1 && (
        <>
          <label>Training course *</label>
          {courses.map((c) => (
            <label key={c} className="checkline" style={{ display: "block", fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={picked.includes(c)}
                onChange={(e) => setPicked(e.target.checked ? [...picked, c] : picked.filter((x) => x !== c))}
              />{" "}
              {c}
            </label>
          ))}
        </>
      )}
      <div className="sign-box">
        <p className="muted" style={{ margin: "0 0 8px" }}>
          <b>Sign here</b> — draw with your finger
        </p>
        <SignaturePad onChange={setSignature} />
        <button className="btn wide" type="button" style={{ marginTop: 10 }} disabled={busy} onClick={send}>
          Send
        </button>
        <div className="err">{err}</div>
      </div>
    </>
  );
}
