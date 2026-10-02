import { useEffect, useState, type ReactNode } from "react";
import { Modal } from "../Modal";
import {
  addToList,
  emptySheetRow,
  HUM_RANGES,
  isTicked,
  loadList,
  LOGGER_NAMES,
  nextKey,
  readLayoutImage,
  SEASONS,
  SHEET_COLUMNS,
  SOFTWARE_NAMES,
  TEMP_RANGES,
  type LoggerRow,
  type Protocol,
  type ProtocolKey,
  type SavedList,
  type SheetKind,
  type SheetRow,
  type Sheets,
} from "./mappingData";

/** Select from a list saved in localStorage, with an "Add" option that appends to it. */
export function ListSelect(props: {
  list: SavedList;
  label: string;
  value: string;
  onChange: (v: string) => void;
  emptyLabel?: string;
  addPlaceholder?: string;
}) {
  const { list, value, onChange, emptyLabel } = props;
  const [options, setOptions] = useState(() => loadList(list));
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (value && !options.includes(value)) setOptions(addToList(list, value));
  }, [value, options, list]);
  function add() {
    const v = draft.trim();
    if (!v) return;
    setOptions(addToList(list, v));
    setDraft("");
    setAdding(false);
    onChange(v);
  }
  return (
    <div>
      <label>{props.label}</label>
      <select
        value={adding ? "__add" : value}
        onChange={(e) => {
          if (e.target.value === "__add") {
            setAdding(true);
            if (emptyLabel !== undefined) onChange("");
            return;
          }
          setAdding(false);
          onChange(e.target.value);
        }}
      >
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value="__add">Add</option>
      </select>
      {adding && (
        <div className="add-row" style={{ marginTop: 8 }}>
          <input
            autoFocus
            value={draft}
            placeholder={props.addPlaceholder || "Type the name"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <button type="button" className="btn sec" onClick={add}>
            Add
          </button>
        </div>
      )}
    </div>
  );
}

type SetProtocol = (patch: Partial<Protocol>) => void;

function ProtocolField({ p, set, k, label, type, placeholder }: { p: Protocol; set: SetProtocol; k: ProtocolKey; label: string; type?: string; placeholder?: string }) {
  return (
    <div>
      <label>{label}</label>
      <input type={type || "text"} value={p[k]} placeholder={placeholder || ""} onChange={(e) => set({ [k]: e.target.value })} />
    </div>
  );
}

export function ProtocolFields({ p, set, onPreview }: { p: Protocol; set: SetProtocol; onPreview: () => void }) {
  const f = (k: ProtocolKey, label: string, type?: string, placeholder?: string) => (
    <ProtocolField p={p} set={set} k={k} label={label} type={type} placeholder={placeholder} />
  );
  return (
    <>
      <div className="job-block">
        <h4>Names in the protocol</h4>
        <p className="hint" style={{ margin: "-6px 0 12px" }}>
          These two names are printed everywhere the protocol says the data logger and the software. Change them here and the whole document follows.
        </p>
        <div className="job-row">
          <ListSelect list={LOGGER_NAMES} label="Data logger name" value={p.logger_name} onChange={(v) => set({ logger_name: v })} />
          <ListSelect list={SOFTWARE_NAMES} label="Software name" value={p.software_name} onChange={(v) => set({ software_name: v })} />
        </div>
        <button type="button" className="btn sec sm" style={{ marginTop: 12 }} onClick={onPreview}>
          Preview protocol
        </button>
      </div>
      <div className="job-block">
        <h4>Protocol header</h4>
        <div className="job-row">
          {f("proto_no", "Protocol number", "text", "MAP-WH-001-P")}
          {f("proto_date", "Protocol prepared date", "date")}
          {f("results_date", "Results added date", "date")}
          {f("data_date", "Data added date", "date")}
        </div>
      </div>
      <div className="job-block">
        <h4>Temperature limits</h4>
        <div className="job-row">
          {f("min_temp", "Min temperature", "text", "e.g. 15°C")}
          {f("max_temp", "Max temperature", "text", "e.g. 25°C")}
          {f("setpoint", "Set point of the asset", "text", "e.g. 20°C")}
        </div>
      </div>
      <div className="job-block">
        <h4>Test dates</h4>
        <div className="job-row">
          {f("start", "Test starting date", "date")}
          {f("end", "Test ending date", "date")}
        </div>
      </div>
      <div className="job-block">
        <h4>People on the protocol</h4>
        <div className="job-row">
          {f("eng_name", "Westcal engineer name", "text", "Printed name, if different from the list")}
          {f("head", "Mapping head name", "text", "Name")}
          {f("person1", "Person 1", "text", "Name")}
          {f("desig1", "Designation (person 1)", "text", "Title")}
          {f("person2", "Person 2", "text", "Name")}
          {f("desig2", "Designation (person 2)", "text", "Title")}
          {f("person3", "Person 3", "text", "Name")}
          {f("desig3", "Designation (person 3)", "text", "Title")}
        </div>
      </div>
      <div className="job-block">
        <h4>Loggers</h4>
        <div className="job-row">
          {f("loggers", "Total loggers used for mapping", "text", "e.g. 54")}
          {f("loggers_min", "Minimum loggers to be mapped", "text", "e.g. 50")}
        </div>
      </div>
    </>
  );
}

function sheetHeaders(kind: SheetKind, logger: string): ReactNode[] {
  const idHead = (
    <>
      <span className="doc-logger-head">{logger}</span> Data Logger ID Number
    </>
  );
  return kind === "temp"
    ? [idHead, "Min. temp. recorded (°C)", "Max temp. recorded (°C)", "Mean Temp (°C)", "Pass", "Fail", "Tested by", "Date"]
    : kind === "hum"
      ? [idHead, "Min. hum. recorded (%RH)", "Max hum. recorded (%RH)", "Pass", "Fail", "Tested by", "Date"]
      : ["Date", "Change Summary", "Reason for Change", "Approved"];
}

export function DocSheet(props: {
  kind: SheetKind;
  rows: SheetRow[];
  logger: string;
  onChange: (rows: SheetRow[]) => void;
  editable: boolean;
  removable: boolean;
}) {
  const { kind, rows, onChange, editable, removable } = props;
  const cols = SHEET_COLUMNS[kind];
  const headers = sheetHeaders(kind, props.logger);
  const setCell = (key: number, col: string, value: string) =>
    onChange(
      rows.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, [col]: value };
        if ((col === "pass" || col === "fail") && value === "1") next[col === "pass" ? "fail" : "pass"] = "";
        return next;
      }),
    );
  return (
    <div className="doc-wrap">
      <table className="doc-sheet">
        <thead>
          {kind === "temp" && (
            <tr>
              <th colSpan={cols.length}>Table of Results</th>
              {removable && <th className="doc-act" />}
            </tr>
          )}
          <tr>
            {headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
            {removable && <th className="doc-act" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              {cols.map((c) =>
                c === "pass" || c === "fail" ? (
                  <td key={c}>
                    <input
                      className="doc-tick"
                      type="checkbox"
                      disabled={!editable}
                      checked={isTicked(r[c])}
                      onChange={(e) => setCell(r.key, c, e.target.checked ? "1" : "")}
                    />
                  </td>
                ) : (
                  <td key={c} className={c === "id" ? "doc-id" : ""}>
                    {editable ? <input value={r[c] || ""} onChange={(e) => setCell(r.key, c, e.target.value)} /> : r[c] || ""}
                  </td>
                ),
              )}
              {removable && (
                <td className="doc-act">
                  <button type="button" className="btn ghost sm" onClick={() => onChange(rows.filter((x) => x.key !== r.key))}>
                    ×
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LayoutUpload({ sheets, setSheets }: { sheets: Sheets; setSheets: (s: Sheets) => void }) {
  const [inputKey, setInputKey] = useState(0);
  const value = sheets.layout.value;
  return (
    <div className="span-2" style={{ marginTop: 14 }}>
      <label>Layout drawing</label>
      <p className="hint" style={{ margin: "0 0 8px" }}>
        The protocol keeps the standard cool-room plan until you upload a different drawing. The logger table stays. Upload a PNG or JPG of the new layout.
      </p>
      <input
        key={inputKey}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={async (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          try {
            setSheets({ ...sheets, layout: { touched: true, value: await readLayoutImage(file) } });
          } catch (err) {
            alert((err as Error).message);
          }
        }}
      />
      <button
        type="button"
        className="btn ghost sm"
        style={{ marginLeft: 8 }}
        onClick={() => {
          setSheets({ ...sheets, layout: { touched: true, value: "" } });
          setInputKey(inputKey + 1);
        }}
      >
        Use standard layout
      </button>
      {value && <img src={value} alt="Layout" style={{ display: "block", maxWidth: 240, marginTop: 8, border: "1px solid #ccc" }} />}
    </div>
  );
}

export function ProtocolSheetsEditor({ sheets, setSheets, logger }: { sheets: Sheets; setSheets: (s: Sheets) => void; logger: string }) {
  const setLogger = (key: number, patch: Partial<LoggerRow>) =>
    setSheets({ ...sheets, loggers: sheets.loggers.map((l) => (l.key === key ? { ...l, ...patch } : l)) });
  const table = (kind: SheetKind, label: string) => (
    <div style={{ marginTop: 18 }}>
      <label>{label}</label>
      <DocSheet kind={kind} rows={sheets[kind]} logger={logger} editable removable onChange={(rows) => setSheets({ ...sheets, [kind]: rows })} />
      <button type="button" className="btn sec sm" style={{ marginTop: 8 }} onClick={() => setSheets({ ...sheets, [kind]: [...sheets[kind], emptySheetRow(kind)] })}>
        + Add row
      </button>
    </div>
  );
  return (
    <div style={{ marginTop: 16 }}>
      <p className="hint">
        These tables use the same blue header and the same column names as MAP-WH-DIP-TRNSMD-039-P. Type in the white cells. + Add row adds one line in that table.
      </p>
      <label>Data loggers' location</label>
      <div className="doc-wrap" style={{ maxHeight: 420 }}>
        <table className="doc-sheet">
          <thead>
            <tr>
              <th>Data Logger ID number</th>
              <th>Height (m)</th>
              <th>Comments (Document any pertinent information in order to localize data loggers)</th>
              <th className="doc-act" />
            </tr>
          </thead>
          <tbody>
            {sheets.loggers.map((l) => (
              <tr key={l.key}>
                <td>
                  <input value={l.loggerId} onChange={(e) => setLogger(l.key, { loggerId: e.target.value })} />
                </td>
                <td>
                  <input value={l.height} onChange={(e) => setLogger(l.key, { height: e.target.value })} />
                </td>
                <td>
                  <input value={l.comments} onChange={(e) => setLogger(l.key, { comments: e.target.value })} />
                </td>
                <td className="doc-act">
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => setSheets({ ...sheets, loggers: sheets.loggers.filter((x) => x.key !== l.key) })}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="btn sec sm"
        style={{ marginTop: 8 }}
        onClick={() => setSheets({ ...sheets, loggers: [...sheets.loggers, { key: nextKey(), loggerId: "", height: "", comments: "" }] })}
      >
        + Add row
      </button>
      {table("temp", "Table of Results — temperature")}
      {table("hum", "Table of Results — humidity")}
      {table("chg", "Change record")}
    </div>
  );
}

export interface RangeValues {
  tempRange: string;
  humRange: string;
  season: string;
  year: string;
}

export function MappingRanges(props: RangeValues & { onChange: (patch: Partial<RangeValues>) => void }) {
  return (
    <>
      <ListSelect
        list={TEMP_RANGES}
        label="Temperature range *"
        emptyLabel="Choose temperature range"
        addPlaceholder="e.g. -15°C to -25°C"
        value={props.tempRange}
        onChange={(v) => props.onChange({ tempRange: v })}
      />
      <ListSelect
        list={HUM_RANGES}
        label="Humidity range to be mapped *"
        emptyLabel="Choose humidity range"
        addPlaceholder="e.g. Max 55%"
        value={props.humRange}
        onChange={(v) => props.onChange({ humRange: v })}
      />
      <div>
        <ListSelect
          list={SEASONS}
          label="Season / year"
          emptyLabel="Choose season"
          addPlaceholder="Type the season"
          value={props.season}
          onChange={(v) => props.onChange({ season: v })}
        />
        <label style={{ marginTop: 8 }}>Year</label>
        <input value={props.year} placeholder="e.g. 2026" inputMode="numeric" onChange={(e) => props.onChange({ year: e.target.value })} />
      </div>
    </>
  );
}

export function ProtocolPreview(props: { p: Protocol; set: SetProtocol; sheets: Sheets; setSheets: (s: Sheets) => void; onClose: () => void }) {
  const { p, set, sheets, setSheets } = props;
  const [editing, setEditing] = useState(false);
  const logger = p.logger_name || "Tempnix";
  const software = p.software_name || "Tempnix software";
  const table = (kind: SheetKind, label: string) => (
    <div style={{ marginTop: 16 }}>
      <label>{label}</label>
      <DocSheet kind={kind} rows={sheets[kind]} logger={logger} editable={editing} removable={false} onChange={(rows) => setSheets({ ...sheets, [kind]: rows })} />
      {editing && (
        <button type="button" className="btn sec sm" style={{ marginTop: 8 }} onClick={() => setSheets({ ...sheets, [kind]: [...sheets[kind], emptySheetRow(kind)] })}>
          + Add row
        </button>
      )}
    </div>
  );
  return (
    <Modal
      title="Protocol preview"
      subtitle={
        editing
          ? "Tick Pass or Fail, and choose the data logger and software. Done keeps those choices on this job."
          : "Same Pass and Fail boxes as the Word file. Use Edit to change them."
      }
      width={980}
      zIndex={120}
      onClose={props.onClose}
      actions={
        <button className="btn sec sm" type="button" onClick={() => setEditing(!editing)}>
          {editing ? "Done" : "Edit"}
        </button>
      }
    >
      <div className="job-form">
        {editing ? (
          <div className="job-row">
            <ListSelect list={LOGGER_NAMES} label="Data logger name" value={p.logger_name} onChange={(v) => set({ logger_name: v })} />
            <ListSelect list={SOFTWARE_NAMES} label="Software name" value={p.software_name} onChange={(v) => set({ software_name: v })} />
          </div>
        ) : (
          <p className="hint">
            Data logger: <b>{logger}</b> · Software: <b>{software}</b>
          </p>
        )}
        {table("temp", "Table of Results — temperature")}
        {table("hum", "Table of Results — humidity")}
      </div>
    </Modal>
  );
}
