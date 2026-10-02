import { useState } from "react";
import { api } from "../../api";
import { downloads } from "../../lib/downloads";
import type { Job } from "../../types";
import {
  normalizeTempRange,
  PROTOCOL_LABELS,
  protocolFromJob,
  protocolToJob,
  sheetsFromJob,
  sheetsToJob,
  splitSeason,
  type Protocol,
  type ProtocolKey,
} from "./mappingData";
import { LayoutUpload, MappingRanges, ProtocolFields, ProtocolPreview, ProtocolSheetsEditor, type RangeValues } from "./ProtocolEditor";

export function ProtocolDetails({ job, editable, onSaved }: { job: Job; editable: boolean; onSaved: () => void }) {
  const defaults = protocolFromJob(job);
  if (editable) return <ProtocolDetailsForm job={job} defaults={defaults} onSaved={onSaved} />;
  return (
    <>
      <div className="sect">Protocol details</div>
      <div className="grid">
        {PROTOCOL_LABELS.map(([k, label]) => (
          <div key={k}>
            <label>{label}</label>
            {defaults[k] || "-"}
          </div>
        ))}
      </div>
    </>
  );
}

function ProtocolDetailsForm({ job, defaults, onSaved }: { job: Job; defaults: Protocol; onSaved: () => void }) {
  const season = splitSeason(job.seasonYear || "");
  const [ranges, setRanges] = useState<RangeValues>({
    tempRange: normalizeTempRange(job.mappingRange || ""),
    humRange: job.maxHumRange || "",
    season: season.season,
    year: season.year,
  });
  const [p, setP] = useState(defaults);
  const [sheets, setSheets] = useState(() => sheetsFromJob(job));
  const [preview, setPreview] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Protocol>) => setP((x) => ({ ...x, ...patch }));
  const field = (k: ProtocolKey, label: string, type = "text") => (
    <div>
      <label>{label}</label>
      <input type={type} value={p[k]} onChange={(e) => set({ [k]: e.target.value })} />
    </div>
  );

  async function save(generate: boolean) {
    setErr("");
    if (!ranges.tempRange) return setErr("Choose the temperature range, or use Add.");
    if (!ranges.humRange) return setErr("Choose the humidity range, or use Add.");
    if (!ranges.season) return setErr("Choose the season, or use Add.");
    if (!ranges.year.trim()) return setErr("Enter the year for the season.");
    setBusy(true);
    try {
      await api("PATCH", `/api/training/${job.id}`, {
        ...protocolToJob(p),
        seasonYear: [ranges.season, ranges.year.trim()].filter(Boolean).join(" "),
        mappingRange: ranges.tempRange,
        maxHumRange: ranges.humRange,
        ...sheetsToJob(sheets),
      });
      if (generate) await downloads.mappingProtocol(job.id);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="job-form">
      <div className="sect">Protocol details</div>
      <p className="hint">These fields are filled when you open the job. Change any value, then save. The protocol report prints exactly what is saved here.</p>
      <div className="grid">
        <MappingRanges {...ranges} onChange={(patch) => setRanges((r) => ({ ...r, ...patch }))} />
        {field("company", "Company name")}
        {field("dimension", "Dimension of the asset")}
        {field("days", "No. of days to be mapped")}
        {field("end_time", "End time", "time")}
      </div>
      <ProtocolFields p={p} set={set} onPreview={() => setPreview(true)} />
      <LayoutUpload sheets={sheets} setSheets={setSheets} />
      <ProtocolSheetsEditor sheets={sheets} setSheets={setSheets} logger={p.logger_name || "Tempnix"} />
      <p style={{ marginTop: 10 }}>
        <button className="btn sec sm" disabled={busy} onClick={() => save(false)}>
          Save protocol details
        </button>
        <button className="btn sm" style={{ marginLeft: 8 }} disabled={busy} onClick={() => save(true)}>
          Save and generate protocol
        </button>
      </p>
      <div className="err">{err}</div>
      {preview && <ProtocolPreview p={p} set={set} sheets={sheets} setSheets={setSheets} onClose={() => setPreview(false)} />}
    </div>
  );
}
