import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import JSZip from "jszip";
import type { TrainingJob } from "./training.js";

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "templates", "MAP-WH-protocol.docx");

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function lookup(values: Record<string, string>, key: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
  const lower = key.toLowerCase();
  const hit = Object.keys(values).find((name) => name.toLowerCase() === lower);
  return hit ? values[hit] : undefined;
}

function fillParagraph(paragraph: string, values: Record<string, string>): string {
  const parts: string[] = [];
  const re = /<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(paragraph))) {
    parts.push(match[2]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">"));
  }
  const flat = parts.join("");
  if (!parts.length || (!flat.includes("{{") && !flat.includes("}}"))) return paragraph;

  const ranges: Array<{ start: number; end: number; value: string }> = [];
  const add = (found: RegExpMatchArray, knownOnly: boolean) => {
    const key = found[1].replace(/\s+/g, " ").trim();
    const value = lookup(values, key);
    if (knownOnly && value === undefined) return;
    ranges.push({
      start: found.index ?? 0,
      end: (found.index ?? 0) + found[0].length,
      value: value ?? "",
    });
  };
  for (const found of flat.matchAll(/\{\{([^}]+)\}\}/g)) add(found, false);
  for (const found of flat.matchAll(/(?<!\{)\{([^{}]+)\}\}/g)) add(found, true);
  const sorted = ranges.sort((a, b) => a.start - b.start).filter((range, index, all) => (
    index === 0 || range.start >= all[index - 1].end
  ));
  const bounds: Array<{ from: number; to: number }> = [];
  let pos = 0;
  for (const part of parts) {
    bounds.push({ from: pos, to: pos + part.length });
    pos += part.length;
  }
  const out = parts.map(() => "");
  const segments: Array<{ start: number; end: number; value: string | null }> = [];
  let cursor = 0;
  for (const range of sorted) {
    if (range.start > cursor) segments.push({ start: cursor, end: range.start, value: null });
    segments.push({ start: range.start, end: range.end, value: range.value });
    cursor = range.end;
  }
  if (cursor < flat.length) segments.push({ start: cursor, end: flat.length, value: null });
  for (const seg of segments) {
    let placed = false;
    for (let i = 0; i < parts.length; i++) {
      const { from, to } = bounds[i];
      if (to <= seg.start || from >= seg.end) continue;
      if (seg.value === null) {
        out[i] += parts[i].slice(Math.max(from, seg.start) - from, Math.min(to, seg.end) - from);
      } else if (!placed) {
        out[i] += seg.value;
        placed = true;
      }
    }
  }
  for (let i = 0; i < parts.length; i++) parts[i] = out[i];

  let index = 0;
  return paragraph.replace(/<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g, (_full, attrs: string | undefined) => {
    const text = xmlEscape(parts[index++] ?? "");
    const space = text.startsWith(" ") || text.endsWith(" ") ? ' xml:space="preserve"' : "";
    const cleaned = (attrs || "").replace(/\s*xml:space="preserve"/, "");
    return `<w:t${cleaned}${space}>${text}</w:t>`;
  });
}

function fillXml(xml: string, values: Record<string, string>): string {
  const marks = /<w:p[ >]|<\/w:p>/g;
  let out = "";
  let cursor = 0;
  let start = -1;
  let depth = 0;
  let mark: RegExpExecArray | null;
  while ((mark = marks.exec(xml))) {
    if (mark[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        out += fillParagraph(xml.slice(start, mark.index + mark[0].length), values);
        cursor = mark.index + mark[0].length;
        start = -1;
      }
    } else {
      if (depth === 0) {
        out += xml.slice(cursor, mark.index);
        start = mark.index;
      }
      depth += 1;
    }
  }
  return out + xml.slice(cursor);
}

function formatDate(iso?: string): string {
  const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : String(iso || "").trim();
}

function daysBetween(from?: string, to?: string): string {
  const start = Date.parse(String(from || ""));
  const end = Date.parse(String(to || from || ""));
  if (Number.isNaN(start) || Number.isNaN(end)) return "";
  return String(Math.max(1, Math.round((end - start) / 86400000) + 1));
}

function splitRange(range?: string): { min: string; max: string; mid: string } {
  const nums = String(range || "").match(/-?\d+(?:\.\d+)?/g) || [];
  if (nums.length < 2) return { min: range || "", max: range || "", mid: range || "" };
  const a = Number(nums[0]);
  const b = Number(nums[1]);
  const unit = /%/.test(range || "") ? "%" : "°C";
  return { min: `${a}${unit}`, max: `${b}${unit}`, mid: `${(a + b) / 2}${unit}` };
}

function loggerCount(job: TrainingJob): string {
  const total = (job.lineItems || []).reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  return String(total || job.lineItems?.length || "");
}

export function suggestedProtocolNumber(job: Pick<TrainingJob, "mappingType" | "jobOrderNo" | "jobNo">): string {
  const code = ({
    Warehouse: "WH",
    "Cold Room": "CR",
    "Vehicle mapping": "VH",
    "Freezer mapping": "FR",
  } as Record<string, string>)[job.mappingType || ""] || "MAP";
  const seq = String(job.jobOrderNo || job.jobNo || "").replace(/\D/g, "") || "001";
  return `MAP-${code}-${seq.padStart(3, "0")}-P`;
}

function pick(value: string | undefined, fallback: string): string {
  const entered = String(value ?? "").trim();
  return entered || fallback;
}

export function mappingProtocolValues(job: TrainingJob): Record<string, string> {
  const temps = splitRange(job.mappingRange);
  const asset = job.assetName || job.lineItems?.[0]?.description || job.mappingType || "";
  const dimension = pick(job.assetDimension, job.lineItems?.map((item) => item.remarks).filter(Boolean).join("; ") || "");
  const engineer = pick(job.protocolEngineerName, job.assigneeName || job.trainerName || "");
  const designation = pick(job.engineerDesignation, job.assigneeRole || "Site Engineer");
  const prepared = formatDate(pick(job.protocolPreparedDate, new Date().toISOString().slice(0, 10)));
  const start = formatDate(pick(job.mappingStartDate, job.trainingDate));
  const end = formatDate(pick(job.mappingEndDate, job.trainingDateTo || job.trainingDate));
  const year = (job.trainingDate || "").slice(0, 4);
  const days = pick(job.mappingDays, daysBetween(job.mappingStartDate || job.trainingDate, job.mappingEndDate || job.trainingDateTo));
  const loggers = pick(job.loggerTotal, loggerCount(job));
  const minimum = pick(job.loggerMinimum, "");
  const minTemp = pick(job.minTempRange, temps.min);
  const maxTemp = pick(job.maxTempRange, temps.max);
  const maxHum = pick(job.maxHumRange, "");
  const setPoint = pick(job.assetSetPoint, temps.mid);
  const company = pick(job.protocolCompanyName, job.customerName || "");
  const head = pick(job.mappingHeadName, job.handedOverTo || engineer);
  const temperature = pick(job.mappingRange, minTemp && maxTemp ? `${minTemp} to ${maxTemp}` : "");
  return {
    customer_name: job.customerName || "",
    company_name: company,
    asset_name: asset,
    ASSET_NAME: asset,
    temperature_range: temperature,
    "temperature_range to be mapped": temperature,
    min_temp_range: minTemp,
    max_temp_range: maxTemp,
    "set point of the asset": setPoint,
    location_country: job.location && job.location !== "On-site" && job.location !== "Off-site" ? job.location : (job.address || ""),
    westcal_engineer_name: engineer,
    designation,
    protocol_number: pick(job.protocolNumber, suggestedProtocolNumber(job)),
    protocol_prepared_date: prepared,
    person_1: pick(job.protocolPerson1, ""),
    designation_p1: pick(job.protocolDesignationP1, ""),
    person_2: pick(job.protocolPerson2, ""),
    designation_p2: pick(job.protocolDesignationP2, ""),
    person_3: pick(job.protocolPerson3, job.handedOverTo || ""),
    designation_p3: pick(job.protocolDesignationP3, job.handedOverTo ? "Coordinator" : ""),
    "westcal_mapping head_name": head,
    "mapping head_name": head,
    results_added_date: formatDate(job.resultsAddedDate),
    "data added date": formatDate(pick(job.dataAddedDate, job.protocolPreparedDate || new Date().toISOString().slice(0, 10))),
    season_year: job.seasonYear || year,
    "no.of days to be mapped": days,
    "starting date_ending date": start && end ? `${start} to ${end}` : start,
    "total_number of loggers_used for mapping": loggers,
    "TOTAL_NUMBER OF LOGGERS_ TO BE MAPPED": loggers,
    "minimum_number of loggers_ to be mapped": minimum,
    "dimension of asset": dimension,
    max_hum_range: maxHum,
    "humidity_range to be mapped": maxHum,
    "test starting date": start,
    "test start time": job.trainingTime || "",
    "test ending date": end,
    "test end time": job.testEndTime || job.trainingTime || "",
    logger_product: pick(job.loggerProductName, "Tempnix"),
    logger_product_upper: pick(job.loggerProductName, "Tempnix").toUpperCase(),
    software_name: pick(job.softwareProductName, "Tempnix software"),
  };
}

function blockText(block: string): string {
  return [...block.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => match[1])
    .join("")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function splitByTag(block: string, tag: "w:tr" | "w:tc" | "w:tbl"): string[] {
  const open = new RegExp(`<${tag}[ >]`, "g");
  const close = `</${tag}>`;
  const parts: string[] = [];
  let depth = 0;
  let start = -1;
  const marks = new RegExp(`<${tag}[ >]|</${tag}>`, "g");
  let mark: RegExpExecArray | null;
  while ((mark = marks.exec(block))) {
    if (mark[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        parts.push(block.slice(start, mark.index + close.length));
        start = -1;
      }
    } else {
      if (depth === 0) start = mark.index;
      depth += 1;
    }
  }
  void open;
  return parts;
}

function setBlockText(block: string, value: string): string {
  let used = false;
  return block.replace(/<w:t(\s[^>]*)?>[\s\S]*?<\/w:t>/g, (_full, attrs: string | undefined) => {
    const text = used ? "" : xmlEscape(value);
    used = true;
    const space = text.startsWith(" ") || text.endsWith(" ") ? ' xml:space="preserve"' : "";
    const cleaned = String(attrs || "").replace(/\s*xml:space="preserve"/, "");
    return `<w:t${cleaned}${space}>${text}</w:t>`;
  });
}

function isDataRow(row: string): boolean {
  return /^DL-/i.test(blockText(splitByTag(row, "w:tc")[0] || "").trim());
}

function leadingHeaderRows(rows: string[]): string[] {
  const firstData = rows.findIndex(isDataRow);
  return firstData < 0 ? rows : rows.slice(0, firstData);
}

function applyLoggerLocations(xml: string, rows: TrainingJob["loggerLocations"]): string {
  if (!rows?.length) return xml;
  const tables = splitByTag(xml, "w:tbl");
  const table = tables.find((item) => {
    const header = blockText(item).slice(0, 500);
    if (!/Height/i.test(header) || !/Comment/i.test(header) || !/Logger/i.test(header)) return false;
    const data = splitByTag(item, "w:tr").find((row) => /^DL-/i.test(blockText(splitByTag(row, "w:tc")[0] || "").trim()));
    if (!data) return false;
    const second = blockText(splitByTag(data, "w:tc")[1] || "");
    return !second.includes("{{");
  });
  if (!table) return xml;
  const allRows = splitByTag(table, "w:tr");
  const headerRows = leadingHeaderRows(allRows);
  const sample = allRows.find((row) => /^DL-/i.test(blockText(splitByTag(row, "w:tc")[0] || "").trim()));
  if (!sample) return xml;
  const built = rows.map((row) => {
    const cells = splitByTag(sample, "w:tc");
    const values = [row.loggerId, row.height, row.comments];
    let cursor = 0;
    let next = "";
    cells.forEach((cell, index) => {
      const at = sample.indexOf(cell, cursor);
      next += sample.slice(cursor, at);
      next += index <= 2 ? setBlockText(cell, values[index] || "") : cell;
      cursor = at + cell.length;
    });
    return next + sample.slice(cursor);
  });
  const first = allRows[0];
  const last = allRows[allRows.length - 1];
  const start = table.indexOf(first);
  const end = table.lastIndexOf(last) + last.length;
  const replaced = table.slice(0, start) + [...headerRows, ...built].join("") + table.slice(end);
  const at = xml.indexOf(table);
  if (at < 0) return xml;
  return xml.slice(0, at) + replaced + xml.slice(at + table.length);
}

function rewriteDataRows(table: string, valuesFor: (sample: string) => string[][]): string {
  const allRows = splitByTag(table, "w:tr");
  const sample = allRows.find((row) => /^DL-/i.test(blockText(splitByTag(row, "w:tc")[0] || "").trim()));
  if (!sample) return table;
  const headerRows = leadingHeaderRows(allRows);
  const built = valuesFor(sample).map((values) => fillSampleRow(sample, values));
  const first = allRows[0];
  const last = allRows[allRows.length - 1];
  const start = table.indexOf(first);
  const end = table.lastIndexOf(last) + last.length;
  return table.slice(0, start) + [...headerRows, ...built].join("") + table.slice(end);
}

function uniqueParagraphIds(xml: string): string {
  let n = 1;
  const next = () => (n++).toString(16).toUpperCase().padStart(8, "0");
  return xml
    .replace(/w14:paraId="[^"]+"/g, () => `w14:paraId="${next()}"`)
    .replace(/w14:textId="[^"]+"/g, () => `w14:textId="${next()}"`);
}

function setCellValue(cell: string, value: string): string {
  if (!cell.includes("<w:checkBox>")) return setBlockText(cell, value);
  const on = /^(1|yes|true|x|checked)$/i.test(value.trim()) ? "1" : "0";
  return cell
    .replace(/<w:checked w:val="[01]"\/>/g, `<w:checked w:val="${on}"/>`)
    .replace(/<w:default w:val="[01]"\/>/g, `<w:default w:val="${on}"/>`);
}

function fillSampleRow(sample: string, values: string[]): string {
  const cells = splitByTag(sample, "w:tc");
  let cursor = 0;
  let next = "";
  cells.forEach((cell, index) => {
    const at = sample.indexOf(cell, cursor);
    next += sample.slice(cursor, at);
    next += index < values.length ? setCellValue(cell, values[index] || "") : cell;
    cursor = at + cell.length;
  });
  return next + sample.slice(cursor);
}

function applyNamedRows(
  xml: string,
  marker: RegExp,
  rows: string[][],
): string {
  if (!rows.length) return xml;
  const tables = splitByTag(xml, "w:tbl");
  const table = tables.find((item) => marker.test(blockText(item).slice(0, 2500)));
  if (!table) return xml;
  const replaced = rewriteDataRows(table, () => rows);
  const at = xml.indexOf(table);
  if (at < 0) return xml;
  return xml.slice(0, at) + replaced + xml.slice(at + table.length);
}

function applyChangeRows(xml: string, rows: TrainingJob["protocolChanges"]): string {
  if (!rows?.length) return xml;
  const tables = splitByTag(xml, "w:tbl");
  const table = tables.find((item) => {
    const header = blockText(splitByTag(item, "w:tr")[0] || "");
    return /Change Summary/i.test(header) && /Approved/i.test(header);
  });
  if (!table) return xml;
  const allRows = splitByTag(table, "w:tr");
  const sample = allRows[1];
  if (!sample) return xml;
  const built = rows.map((row) => fillSampleRow(sample, [row.date, row.summary, row.reason, row.approved]));
  const first = allRows[0];
  const last = allRows[allRows.length - 1];
  const start = table.indexOf(first);
  const end = table.lastIndexOf(last) + last.length;
  const replaced = table.slice(0, start) + first + built.join("") + table.slice(end);
  const at = xml.indexOf(table);
  if (at < 0) return xml;
  return xml.slice(0, at) + replaced + xml.slice(at + table.length);
}

export async function buildMappingProtocol(job: TrainingJob): Promise<{ filename: string; buffer: Buffer }> {
  const zip = await JSZip.loadAsync(await readFile(TEMPLATE));
  const values = mappingProtocolValues(job);
  const files = Object.keys(zip.files).filter((name) => name.startsWith("word/") && name.endsWith(".xml"));
  for (const name of files) {
    let xml = await zip.file(name)!.async("string");
    xml = fillXml(xml, values);
    if (name === "word/document.xml") {
      xml = applyLoggerLocations(xml, job.loggerLocations);
      xml = applyNamedRows(xml, /Min\.\s*temp/i, (job.tempResults || []).map((row) => [
        row.loggerId, row.min, row.max, row.mean, row.pass, row.fail, row.testedBy, row.date,
      ]));
      xml = applyNamedRows(xml, /Min\.\s*hum/i, (job.humResults || []).map((row) => [
        row.loggerId, row.min, row.max, row.pass, row.fail, row.testedBy, row.date,
      ]));
      xml = applyChangeRows(xml, job.protocolChanges);
      xml = uniqueParagraphIds(xml);
    }
    zip.file(name, xml);
  }
  const layout = String(job.layoutImageDataUrl || "");
  if (layout.startsWith("data:image/")) {
    const bytes = Buffer.from(layout.slice(layout.indexOf(",") + 1), "base64");
    if (bytes.length) zip.file("word/media/image13.png", bytes);
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const filename = `${values.protocol_number || suggestedProtocolNumber(job)}.docx`;
  return { filename, buffer };
}

export async function sendMappingProtocol(res: ServerResponse, job: TrainingJob): Promise<void> {
  const { filename, buffer } = await buildMappingProtocol(job);
  res.writeHead(200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Disposition": `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
  });
  res.end(buffer);
}
