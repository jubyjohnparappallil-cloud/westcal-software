import type { Course, Job } from "../types";

export const WESTCAL_NAME = "Westcal Instrumentation and Calibration Services LLC";

export const isTrainingJob = (j: Job) => !j.serviceType || j.serviceType === "Training";

/** TR number Super Admin set. WC-TR4544 and TR 4544 both print as TR4544. */
export function printedTrNo(j: Pick<Job, "jobOrderNo" | "jobNo">): string {
  const raw = String(j.jobOrderNo || j.jobNo || "").replace(/\s+/g, "").toUpperCase();
  const body = raw.replace(/^WC-/, "");
  const m = body.match(/^TR(\d+)/) || body.match(/(\d+)/);
  return m ? `TR${m[1]}` : body;
}
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
  return m ? `${m[3]}-${m[2]}-${m[1]}` : v || "-";
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

/** Every course the office can put on a certificate: the catalog, this job, and the current value. */
export function courseChoices(catalog: Course[] | undefined, job: Job, current?: string): string[] {
  return [...new Set([...courseNames(catalog), ...jobCourses(job), current || ""].map((s) => s.trim()).filter(Boolean))];
}

export function coursesForPerson(
  job: Job,
  person: { name?: string; idOrVisaNo?: string; course?: string }
): string[] {
  const allowed = jobCourses(job);
  const eid = String(person.idOrVisaNo || "").replace(/\D/g, "");
  const name = String(person.name || "").trim().toLowerCase();
  const held = (job.attendees || [])
    .filter((row) => {
      const otherEid = String(row.idOrVisaNo || "").replace(/\D/g, "");
      if (eid.length >= 15) return otherEid === eid;
      if (otherEid.length >= 15) return false;
      return !!name && String(row.name || "").trim().toLowerCase() === name;
    })
    .map((row) => String(row.course || "").trim())
    .filter((course) => course && !course.includes(" · "));
  return [...new Set(held.filter((course) => !allowed.length || allowed.includes(course)))];
}

export function jobCourses(j: Job): string[] {
  return String(j.course || "")
    .split(" · ")
    .map((s) => s.trim())
    .filter(Boolean);
}

function sameCourse(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Courses shown while editing one trainee. The course already saved stays selected. */
export function editCourseChoices(
  job: Job,
  person: { name?: string; idOrVisaNo?: string; course?: string },
): { options: string[]; selected: string[] } {
  const base = jobCourses(job);
  const current = String(person.course || "").trim();
  const currentOne = current && !current.includes(" · ") ? current : "";
  const selected: string[] = [];
  for (const name of [currentOne, ...coursesForPerson(job, person)]) {
    if (!name || selected.some((item) => sameCourse(item, name))) continue;
    selected.push(name);
  }
  const options = [...selected];
  for (const name of base) {
    if (!options.some((item) => sameCourse(item, name))) options.push(name);
  }
  return { options, selected: selected.length ? selected : options.slice(0, 1) };
}

export const courseNames = (courses: Course[] | undefined) => (courses || []).map((c) => (typeof c === "string" ? c : c.name));

export function courseDescription(courses: Course[] | undefined, name: string): string {
  const c = (courses || []).find((x) => (typeof x === "string" ? x === name : x.name === name));
  if (!c) return name || "";
  return typeof c === "string" ? `${c} training and certification.` : c.description || `${c.name} training and certification.`;
}

export function formatClock(value?: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/\b(am|pm)\b/i.test(raw)) return raw.replace(/\b(am|pm)\b/gi, (s) => s.toUpperCase());
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw);
  if (!m) return raw;
  let hour = Number(m[1]);
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${String(hour).padStart(2, "0")}:${m[2]} ${suffix}`;
}

function displayDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : value;
}

export function jobDateRange(j: Job): string {
  const from = j.trainingDate || "";
  const to = j.trainingDateTo || from;
  if (!from && !to) return "-";
  const start = displayDate(from);
  const end = displayDate(to);
  return start && end && to !== from ? start + " to " + end : start || end || "-";
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
