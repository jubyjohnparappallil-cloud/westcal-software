import type { Course, Job } from "../types";

export const WESTCAL_NAME = "Westcal Instrumentation and Calibration Services LLC";

export const isTrainingJob = (j: Job) => !j.serviceType || j.serviceType === "Training";
export const statusClass = (s: string) => "chip " + s.replace(" ", "");

/** Most recently created job first. */
export function newestFirst<T extends Job>(jobs: T[]): T[] {
  return jobs
    .slice()
    .sort(
      (a, b) =>
        (Date.parse(b.createdAt || "") || 0) - (Date.parse(a.createdAt || "") || 0) ||
        String(b.jobNo || "").localeCompare(String(a.jobNo || ""), undefined, { numeric: true }),
    );
}

export function jobCompanyNames(j: Job): string[] {
  return [...new Set([j.customerName, ...(j.companies || [])].map((s) => String(s || "").trim()).filter(Boolean))];
}

export function formatDob(v: string | undefined): string {
  const m = String(v || "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v || "-";
}

export function certDate(v: string | undefined): string {
  const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : v || "-";
}

/** Course title, "certified to" company and date as printed on the attendance sheet. */
export function sheetView(j: Job) {
  const courseTitle = (j.sheetCourseTitle || "").trim() || j.course || "Training";
  const invoiced = (j.sheetCompany || "").trim() || j.customerName || "";
  const certifiedBy = (j.certificateUnder || "").trim() || invoiced;
  return { courseTitle, certifiedBy, date: formatDob(j.trainingDate) };
}

export function jobCourses(j: Job): string[] {
  return String(j.course || "")
    .split(" · ")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const courseNames = (courses: Course[] | undefined) => (courses || []).map((c) => (typeof c === "string" ? c : c.name));

export function courseDescription(courses: Course[] | undefined, name: string): string {
  const c = (courses || []).find((x) => (typeof x === "string" ? x === name : x.name === name));
  if (!c) return name || "";
  return typeof c === "string" ? `${c} training and certification.` : c.description || `${c.name} training and certification.`;
}

export function jobDateRange(j: Job): string {
  const from = j.trainingDate || "";
  const to = j.trainingDateTo || from;
  return from && to && to !== from ? from + " to " + to : from || to || "-";
}

export function jobInDateRange(j: Job, from: string, to: string): boolean {
  if (!from && !to) return true;
  const start = j.trainingDate || "";
  const end = j.trainingDateTo || start;
  if (!start) return false;
  return (!to || start <= to) && (!from || end >= from);
}

export const isoToday = () => new Date().toISOString().slice(0, 10);

export function addDaysIso(iso: string, days: number): string {
  const p = String(iso).split("-").map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekStartIso(iso: string): string {
  const p = String(iso).split("-").map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.toISOString().slice(0, 10);
}

/** Latest certificate expiry, or one year after the training date. */
export function jobExpiryDate(j: Job): string {
  const fromCerts = (j.certificates || [])
    .map((c) => c.expiresOn)
    .filter(Boolean)
    .sort()
    .slice(-1)[0];
  if (fromCerts) return fromCerts;
  const p = String(j.trainingDate || "")
    .slice(0, 10)
    .split("-")
    .map(Number);
  if (p.length !== 3 || !p[0]) return "";
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function jobInReportPeriod(j: Job, period: string, ref: string): boolean {
  const date = String(j.trainingDate || "").slice(0, 10);
  if (!date) return period === "all";
  if (period === "all") return true;
  if (period === "daily") return date === ref;
  if (period === "weekly") {
    const start = weekStartIso(ref);
    return date >= start && date <= addDaysIso(start, 6);
  }
  if (period === "monthly") return date.slice(0, 7) === ref.slice(0, 7);
  if (period === "yearly") return date.slice(0, 4) === ref.slice(0, 4);
  return true;
}

export function openedAt(j: Job): string {
  const s = String(j.createdAt || "");
  return s.length >= 16 ? s.slice(0, 10) + " " + s.slice(11, 16) : s.slice(0, 10) || "-";
}

/** Lower-case text of everything searchable on a job (people, certificates, numbers). */
export function jobSearchText(j: Job): string {
  const people = (j.attendees || []).map((a) => [a.name, a.idOrVisaNo, a.company, a.mobileNumber].join(" ")).join(" ");
  const certs = (j.certificates || []).map((c) => [c.name, c.certificateNo, c.course].join(" ")).join(" ");
  return [j.jobNo, j.jobOrderNo, j.customerName, j.course, j.assigneeName, j.trainerName, people, certs].join(" ").toLowerCase();
}

export const matchesSearch = (text: string, q: string) => !q.trim() || text.includes(q.toLowerCase().trim());

export function normalizeEid(v: string): string {
  const cleaned = String(v)
    .replace(/[OoDd]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/\s/g, "");
  const digits = cleaned.replace(/\D/g, "");
  return /^784\d{12}$/.test(digits)
    ? digits.slice(0, 3) + "-" + digits.slice(3, 7) + "-" + digits.slice(7, 14) + "-" + digits.slice(14)
    : cleaned.trim();
}
