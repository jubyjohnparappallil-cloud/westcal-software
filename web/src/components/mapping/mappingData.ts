import type { Job } from "../../types";

export const MAPPING_TYPES = ["Cold Room", "Warehouse", "Vehicle mapping", "Freezer mapping"];
export const MAPPING_LOCATIONS = [
  "Dubai",
  "Abu Dhabi",
  "Sharjah",
  "Ajman",
  "Umm Al Quwain",
  "Ras Al Khaimah",
  "Fujairah",
  "Kuwait",
  "Saudi Arabia",
  "Oman",
  "Iraq",
  "Bahrain",
  "Qatar",
];

export interface SavedList {
  storageKey: string;
  base: string[];
}

export const TEMP_RANGES: SavedList = {
  storageKey: "westcal-temp-ranges",
  base: ["+2°C to 8°C", "+15°C to 25°C", "15°C to 25°C"],
};
export const HUM_RANGES: SavedList = {
  storageKey: "westcal-hum-ranges",
  base: ["Max 60%", "Max 65%", "Max 70%", "40% to 60%", "N/A"],
};
export const SEASONS: SavedList = {
  storageKey: "westcal-seasons",
  base: ["Summer mapping", "Winter mapping", "Initial mapping", "General"],
};
export const LOGGER_NAMES: SavedList = { storageKey: "westcal-loggers", base: ["Tempnix"] };
export const SOFTWARE_NAMES: SavedList = {
  storageKey: "westcal-software",
  base: ["Tempnix software", "Tempnix"],
};

export function loadList(list: SavedList): string[] {
  const out = list.base.slice();
  try {
    (JSON.parse(localStorage.getItem(list.storageKey) || "[]") as string[]).forEach((v) => {
      if (v && !out.includes(v)) out.push(v);
    });
  } catch {
    /* ignore */
  }
  return out;
}

export function addToList(list: SavedList, value: string): string[] {
  const all = loadList(list);
  const v = value.trim();
  if (!v || all.includes(v)) return all;
  all.push(v);
  try {
    localStorage.setItem(list.storageKey, JSON.stringify(all.slice(list.base.length)));
  } catch {
    /* ignore */
  }
  return all;
}

const OLD_TEMP_RANGES: Record<string, string> = {
  "2 to 8°C": "+2°C to 8°C",
  "+2°C to +8°C": "+2°C to 8°C",
  "+2 to 8°C": "+2°C to 8°C",
  "15 to 25°C": "15°C to 25°C",
  "+15°C to +25°C": "+15°C to 25°C",
  "+15 to 25°C": "+15°C to 25°C",
};
export const normalizeTempRange = (v: string) => OLD_TEMP_RANGES[v] || v;

export function splitSeason(v: string | undefined) {
  const t = String(v || "").trim();
  const m = t.match(/^(.*?)(?:\s+(20\d{2}))$/);
  return { season: (m ? m[1] : t).trim(), year: m ? m[2] : "" };
}

export const PROTOCOL_KEYS = [
  "proto_no",
  "proto_date",
  "person1",
  "desig1",
  "company",
  "person2",
  "desig2",
  "eng_name",
  "head",
  "person3",
  "desig3",
  "min_temp",
  "max_temp",
  "max_hum",
  "days",
  "start",
  "end",
  "end_time",
  "setpoint",
  "loggers",
  "loggers_min",
  "dimension",
  "logger_name",
  "software_name",
  "results_date",
  "data_date",
] as const;

export type ProtocolKey = (typeof PROTOCOL_KEYS)[number];
export type Protocol = Record<ProtocolKey, string>;

export function emptyProtocol(): Protocol {
  const p = Object.fromEntries(PROTOCOL_KEYS.map((k) => [k, ""])) as Protocol;
  p.logger_name = "Tempnix";
  p.software_name = "Tempnix software";
  return p;
}

export function defaultProtocolNo(j: Job): string {
  const code =
    ({ Warehouse: "WH", "Cold Room": "CR", "Vehicle mapping": "VH", "Freezer mapping": "FR" } as Record<string, string>)[
      j.mappingType
    ] || "MAP";
  const digits = String(j.jobOrderNo || j.jobNo || "").replace(/\D/g, "") || "001";
  return "MAP-" + code + "-" + digits.padStart(3, "0") + "-P";
}

export function parseRange(v: string | undefined) {
  const nums = String(v || "").match(/-?\d+(?:\.\d+)?/g) || [];
  if (nums.length < 2) return { min: v || "", max: v || "", mid: v || "" };
  const lo = Number(nums[0]);
  const hi = Number(nums[1]);
  const unit = /%/.test(v || "") ? "%" : "°C";
  return { min: lo + unit, max: hi + unit, mid: (lo + hi) / 2 + unit };
}

export function protocolFromJob(j: Job): Protocol {
  const range = parseRange(j.mappingRange);
  const start = Date.parse(j.mappingStartDate || j.trainingDate || "");
  const end = Date.parse(j.mappingEndDate || j.trainingDateTo || j.trainingDate || "");
  const days = !Number.isNaN(start) && !Number.isNaN(end) ? String(Math.max(1, Math.round((end - start) / 864e5) + 1)) : "";
  const lines: any[] = j.lineItems || [];
  const loggers = String(lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0) || lines.length || "");
  return {
    proto_no: j.protocolNumber || defaultProtocolNo(j),
    proto_date: j.protocolPreparedDate || new Date().toISOString().slice(0, 10),
    person1: j.protocolPerson1 || "",
    desig1: j.protocolDesignationP1 || "",
    company: j.protocolCompanyName || j.customerName || "",
    person2: j.protocolPerson2 || "",
    desig2: j.protocolDesignationP2 || "",
    eng_name: j.protocolEngineerName || j.assigneeName || j.trainerName || "",
    head: j.mappingHeadName || j.handedOverTo || "",
    person3: j.protocolPerson3 || j.handedOverTo || "",
    desig3: j.protocolDesignationP3 || "",
    min_temp: j.minTempRange || range.min,
    max_temp: j.maxTempRange || range.max,
    max_hum: j.maxHumRange || "",
    days: j.mappingDays || days,
    start: j.mappingStartDate || j.trainingDate || "",
    end: j.mappingEndDate || j.trainingDateTo || j.trainingDate || "",
    end_time: j.testEndTime || "",
    setpoint: j.assetSetPoint || range.mid,
    loggers: j.loggerTotal || loggers,
    loggers_min: j.loggerMinimum || "",
    dimension: j.assetDimension || "",
    logger_name: j.loggerProductName || "Tempnix",
    software_name: j.softwareProductName || "Tempnix software",
    results_date: j.resultsAddedDate || "",
    data_date: j.dataAddedDate || j.protocolPreparedDate || "",
  };
}

export function protocolToJob(p: Protocol) {
  const v = (k: ProtocolKey) => (p[k] || "").trim();
  return {
    protocolNumber: v("proto_no"),
    protocolPreparedDate: v("proto_date"),
    protocolPerson1: v("person1"),
    protocolDesignationP1: v("desig1"),
    protocolCompanyName: v("company"),
    protocolPerson2: v("person2"),
    protocolDesignationP2: v("desig2"),
    protocolPerson3: v("person3"),
    protocolDesignationP3: v("desig3"),
    protocolEngineerName: v("eng_name"),
    mappingHeadName: v("head"),
    assetDimension: v("dimension"),
    loggerProductName: v("logger_name") || "Tempnix",
    softwareProductName: v("software_name") || "Tempnix software",
    resultsAddedDate: v("results_date"),
    dataAddedDate: v("data_date"),
    testEndTime: v("end_time"),
    minTempRange: v("min_temp"),
    maxTempRange: v("max_temp"),
    mappingDays: v("days"),
    mappingStartDate: v("start"),
    mappingEndDate: v("end"),
    assetSetPoint: v("setpoint"),
    loggerTotal: v("loggers"),
    loggerMinimum: v("loggers_min"),
  };
}

let keySeq = 0;
export const nextKey = () => ++keySeq;

export const SHEET_COLUMNS = {
  temp: ["id", "min", "max", "mean", "pass", "fail", "by", "date"],
  hum: ["id", "min", "max", "pass", "fail", "by", "date"],
  chg: ["date", "sum", "why", "ok"],
};
export type SheetKind = keyof typeof SHEET_COLUMNS;
export type SheetRow = { key: number; [col: string]: any };
export interface LoggerRow {
  key: number;
  loggerId: string;
  height: string;
  comments: string;
}
export interface Sheets {
  layout: { touched: boolean; value: string };
  loggers: LoggerRow[];
  temp: SheetRow[];
  hum: SheetRow[];
  chg: SheetRow[];
}

export const isTicked = (v: unknown) => v === "1" || v === true || v === "Yes" || v === "yes" || v === "true";

export function emptySheetRow(kind: SheetKind, loggerId = ""): SheetRow {
  const row: SheetRow = { key: nextKey() };
  SHEET_COLUMNS[kind].forEach((c) => (row[c] = ""));
  if (kind !== "chg") row.id = loggerId;
  return row;
}

function defaultLoggers(): LoggerRow[] {
  const heights = ["0.5", "2.0", "3.0"];
  const rows: LoggerRow[] = [];
  for (let i = 1; i <= 54; i++)
    rows.push({
      key: nextKey(),
      loggerId: "DL-" + String(i).padStart(3, "0"),
      height: heights[(i - 1) % 3],
      comments: i === 1 ? "N/Ap." : "",
    });
  rows.push({ key: nextKey(), loggerId: "DL-OUT", height: "", comments: "N/Ap." });
  return rows;
}

const str = (v: unknown) => (v == null ? "" : String(v));

export function sheetsFromJob(j: Job | null | undefined): Sheets {
  const saved: any[] = j?.loggerLocations || [];
  const loggers: LoggerRow[] = saved.length
    ? saved.map((l) => ({ key: nextKey(), loggerId: str(l.loggerId), height: str(l.height), comments: str(l.comments) }))
    : defaultLoggers();
  const ids = loggers.map((l) => l.loggerId.trim()).filter(Boolean);
  const blank = (kind: SheetKind) => (ids.length ? ids.map((id) => emptySheetRow(kind, id)) : [emptySheetRow(kind)]);
  const fromSaved = (r: any, kind: SheetKind) => {
    const row = emptySheetRow(kind, str(r.loggerId));
    row.min = str(r.min);
    row.max = str(r.max);
    if (kind === "temp") row.mean = str(r.mean);
    row.pass = isTicked(r.pass) ? "1" : "";
    row.fail = isTicked(r.fail) ? "1" : "";
    row.by = str(r.testedBy);
    row.date = str(r.date);
    return row;
  };
  const temp: any[] = j?.tempResults || [];
  const hum: any[] = j?.humResults || [];
  const chg: any[] = j?.protocolChanges || [];
  return {
    layout: { touched: false, value: j?.layoutImageDataUrl || "" },
    loggers,
    temp: temp.length ? temp.map((r) => fromSaved(r, "temp")) : blank("temp"),
    hum: hum.length ? hum.map((r) => fromSaved(r, "hum")) : blank("hum"),
    chg: chg.length
      ? chg.map((r) => ({ ...emptySheetRow("chg"), date: str(r.date), sum: str(r.summary), why: str(r.reason), ok: str(r.approved) }))
      : [emptySheetRow("chg")],
  };
}

export function sheetsToJob(s: Sheets) {
  const v = (x: unknown) => str(x).trim();
  return {
    ...(s.layout.touched ? { layoutImageDataUrl: s.layout.value.startsWith("data:image/") ? s.layout.value : "" } : {}),
    loggerLocations: s.loggers
      .map((l) => ({ loggerId: v(l.loggerId), height: v(l.height), comments: v(l.comments) }))
      .filter((l) => l.loggerId),
    tempResults: s.temp
      .filter((r) => v(r.id))
      .map((r) => ({
        loggerId: v(r.id),
        min: v(r.min),
        max: v(r.max),
        mean: v(r.mean),
        pass: v(r.pass),
        fail: v(r.fail),
        testedBy: v(r.by),
        date: v(r.date),
      })),
    humResults: s.hum
      .filter((r) => v(r.id))
      .map((r) => ({
        loggerId: v(r.id),
        min: v(r.min),
        max: v(r.max),
        pass: v(r.pass),
        fail: v(r.fail),
        testedBy: v(r.by),
        date: v(r.date),
      })),
    protocolChanges: s.chg
      .filter((r) => SHEET_COLUMNS.chg.some((c) => v(r[c])))
      .map((r) => ({ date: v(r.date), summary: v(r.sum), reason: v(r.why), approved: v(r.ok) })),
  };
}

export function readLayoutImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = img.naturalWidth > 1400 ? 1400 / img.naturalWidth : 1;
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that picture. Use a PNG or JPG."));
    };
    img.src = url;
  });
}

export const PROTOCOL_LABELS: [ProtocolKey, string][] = [
  ["proto_no", "Protocol number"],
  ["proto_date", "Protocol prepared date"],
  ["person1", "Person 1"],
  ["desig1", "Designation (person 1)"],
  ["company", "Company name"],
  ["person2", "Person 2"],
  ["desig2", "Designation (person 2)"],
  ["person3", "Person 3"],
  ["desig3", "Designation (person 3)"],
  ["eng_name", "Westcal engineer"],
  ["head", "Mapping head"],
  ["logger_name", "Data logger name"],
  ["software_name", "Software name"],
  ["dimension", "Dimension of the asset"],
  ["min_temp", "Min temperature"],
  ["max_temp", "High limit"],
  ["max_hum", "Max humidity"],
  ["days", "Days to be mapped"],
  ["start", "Starting date"],
  ["end", "Ending date"],
  ["end_time", "End time"],
  ["results_date", "Results added date"],
  ["data_date", "Data added date"],
  ["setpoint", "Set point"],
  ["loggers", "Total loggers"],
  ["loggers_min", "Minimum loggers"],
];
