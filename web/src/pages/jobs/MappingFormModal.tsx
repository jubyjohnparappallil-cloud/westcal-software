import { useEffect, useState, type ChangeEvent } from "react";
import { api } from "../../api";
import { useApp, usePageData } from "../../app-context";
import { Modal } from "../../components/Modal";
import { PageLoading } from "../../components/PageLoading";
import {
  emptyProtocol,
  MAPPING_LOCATIONS,
  MAPPING_TYPES,
  normalizeTempRange,
  protocolFromJob,
  protocolToJob,
  sheetsFromJob,
  sheetsToJob,
  splitSeason,
  nextKey,
  type Protocol,
  type Sheets,
} from "../../components/mapping/mappingData";
import { LayoutUpload, MappingRanges, ProtocolFields, ProtocolPreview, ProtocolSheetsEditor } from "../../components/mapping/ProtocolEditor";
import type { Assignee } from "../../lib/roles";
import type { Job } from "../../types";

interface MappingLoaded {
  assignees: Assignee[];
  nextOrder: string;
  editing: Job | null;
}

const MAPPING_DRAFT_KEY = "westcal.mappingJobDraft";

type MappingFields = {
  customer: string;
  addr: string;
  location: string;
  time: string;
  order: string;
  sales: string;
  handed: string;
  contact: string;
  required: string;
  assignee: string;
  designation: string;
  mapType: string;
  asset: string;
  tempRange: string;
  humRange: string;
  season: string;
  year: string;
};

function blankMappingFields(order: string): MappingFields {
  return {
    customer: "",
    addr: "",
    location: "",
    time: "",
    order,
    sales: "",
    handed: "",
    contact: "",
    required: "",
    assignee: "",
    designation: "",
    mapType: "",
    asset: "",
    tempRange: "",
    humRange: "",
    season: "",
    year: "",
  };
}

function readMappingDraft(): { f: Partial<MappingFields>; p: Partial<Protocol>; sheets: Sheets } | null {
  try {
    const raw = localStorage.getItem(MAPPING_DRAFT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { f?: Partial<MappingFields>; p?: Partial<Protocol>; sheets?: Sheets };
    if (!data?.f || !data.p || !data.sheets?.loggers || !data.sheets.temp || !data.sheets.hum || !data.sheets.chg) return null;
    return { f: data.f, p: data.p, sheets: data.sheets };
  } catch {
    return null;
  }
}

function withFreshKeys(sheets: Sheets): Sheets {
  return {
    layout: { touched: !!sheets.layout?.touched, value: String(sheets.layout?.value || "") },
    loggers: sheets.loggers.map((row) => ({ ...row, key: nextKey() })),
    temp: sheets.temp.map((row) => ({ ...row, key: nextKey() })),
    hum: sheets.hum.map((row) => ({ ...row, key: nextKey() })),
    chg: sheets.chg.map((row) => ({ ...row, key: nextKey() })),
  };
}

function writeMappingDraft(f: MappingFields, p: Protocol, sheets: Sheets) {
  const payload = { f, p, sheets };
  try {
    localStorage.setItem(MAPPING_DRAFT_KEY, JSON.stringify(payload));
  } catch {
    try {
      localStorage.setItem(
        MAPPING_DRAFT_KEY,
        JSON.stringify({ f, p, sheets: { ...sheets, layout: { touched: false, value: "" } } }),
      );
    } catch {
      /* The browser storage is full. The form still works for this visit. */
    }
  }
}

export function MappingFormModal({ editId, onClose, onSaved }: { editId?: string; onClose: () => void; onSaved: () => void }) {
  const { loading, data } = usePageData<MappingLoaded>(async () => {
    const [assignees, nextOrder, editing] = await Promise.all([
      api<Assignee[]>("GET", "/api/assignees").catch(() => [] as Assignee[]),
      editId
        ? Promise.resolve("")
        : api("GET", "/api/training/next-job-order?serviceType=Mapping")
            .then((r) => r.jobOrderNo as string)
            .catch(() => ""),
      editId ? api<Job>("GET", `/api/training/${editId}`).catch(() => null) : Promise.resolve(null),
    ]);
    return { assignees, nextOrder, editing };
  });
  return (
    <Modal
      title={`${editId ? "Edit" : "Add"} Mapping job`}
      subtitle={editId ? "Change the details, then save. Job number stays the same." : "Customer, when, engineer, then equipment."}
      onClose={onClose}
    >
      <div className="steps">
        <span>1 Company</span>
        <span>2 When & where</span>
        <span>3 Who</span>
        <span>4 Mapping type</span>
      </div>
      {loading || !data ? <PageLoading /> : <MappingForm editId={editId} loaded={data} onSaved={onSaved} />}
    </Modal>
  );
}

function MappingForm({ editId, loaded, onSaved }: { editId?: string; loaded: MappingLoaded; onSaved: () => void }) {
  const { perms } = useApp();
  const allowAddRows = perms.canAddMappingRows();
  const job = loaded.editing;
  const season = splitSeason(job?.seasonYear || "");
  const draft = editId ? null : readMappingDraft();
  const [f, setF] = useState<MappingFields>(() => {
    const saved = blankMappingFields(job ? job.jobOrderNo || "" : loaded.nextOrder);
    if (!editId) {
      return {
        ...saved,
        ...draft?.f,
        order: loaded.nextOrder,
      };
    }
    if (!job) return saved;
    return {
      ...saved,
      customer: job.customerName || "",
      addr: job.address || "",
      location: job.location || "",
      time: job.trainingTime || "",
      sales: job.salesPerson || "",
      handed: job.handedOverTo || "",
      contact: job.contactNameNumber || "",
      required: job.requiredDateForService || "",
      assignee: job.assigneeId || "",
      designation: job.engineerDesignation || "",
      mapType: job.mappingType || "",
      asset: job.assetName || "",
      tempRange: normalizeTempRange(job.mappingRange || ""),
      humRange: job.maxHumRange || "",
      season: season.season,
      year: season.year,
    };
  });
  const [p, setP] = useState<Protocol>(() => {
    if (!editId) return { ...emptyProtocol(), ...draft?.p };
    return job ? protocolFromJob(job) : emptyProtocol();
  });
  const [sheets, setSheets] = useState(() => (editId || !draft?.sheets ? sheetsFromJob(job) : withFreshKeys(draft.sheets)));
  const [assignees, setAssignees] = useState(loaded.assignees);
  const [newEngineer, setNewEngineer] = useState("");
  const [engineerMsg, setEngineerMsg] = useState({ text: "", ok: false });
  const [preview, setPreview] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const bind = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  useEffect(() => {
    if (editId) return;
    writeMappingDraft(f, p, sheets);
  }, [editId, f, p, sheets]);
  function clearDraft() {
    localStorage.removeItem(MAPPING_DRAFT_KEY);
    setF(blankMappingFields(loaded.nextOrder));
    setP(emptyProtocol());
    setSheets(sheetsFromJob(null));
  }
  const setProtocol = (patch: Partial<Protocol>) => setP((x) => ({ ...x, ...patch }));
  const engineers = assignees.filter((a) => a.roleName === "Site Engineer");
  const locations = f.location && !MAPPING_LOCATIONS.includes(f.location) ? [...MAPPING_LOCATIONS, f.location] : MAPPING_LOCATIONS;

  async function addEngineer() {
    setEngineerMsg({ text: "", ok: false });
    const name = newEngineer.trim();
    if (!name) return setEngineerMsg({ text: "Type the site engineer name.", ok: false });
    const identifier =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "")
        .slice(0, 24) || "engineer";
    try {
      const added = await api<Assignee>("POST", "/api/assignees", { displayName: name, identifier });
      const list = await api<Assignee[]>("GET", "/api/assignees");
      setAssignees(list);
      setF((x) => ({ ...x, assignee: added.id }));
      setNewEngineer("");
      setEngineerMsg({ text: name + " is added and selected.", ok: true });
    } catch (e) {
      setEngineerMsg({ text: (e as Error).message, ok: false });
    }
  }

  async function save() {
    setErr("");
    const customer = f.customer.trim();
    const scope = [f.mapType, f.tempRange].filter(Boolean).join(" · ");
    const body = {
      location: f.location,
      course: scope,
      customerName: customer,
      address: f.addr.trim(),
      contactNameNumber: f.contact.trim(),
      trainingTime: f.time,
      salesPerson: f.sales.trim(),
      clientRequirements: job?.clientRequirements || "",
      handedOverTo: f.handed.trim(),
      mappingType: f.mapType,
      mappingRange: f.tempRange,
      assetName: f.asset.trim(),
      seasonYear: [f.season, f.year.trim()].filter(Boolean).join(" "),
      engineerDesignation: f.designation.trim(),
      requiredDateForService: f.required,
      workCodeCalibration: !!job?.workCodeCalibration,
      workCodeSupply: !!job?.workCodeSupply,
      workCodeRepairing: !!job?.workCodeRepairing,
      ...protocolToJob(p),
      maxHumRange: f.humRange,
      ...sheetsToJob(sheets),
    };
    setBusy(true);
    try {
      let id = editId;
      if (editId) await api("PATCH", `/api/training/${editId}`, body);
      else id = (await api<Job>("POST", "/api/training", { serviceType: "Mapping", ...body })).id;
      if (f.assignee) await api("POST", `/api/training/${id}/assign`, { assigneeId: f.assignee });
      if (!editId) localStorage.removeItem(MAPPING_DRAFT_KEY);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="job-form">
      {!editId && (
        <p className="hint">
          What you type is kept as a draft. Closing this form will not lose it.{" "}
          <button type="button" className="btn ghost sm" onClick={clearDraft}>
            Clear draft
          </button>
        </p>
      )}
      <div className="job-block">
        <h4>1 · Customer</h4>
        <div className="job-row">
          <div className="span-2">
            <label>Customer name</label>
            <input value={f.customer} placeholder="Company name" onChange={bind("customer")} />
          </div>
          <div className="span-2">
            <label>Company name on the protocol</label>
            <input value={p.company} placeholder="Printed as company name" onChange={(e) => setProtocol({ company: e.target.value })} />
          </div>
        </div>
      </div>
      <div className="job-block">
        <h4>2 · When and where</h4>
        <div className="job-row">
          <div className="span-2">
            <label>Site address</label>
            <input value={f.addr} placeholder="Building, area, city" onChange={bind("addr")} />
          </div>
          <div>
            <label>Location</label>
            <select value={f.location} onChange={bind("location")}>
              <option value="">Choose location</option>
              {locations.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Start time</label>
            <input type="time" value={f.time} onChange={bind("time")} />
          </div>
          <div>
            <label>End time</label>
            <input type="time" value={p.end_time} onChange={(e) => setProtocol({ end_time: e.target.value })} />
          </div>
          <div>
            <label>No. of days to be mapped</label>
            <input value={p.days} placeholder="e.g. 3" onChange={(e) => setProtocol({ days: e.target.value })} />
          </div>
        </div>
      </div>
      <div className="job-block">
        <h4>3 · Who</h4>
        <div className="job-row">
          <div>
            <label>Job order no</label>
            <input value={f.order} readOnly />
          </div>
          <div>
            <label>Sales person</label>
            <input value={f.sales} placeholder="Name" onChange={bind("sales")} />
          </div>
          <div>
            <label>Handed over to</label>
            <input value={f.handed} placeholder="Name" onChange={bind("handed")} />
          </div>
          <div>
            <label>Contact</label>
            <input value={f.contact} placeholder="Name and mobile" onChange={bind("contact")} />
          </div>
          <div>
            <label>Required date for service</label>
            <input type="date" value={f.required} onChange={bind("required")} />
          </div>
        </div>
      </div>
      <div className="job-block">
        <h4>Site engineer</h4>
        <div className="job-row">
          <div className="span-2">
            <label>Westcal engineer name</label>
            <select value={f.assignee} onChange={bind("assignee")}>
              <option value="">Choose site engineer</option>
              {engineers.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                </option>
              ))}
            </select>
            <label style={{ marginTop: 14 }}>Designation</label>
            <input value={f.designation} placeholder="e.g. Site Engineer" onChange={bind("designation")} />
            <label style={{ marginTop: 14 }}>Add a new site engineer</label>
            <div className="add-row">
              <input
                value={newEngineer}
                placeholder="Type the engineer name"
                onChange={(e) => setNewEngineer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addEngineer();
                  }
                }}
              />
              <button type="button" className="btn sec" onClick={addEngineer}>
                Add
              </button>
            </div>
            <div className={engineerMsg.ok ? "ok-msg" : "err"}>{engineerMsg.text}</div>
          </div>
        </div>
      </div>
      <div className="job-block">
        <h4>4 · Type of mapping</h4>
        <div>
          <label>Type of mapping</label>
          <select value={f.mapType} onChange={bind("mapType")}>
            <option value="">Choose mapping type</option>
            {MAPPING_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="job-row" style={{ marginTop: 14 }}>
          <div>
            <label>Asset name</label>
            <input value={f.asset} placeholder="e.g. Warehouse cool room" onChange={bind("asset")} />
          </div>
          <div>
            <label>Dimension of the asset</label>
            <input value={p.dimension} placeholder="e.g. 20 m x 15 m" onChange={(e) => setProtocol({ dimension: e.target.value })} />
          </div>
          <MappingRanges
            tempRange={f.tempRange}
            humRange={f.humRange}
            season={f.season}
            year={f.year}
            onChange={(patch) => setF((x) => ({ ...x, ...patch }))}
          />
        </div>
      </div>
      <ProtocolFields p={p} set={setProtocol} onPreview={() => setPreview(true)} />
      <div className="job-block">
        <h4>Logger location sheet</h4>
        <LayoutUpload sheets={sheets} setSheets={setSheets} />
        <ProtocolSheetsEditor sheets={sheets} setSheets={setSheets} logger={p.logger_name || "Tempnix"} allowAddRows={allowAddRows} />
      </div>
      <button className="btn wide" onClick={save} disabled={busy}>
        {editId ? "Save changes" : "Create Mapping job"}
      </button>
      <div className="err">{err}</div>
      {preview && (
        <ProtocolPreview p={p} set={setProtocol} sheets={sheets} setSheets={setSheets} allowAddRows={allowAddRows} onClose={() => setPreview(false)} />
      )}
    </div>
  );
}
