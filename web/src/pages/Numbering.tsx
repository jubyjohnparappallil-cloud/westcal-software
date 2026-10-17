import { useState } from "react";
import { api } from "../api";
import { usePageData } from "../app-context";
import { PageError, PageLoading } from "../components/PageLoading";
import { TrainingTabs } from "./Courses";

interface NumberingPreview {
  nextTr: string;
  exampleJobNo: string;
  exampleCert: string;
}

export function Numbering() {
  const { loading, data, error, reload } = usePageData(() => api<NumberingPreview>("GET", "/api/training/numbering"));
  const [nextTr, setNextTr] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const shown = nextTr || data?.nextTr || "";

  async function save() {
    setErr("");
    setOk("");
    try {
      const saved = await api<NumberingPreview>("PUT", "/api/training/numbering", { nextTr: shown });
      setNextTr(saved.nextTr);
      setOk("Next TR number is saved. New training jobs use this number, then it goes up by one.");
      reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (loading && !data) return <PageLoading />;
  if (error || !data) return <PageError message={error} onRetry={reload} />;

  return (
    <>
      <TrainingTabs />
      <div className="card">
        <h3>TR numbers</h3>
        <p className="hint">
          Super Admin sets the next TR number here. New jobs take that number automatically. It prints as Job No on the certificate. Certificate numbers follow WC-TRXXXX-01, then 02, 03 on the same job.
        </p>
        <div className="grid">
          <div>
            <label>Next TR number</label>
            <input
              value={shown}
              placeholder="TR 4522"
              onChange={(e) => {
                setNextTr(e.target.value);
                setOk("");
              }}
            />
          </div>
        </div>
        <p className="hint" style={{ marginTop: 12 }}>
          Next job Job No: <b>{data.exampleJobNo}</b>
          <br />
          First certificate: <b>{data.exampleCert}</b>
        </p>
        <button className="btn dark" style={{ marginTop: 16 }} onClick={save}>
          Save next TR number
        </button>
        <div className="err">{err}</div>
        {ok && <p className="ok-msg">{ok}</p>}
      </div>
    </>
  );
}
