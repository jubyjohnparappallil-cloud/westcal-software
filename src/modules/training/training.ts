import { newId, newVerificationRef } from "../../shared/id.js";
import { DocumentCodes } from "../documents/documentCodes.js";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors.js";

/**
 * Training module — models the real Westcal training-and-certification workflow.
 * Field names mirror the hardcopy forms in the documents folder:
 *  - Training Contract Review Form (WQF11-02)
 *  - Training Work Permit (WQF11-03)
 *  - Training Attendance Sheet
 *  - Training Certificate (e.g. WC-TR4537-01 GREENERGY)
 */

export type TrainingStatus =
  | "Created"       // job created by sales/admin
  | "Assigned"      // assigned to a trainer
  | "In Progress"   // trainer delivering, capturing attendees
  | "Submitted"     // trainer submitted for approval
  | "Approved"      // admin approved, ready to issue certificates
  | "Issued"        // certificates have been issued
  | "Closed"        // job fully completed and closed (with invoice number)
  | "Rejected"      // sent back
  | "Cancelled";    // staff cancelled — reason shown to admin

/** Once the trainer has started, a job can no longer be cancelled. */
const CANCELLABLE: TrainingStatus[] = ["Created", "Assigned"];

export type TrainingMode = "Online" | "Onsite" | "Offsite";

/** Roles that a job can be assigned to and that see it in "My assigned jobs". */
export type AssigneeRole = "Trainer" | "Site Engineer";

/** The four Westcal services. Training is managed/scheduled like the others. */
export type ServiceType = "Calibration" | "Inspection" | "Testing" | "Training" | "Mapping";
/** On-site / Off-site for other services. Mapping jobs store a place name. */
export type ServiceLocation = "On-site" | "Off-site" | (string & {});
export const SERVICE_TYPES: ServiceType[] = ["Calibration", "Inspection", "Testing", "Training", "Mapping"];
const JOB_NO_START = 4538;
export const MAPPING_TYPES = ["Cold Room", "Warehouse", "Vehicle mapping", "Freezer mapping"] as const;
export type MappingType = (typeof MAPPING_TYPES)[number];
export const TEMP_RANGE_OPTIONS = ["+2°C to 8°C", "+15°C to 25°C", "15°C to 25°C"] as const;
export const MAPPING_RANGES: Record<MappingType, string[]> = {
  "Cold Room": ["+2°C to 8°C"],
  "Warehouse": ["+15°C to 25°C", "15°C to 25°C"],
  "Vehicle mapping": ["+2°C to 8°C", "+15°C to 25°C", "15°C to 25°C"],
  "Freezer mapping": ["+2°C to 8°C"],
};

/** Training Contract Review Form (WQF11-02) fields. */
export interface ContractReview {
  jobNo: string;
  customerName: string;
  crPreparedBy: string;
  contactPersonNumber: string;
  scopeOfWork: string;           // "Training & Certification"
  trainerName: string;
  standardReference: string;
  trainingMethodUsed: string;
  typeOfTraining: string;
  customerFeedback: "Positive" | "Negative" | "";
  customerFeedbackNotes?: string;
  attached: {                    // "Scope of review & attached details" checkboxes
    workPermit: boolean;
    trainingReports: boolean;
    do_: boolean;
    trainingRequestForm: boolean;
    trainingCertificates: boolean;
    invoice: boolean;
    quotation: boolean;
    finalCertificatesCopy: boolean;
    scanned: boolean;
    lpo: boolean;
  };
  checkedByMRTM: string;
  finalCheckedByBM: string;
}

/** Training Work Permit (WQF11-03) fields. */
export interface WorkPermit {
  date: string;
  jobOrderNo: string;
  customerName: string;
  address: string;
  trnNo: string;
  contactNameNumber: string;
  salesPerson: string;
  status: "In house" | "On site" | "";
  requiredDateForService: string;
  handedOverTo: string;
  assignedTo: string;
  workCodeTraining: boolean;
  workCodeCertification: boolean;
  clientRequirements: string;
}

/** A line item on the Work Permit (SN / Description / Qty / Remarks). */
export interface JobLineItem {
  sn: number;
  description: string;
  qty: string;
  remarks: string;
}

/** Site-engineer test / calibration result against a line item. */
export interface ItemTestResult {
  sn: number;
  reading: string;
  result: "Pass" | "Fail";
  remarks: string;
  recordedAt: Date;
}

export type TrainingAttachmentType =
  | "Invoice"
  | "Quotation"
  | "LPO"
  | "Training Report"
  | "Customer Document"
  | "Other";

export interface TrainingAttachment {
  id: string;
  type: TrainingAttachmentType;
  fileName: string;
  dataUrl: string;
  uploadedById: string;
  uploadedAt: Date;
}

/** An uploaded ID card + the details auto-fetched from it. */
export interface Attendee {
  id: string;
  name: string;
  company: string;
  idOrVisaNo: string;
  nationality: string;
  mobileNumber: string;
  /** ISO yyyy-mm-dd, read off the ID card. */
  dateOfBirth?: string;
  idCardFileName?: string;   // uploaded ID image reference
  /** The ID card photo captured on the phone (data URL). */
  idCardDataUrl?: string;
  /** The attendee's portrait taken from the ID card (data URL). */
  photoDataUrl?: string;
  /** Extra uploaded photo (site photo, badge, second ID, etc.). */
  extraPhotoDataUrl?: string;
  autoFetched: boolean;      // true if details came from ID auto-fetch
  /** Drawn-on-screen signature, replacing the hardcopy signature column. */
  signature?: string;
  signedAt?: Date;
  /** Lets the trainee reopen their own join link to replace a unclear photo. */
  editToken?: string;
  /** Course this trainee attended — used on their certificate. */
  course?: string;
}

export interface TrainingCertificate {
  id: string;
  certificateNo: string;     // e.g. WC-TR4537-01
  attendeeId: string;
  jobNo: string;
  name: string;
  idOrVisaNo?: string;
  company: string;
  course: string;
  trainingDate: string;
  expiresOn: string;
  verificationRef: string;
  qrDataUrl: string;
  barcodeDataUrl: string;
  generatedAt: Date;
}

export interface TrainingJob {
  id: string;
  jobNo: string;
  serviceType: ServiceType;      // Calibration | Inspection | Testing | Training
  location: ServiceLocation;     // On-site | Off-site
  course: string;                // course (Training) or scope/description (others)
  customerName: string;
  /** Every company sending people on this job. First name is the booking customer. */
  companies: string[];
  trainingDate: string;          // service/training date from
  /** Last day of the training / service (same as from for a one-day job). */
  trainingDateTo?: string;
  trainingTime?: string;         // local start time (HH:mm)
  mode: TrainingMode;
  trainerName: string;
  /** The user this job is assigned to — a Trainer or a Site Engineer. */
  assignedToId?: string;
  assigneeName?: string;
  assigneeRole?: AssigneeRole;
  status: TrainingStatus;
  // job-form fields captured at creation
  address?: string;
  trnNo?: string;
  contactNameNumber?: string;
  salesPerson?: string;
  standardReference?: string;
  typeOfTraining?: string;
  clientRequirements?: string;
  // Work Permit fields (from hardcopy WQF11-03)
  jobOrderNo?: string;
  workStatus?: "In house" | "On site" | "";
  requiredDateForService?: string;
  handedOverTo?: string;
  workCodeTraining?: boolean;
  workCodeCertification?: boolean;
  workCodeCalibration?: boolean;
  workCodeSupply?: boolean;
  workCodeRepairing?: boolean;
  /** Mapping jobs: Cold Room, Warehouse, Vehicle mapping, or Freezer mapping. */
  mappingType?: string;
  /** Temperature band for the chosen mapping type. */
  mappingRange?: string;
  /** Asset printed in the protocol, such as the warehouse or vehicle. */
  assetName?: string;
  /** Season and year printed in the protocol. */
  seasonYear?: string;
  /** Designation printed next to the Westcal engineer. */
  engineerDesignation?: string;
  /** Name printed as the Westcal engineer when it differs from the assignee. */
  protocolEngineerName?: string;
  /** Protocol number printed in the header, such as MAP-WH-039-P. */
  protocolNumber?: string;
  protocolPreparedDate?: string;
  protocolPerson1?: string;
  protocolDesignationP1?: string;
  protocolCompanyName?: string;
  protocolPerson2?: string;
  protocolDesignationP2?: string;
  protocolPerson3?: string;
  protocolDesignationP3?: string;
  /** Name printed as the mapping head. */
  mappingHeadName?: string;
  /** Size of the asset, printed as the dimension. */
  assetDimension?: string;
  resultsAddedDate?: string;
  dataAddedDate?: string;
  /** Clock time when the mapping test ends. Start time stays on trainingTime. */
  testEndTime?: string;
  /** Brand printed in place of the data logger name, such as Tempnix. */
  loggerProductName?: string;
  /** Software name printed in place of Console Plus, such as Tempnix software. */
  softwareProductName?: string;
  /** Low limit printed in the protocol. */
  minTempRange?: string;
  /** High limit printed in the protocol. */
  maxTempRange?: string;
  maxHumRange?: string;
  /** Replacement floor-plan picture for the protocol layout page. PNG data URL. */
  layoutImageDataUrl?: string;
  mappingDays?: string;
  mappingStartDate?: string;
  mappingEndDate?: string;
  assetSetPoint?: string;
  loggerTotal?: string;
  loggerMinimum?: string;
  /** Rows printed on the logger location table. */
  loggerLocations?: { loggerId: string; height: string; comments: string }[];
  /** Temperature result rows. Same columns as the protocol results table. */
  tempResults?: { loggerId: string; min: string; max: string; mean: string; pass: string; fail: string; testedBy: string; date: string }[];
  /** Humidity result rows. Same columns as the protocol humidity table. */
  humResults?: { loggerId: string; min: string; max: string; pass: string; fail: string; testedBy: string; date: string }[];
  /** Change-record rows: date, summary, reason, approved. */
  protocolChanges?: { date: string; summary: string; reason: string; approved: string }[];
  /** Protocol preparation notes. All mapping types lead here. */
  protocolNotes?: string;
  lineItems: JobLineItem[];
  /** Filled by the site engineer on Calibration / Inspection / Testing jobs. */
  itemResults: ItemTestResult[];
  contractReview?: ContractReview;
  workPermit?: WorkPermit;
  attendees: Attendee[];
  /** How many trainees the trainer expects on this sheet. */
  expectedTraineeCount?: number;
  trainerSignature?: string;
  trainerSignedAt?: Date;
  trainerVerified?: boolean;
  /** Trainer name printed as Authorized by on the attendance sheet. */
  authorizedBy?: string;
  /** Header company on the public attendance sheet (third-party insignia name). */
  sheetInsigniaName?: string;
  /** Header logo on the public attendance sheet (data URL). */
  sheetInsigniaLogoDataUrl?: string;
  /** Left label on the public sheet, e.g. WESTCAL Job or AITS Job. */
  sheetJobLabel?: string;
  /** Job number printed on the public sheet. */
  sheetJobNo?: string;
  /** Short training code printed left of "as". */
  sheetCourseCode?: string;
  /** Course title printed on the public sheet. */
  sheetCourseTitle?: string;
  /** Invoiced / intermediate company printed as Company on the public sheet. */
  sheetCompany?: string;
  /** Company printed as Certified to on the attendance sheet and certificates. */
  certificateUnder?: string;
  /** Chosen Westcal certificate template when issuing. */
  certificateDesign?: string;
  /** Public join link token sent to trainees (no login). */
  traineeInviteToken?: string;
  /** Optional supporting files such as invoice, quotation, LPO or report. */
  attachments: TrainingAttachment[];
  certificates: TrainingCertificate[];
  /** Invoice number added by Office Admin */
  invoiceNumber?: string;
  /** Date when invoice was added */
  invoicedAt?: Date;
  /** Who marked the job as invoiced */
  invoicedBy?: string;
  /** Date when job was closed */
  closedAt?: Date;
  /** Who closed the job */
  closedBy?: string;
  approvedBy?: string;
  /** Date when certificates were issued */
  issuedAt?: Date;
  rejectedReason?: string;
  cancelledReason?: string;
  cancelledBy?: string;
  cancelledAt?: Date;
  /** Staff ask to cancel; only the Super Admin approves or rejects it. */
  cancelRequest?: { reason: string; requestedBy: string; requestedById: string; requestedAt: Date };
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

function jobCompanyList(job: { customerName?: string; companies?: string[] }): string[] {
  return [...new Set(
    [job.customerName, ...(job.companies ?? [])].map((name) => String(name ?? "").trim()).filter(Boolean)
  )];
}

function joinCompanyNames(customerName?: string, companies?: string[]): string[] {
  return [...new Set(
    [customerName, ...(companies ?? [])].map((name) => String(name ?? "").trim()).filter(Boolean)
  )];
}

function jobCourseList(course?: string): string[] {
  return String(course ?? "").split(" · ").map((name) => name.trim()).filter(Boolean);
}

function normalizePersonName(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The course this row is actually enrolled on — not the job's combined list. */
function attendeeAssignedCourse(attendee: { course?: string }): string {
  const assigned = String(attendee.course ?? "").trim();
  if (!assigned || assigned.includes(" · ")) return "";
  return assigned;
}

function isSameTrainee(
  attendee: Attendee,
  fetched: { name: string; mobileNumber: string; idOrVisaNo?: string }
): boolean {
  const eid = String(fetched.idOrVisaNo ?? "").replace(/\D/g, "");
  const otherEid = String(attendee.idOrVisaNo ?? "").replace(/\D/g, "");
  if (eid.length === 15 && otherEid.length === 15 && eid === otherEid) return true;
  const sameName = normalizePersonName(attendee.name) === normalizePersonName(fetched.name);
  const samePhone = !!fetched.mobileNumber && attendee.mobileNumber === fetched.mobileNumber;
  return sameName && samePhone;
}

function joinCourseNames(course?: string, courses?: string[]): string {
  const fromList = (courses ?? []).map((name) => String(name ?? "").trim()).filter(Boolean);
  if (fromList.length) return [...new Set(fromList)].join(" · ");
  return (course ?? "").trim();
}

function ymd(value: string, field: string): string {
  const date = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ValidationError("date must be yyyy-mm-dd", field);
  }
  return date;
}

function resolveDateRange(from?: string, to?: string): { trainingDate: string; trainingDateTo: string } {
  const trainingDate = ymd(from ?? "", "trainingDate");
  const trainingDateTo = String(to ?? "").trim() ? ymd(String(to), "trainingDateTo") : trainingDate;
  if (trainingDateTo < trainingDate) {
    throw new ValidationError("date to cannot be before date from", "trainingDateTo");
  }
  return { trainingDate, trainingDateTo };
}

export function formatJobDates(job: { trainingDate?: string; trainingDateTo?: string }): string {
  const from = String(job.trainingDate ?? "").trim();
  const to = String(job.trainingDateTo ?? "").trim();
  if (from && to && to !== from) return `${from} to ${to}`;
  return from || to || "";
}

/** One course name for one trainee certificate — never the joined job list. */
function attendeeCertificateCourse(job: TrainingJob, requested?: string): string {
  const allowed = jobCourseList(job.course);
  const asked = String(requested ?? "").trim();
  const single = asked && !asked.includes(" · ") ? asked : "";
  if (single && (!allowed.length || allowed.includes(single))) return single;
  if (allowed.length === 1) return allowed[0];
  if (allowed.length > 1) {
    throw new ValidationError("select one training course for this trainee", "course");
  }
  return single;
}

export interface CreateTrainingInput {
  serviceType?: ServiceType;
  location?: ServiceLocation;
  course?: string;
  /** Several training courses on one job. Joined into `course` for display. */
  courses?: string[];
  customerName: string;
  /** All companies attending this job. Stored on the job for trainee pickers. */
  companies?: string[];
  /** Company name printed as Certified by (defaults to the invoiced company). */
  certificateUnder?: string;
  certifiedBy?: string;
  trainingDate: string;
  trainingDateTo?: string;
  trainingTime?: string;
  mode?: TrainingMode;
  trainerName?: string;
  createdById: string;
  // extra job-form fields (from the hardcopy Work Permit / Contract Review)
  address?: string;
  trnNo?: string;
  contactNameNumber?: string;
  salesPerson?: string;
  standardReference?: string;
  typeOfTraining?: string;
  clientRequirements?: string;
  jobOrderNo?: string;
  workStatus?: "In house" | "On site" | "";
  requiredDateForService?: string;
  handedOverTo?: string;
  workCodeTraining?: boolean;
  workCodeCertification?: boolean;
  workCodeCalibration?: boolean;
  workCodeSupply?: boolean;
  workCodeRepairing?: boolean;
  mappingType?: string;
  mappingRange?: string;
  assetName?: string;
  seasonYear?: string;
  engineerDesignation?: string;
  protocolEngineerName?: string;
  protocolNumber?: string;
  protocolPreparedDate?: string;
  protocolPerson1?: string;
  protocolDesignationP1?: string;
  protocolCompanyName?: string;
  protocolPerson2?: string;
  protocolDesignationP2?: string;
  protocolPerson3?: string;
  protocolDesignationP3?: string;
  mappingHeadName?: string;
  assetDimension?: string;
  resultsAddedDate?: string;
  dataAddedDate?: string;
  testEndTime?: string;
  loggerProductName?: string;
  softwareProductName?: string;
  minTempRange?: string;
  maxTempRange?: string;
  maxHumRange?: string;
  /** Replacement floor-plan picture for the protocol layout page. PNG data URL. */
  layoutImageDataUrl?: string;
  mappingDays?: string;
  mappingStartDate?: string;
  mappingEndDate?: string;
  assetSetPoint?: string;
  loggerTotal?: string;
  loggerMinimum?: string;
  loggerLocations?: { loggerId: string; height: string; comments: string }[];
  tempResults?: { loggerId: string; min: string; max: string; mean: string; pass: string; fail: string; testedBy: string; date: string }[];
  humResults?: { loggerId: string; min: string; max: string; pass: string; fail: string; testedBy: string; date: string }[];
  protocolChanges?: { date: string; summary: string; reason: string; approved: string }[];
  protocolNotes?: string;
  lineItems?: JobLineItem[];
  certificateDesign?: string;
}

/** A notification for the mobile/side app (e.g. "job assigned to you"). */
export interface Notification {
  id: string;
  userId: string;      // recipient
  message: string;
  jobId: string;
  read: boolean;
  createdAt: Date;
}

const MODES: TrainingMode[] = ["Online", "Onsite", "Offsite"];

export interface TrainingSnapshot {
  jobs: TrainingJob[];
  notifications: Notification[];
  jobSeq: number;
  certSeq: number;
  trainingOrderSeq: number;
  serviceOrderSeq: number;
}

function cleanLoggerLocations(value: unknown): { loggerId: string; height: string; comments: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value
    .map((row) => ({
      loggerId: String((row as { loggerId?: string })?.loggerId ?? "").trim(),
      height: String((row as { height?: string })?.height ?? "").trim(),
      comments: String((row as { comments?: string })?.comments ?? "").trim(),
    }))
    .filter((row) => row.loggerId);
  return rows;
}

function cell(row: unknown, key: string): string {
  return String((row as Record<string, string> | undefined)?.[key] ?? "").trim();
}

function cleanTempResults(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((row) => ({
      loggerId: cell(row, "loggerId"),
      min: cell(row, "min"),
      max: cell(row, "max"),
      mean: cell(row, "mean"),
      pass: cell(row, "pass"),
      fail: cell(row, "fail"),
      testedBy: cell(row, "testedBy"),
      date: cell(row, "date"),
    }))
    .filter((row) => row.loggerId);
}

function cleanHumResults(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((row) => ({
      loggerId: cell(row, "loggerId"),
      min: cell(row, "min"),
      max: cell(row, "max"),
      pass: cell(row, "pass"),
      fail: cell(row, "fail"),
      testedBy: cell(row, "testedBy"),
      date: cell(row, "date"),
    }))
    .filter((row) => row.loggerId);
}

function cleanProtocolChanges(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((row) => ({
      date: cell(row, "date"),
      summary: cell(row, "summary"),
      reason: cell(row, "reason"),
      approved: cell(row, "approved"),
    }))
    .filter((row) => row.date || row.summary || row.reason || row.approved);
}

function asDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function reviveTrainingJob(raw: TrainingJob): TrainingJob {
  return {
    ...raw,
    companies: raw.companies?.length ? raw.companies : jobCompanyList(raw),
    lineItems: raw.lineItems ?? [],
    itemResults: (raw.itemResults ?? []).map((r) => ({
      ...r,
      recordedAt: asDate(r.recordedAt) ?? new Date(),
    })),
    attendees: (raw.attendees ?? []).map((a) => ({
      ...a,
      signedAt: asDate(a.signedAt),
    })),
    attachments: (raw.attachments ?? []).map((a) => ({
      ...a,
      uploadedAt: asDate(a.uploadedAt) ?? new Date(),
    })),
    certificates: (raw.certificates ?? []).map((c) => ({
      ...c,
      generatedAt: asDate(c.generatedAt) ?? new Date(),
    })),
    trainerSignedAt: asDate(raw.trainerSignedAt),
    cancelledAt: asDate(raw.cancelledAt),
    cancelRequest: raw.cancelRequest
      ? { ...raw.cancelRequest, requestedAt: asDate(raw.cancelRequest.requestedAt) ?? new Date() }
      : undefined,
    createdAt: asDate(raw.createdAt) ?? new Date(),
    updatedAt: asDate(raw.updatedAt) ?? new Date(),
  };
}

export class TrainingService {
  private readonly jobs = new Map<string, TrainingJob>();
  private readonly notifications: Notification[] = [];
  private jobSeq = 0;
  private readonly lastJobNo = new Map<string, number>();
  private certSeq = 0;
  private trainingOrderSeq = 4500;
  private serviceOrderSeq = 120;

  constructor(
    private readonly codes: DocumentCodes,
    private readonly isTrainer: (userId: string) => boolean,
    private readonly isSiteEngineer: (userId: string) => boolean = () => false
  ) {}

  exportSnapshot(): TrainingSnapshot {
    return {
      jobs: [...this.jobs.values()],
      notifications: [...this.notifications],
      jobSeq: this.jobSeq,
      certSeq: this.certSeq,
      trainingOrderSeq: this.trainingOrderSeq,
      serviceOrderSeq: this.serviceOrderSeq,
    };
  }

  loadSnapshot(snap: TrainingSnapshot): void {
    this.jobs.clear();
    for (const raw of snap.jobs ?? []) {
      const job = reviveTrainingJob(raw);
      this.jobs.set(job.id, job);
    }
    this.notifications.length = 0;
    for (const n of snap.notifications ?? []) {
      this.notifications.push({
        ...n,
        createdAt: n.createdAt ? new Date(n.createdAt) : new Date(),
      });
    }
    this.jobSeq = Number(snap.jobSeq) || this.jobs.size;
    this.certSeq = Number(snap.certSeq) || 0;
    this.trainingOrderSeq = Number(snap.trainingOrderSeq) || 4500;
    this.serviceOrderSeq = Number(snap.serviceOrderSeq) || 120;
  }

  /** Which assignable role a user holds, or undefined if they hold neither. */
  private assigneeRoleOf(userId: string): AssigneeRole | undefined {
    if (this.isTrainer(userId)) return "Trainer";
    if (this.isSiteEngineer(userId)) return "Site Engineer";
    return undefined;
  }

  private notify(userId: string, message: string, jobId: string): void {
    this.notifications.push({
      id: newId(), userId, message, jobId, read: false, createdAt: new Date(),
    });
  }

  /** Public helper so the API layer can raise notifications (e.g. to admins). */
  notifyUser(userId: string, message: string, jobId: string): void {
    this.notify(userId, message, jobId);
  }

  getNotifications(userId: string): Notification[] {
    return this.notifications.filter((n) => n.userId === userId).reverse();
  }

  markNotificationsRead(userId: string): void {
    this.notifications.forEach((n) => { if (n.userId === userId) n.read = true; });
  }

  /** Each service numbers its own jobs; numbers of deleted jobs are not reused while the server runs. */
  private nextJobNo(serviceType: ServiceType): string {
    this.jobSeq += 1;
    const prefix = { Calibration: "CAL", Inspection: "INS", Testing: "TST", Training: "TR", Mapping: "MAP" }[serviceType];
    const pattern = new RegExp(`^WC-${prefix}(\\d+)$`);
    let highest = Math.max(JOB_NO_START - 1, this.lastJobNo.get(prefix) ?? 0);
    for (const j of this.jobs.values()) {
      const m = pattern.exec(j.jobNo);
      if (m) highest = Math.max(highest, Number(m[1]));
    }
    this.lastJobNo.set(prefix, highest + 1);
    return `WC-${prefix}${highest + 1}`;
  }

  /** Next job-order number without consuming it (for the create-job form). */
  peekNextJobOrderNo(serviceType: ServiceType = "Training"): string {
    const training = serviceType === "Training";
    const n = training ? this.trainingOrderSeq : this.serviceOrderSeq;
    if (serviceType === "Mapping") return String(n);
    return training ? `TR ${n}` : `JO ${n}`;
  }

  private allocateJobOrderNo(serviceType: ServiceType): string {
    const no = this.peekNextJobOrderNo(serviceType);
    if (serviceType === "Training") this.trainingOrderSeq += 1;
    else this.serviceOrderSeq += 1;
    return no;
  }

  /** Create a service job of any type (Calibration/Inspection/Testing/Training). */
  createJob(input: CreateTrainingInput): TrainingJob {
    const course = joinCourseNames(input.course, input.courses);
    const companies = joinCompanyNames(input.customerName, input.companies);
    if (!companies.length) throw new ValidationError("at least one company is required", "customerName");
    if (!course && !String(input.mappingType ?? "").trim()) throw new ValidationError("scope/course is required", "course");
    if (!input.address?.trim()) throw new ValidationError("site address is required", "address");
    const isMapping = (input.serviceType ?? "Training") === "Mapping";
    let fromDate = input.trainingDate;
    let toDate = input.trainingDateTo;
    if (isMapping && !String(fromDate ?? "").trim()) {
      const today = new Date().toISOString().slice(0, 10);
      fromDate = String(input.mappingStartDate ?? "").trim() || today;
      toDate = String(toDate ?? "").trim() || String(input.mappingEndDate ?? "").trim() || fromDate;
    }
    const { trainingDate, trainingDateTo } = resolveDateRange(fromDate, toDate);
    const mode: TrainingMode = input.mode && MODES.includes(input.mode) ? input.mode : "Onsite";

    const serviceType: ServiceType = input.serviceType ?? "Training";
    const location: ServiceLocation = input.location ?? "On-site";
    const lineItems = input.lineItems ?? [];
    if (serviceType !== "Training" && serviceType !== "Mapping" && lineItems.length < 1) {
      throw new ValidationError("at least one line item is required", "lineItems");
    }
    let mappingType = String(input.mappingType ?? "").trim();
    let mappingRange = String(input.mappingRange ?? "").trim();
    if (serviceType === "Mapping") {
      if (!MAPPING_TYPES.includes(mappingType as MappingType)) {
        throw new ValidationError("choose a mapping type", "mappingType");
      }
      const allowed = MAPPING_RANGES[mappingType as MappingType];
      if (!mappingRange) {
        if (mappingType === "Vehicle mapping") throw new ValidationError("enter the temperature range", "mappingRange");
        mappingRange = allowed[0];
      }
    } else {
      mappingType = "";
      mappingRange = "";
    }
    const scope = serviceType === "Mapping"
      ? `${mappingType}${mappingRange ? ` · ${mappingRange}` : ""}`
      : course;

    const now = new Date();
    const job: TrainingJob = {
      id: newId(),
      jobNo: this.nextJobNo(serviceType),
      serviceType,
      location,
      course: scope,
      customerName: companies[0],
      companies,
      certificateUnder: String(input.certificateUnder ?? input.certifiedBy ?? "").trim() || companies[0],
      trainingDate,
      trainingDateTo,
      trainingTime: input.trainingTime,
      mode,
      trainerName: input.trainerName ?? "",
      status: "Created",
      address: input.address,
      trnNo: input.trnNo,
      contactNameNumber: input.contactNameNumber,
      salesPerson: input.salesPerson,
      standardReference: input.standardReference,
      typeOfTraining: input.typeOfTraining,
      clientRequirements: input.clientRequirements,
      jobOrderNo: this.allocateJobOrderNo(serviceType),
      workStatus: input.workStatus,
      requiredDateForService: input.requiredDateForService,
      handedOverTo: input.handedOverTo,
      workCodeTraining: input.workCodeTraining,
      workCodeCertification: input.workCodeCertification,
      workCodeCalibration: input.workCodeCalibration,
      workCodeSupply: input.workCodeSupply,
      workCodeRepairing: input.workCodeRepairing,
      mappingType: mappingType || undefined,
      mappingRange: mappingRange || undefined,
      assetName: input.assetName,
      seasonYear: input.seasonYear,
      engineerDesignation: input.engineerDesignation,
      protocolEngineerName: input.protocolEngineerName,
      protocolNumber: input.protocolNumber,
      protocolPreparedDate: input.protocolPreparedDate,
      protocolPerson1: input.protocolPerson1,
      protocolDesignationP1: input.protocolDesignationP1,
      protocolCompanyName: input.protocolCompanyName,
      protocolPerson2: input.protocolPerson2,
      protocolDesignationP2: input.protocolDesignationP2,
      protocolPerson3: input.protocolPerson3,
      protocolDesignationP3: input.protocolDesignationP3,
      mappingHeadName: input.mappingHeadName,
      assetDimension: input.assetDimension,
      resultsAddedDate: input.resultsAddedDate,
      dataAddedDate: input.dataAddedDate,
      testEndTime: input.testEndTime,
      loggerProductName: input.loggerProductName,
      softwareProductName: input.softwareProductName,
      minTempRange: input.minTempRange,
      maxTempRange: input.maxTempRange,
      maxHumRange: input.maxHumRange,
      layoutImageDataUrl: String(input.layoutImageDataUrl || "").startsWith("data:image/") ? String(input.layoutImageDataUrl) : undefined,
      mappingDays: input.mappingDays,
      mappingStartDate: input.mappingStartDate,
      mappingEndDate: input.mappingEndDate,
      assetSetPoint: input.assetSetPoint,
      loggerTotal: input.loggerTotal,
      loggerMinimum: input.loggerMinimum,
      loggerLocations: cleanLoggerLocations(input.loggerLocations),
      tempResults: cleanTempResults(input.tempResults),
      humResults: cleanHumResults(input.humResults),
      protocolChanges: cleanProtocolChanges(input.protocolChanges),
      protocolNotes: input.protocolNotes,
      certificateDesign: input.certificateDesign || "achievement",
      lineItems,
      itemResults: [],
      attendees: [],
      traineeInviteToken: newId(),
      expectedTraineeCount: undefined,
      trainerSignature: undefined,
      trainerVerified: false,
      attachments: [],
      certificates: [],
      createdById: input.createdById,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  getJob(id: string): TrainingJob {
    const j = this.jobs.get(id);
    if (!j) throw new NotFoundError("training job not found");
    if (!j.traineeInviteToken) j.traineeInviteToken = newId();
    if (!j.companies || !j.companies.length) j.companies = jobCompanyList(j);
    if (!j.trainingDateTo) j.trainingDateTo = j.trainingDate;
    return j;
  }

  getJobByInviteToken(token: string): TrainingJob {
    const t = String(token ?? "").trim();
    const job = [...this.jobs.values()].find((j) => j.traineeInviteToken === t);
    if (!job) throw new NotFoundError("trainee link is not valid");
    return job;
  }

  publicJoinInfo(token: string) {
    const job = this.getJobByInviteToken(token);
    const expected = job.expectedTraineeCount || 0;
    const marked = job.attendees.length;
    const remaining = expected ? Math.max(0, expected - marked) : 0;
    return {
      course: job.course,
      customerName: job.customerName,
      trainingDate: job.trainingDate,
      trainingTime: job.trainingTime || "",
      address: job.address || job.location || "",
      jobNo: job.jobOrderNo || job.jobNo,
      trainerName: job.assigneeName || job.trainerName || "",
      expected,
      marked,
      remaining: expected ? remaining : null,
      courses: jobCourseList(job.course),
      companies: job.companies?.length ? job.companies : [job.customerName].filter(Boolean),
      open: job.status !== "Approved" && job.status !== "Issued" && job.status !== "Cancelled",
      closedReason: job.status === "Approved" || job.status === "Issued"
        ? "This training is closed. Certificates are being issued."
        : job.status === "Cancelled"
          ? "This training was cancelled."
          : "",
    };
  }

  publicSlotInfo(inviteToken: string, editToken: string) {
    const job = this.getJobByInviteToken(inviteToken);
    const attendee = job.attendees.find((a) => a.editToken === editToken);
    if (!attendee) throw new NotFoundError("trainee record not found");
    if (job.status === "Approved" || job.status === "Issued") {
      throw new ConflictError("this training is closed", "status");
    }
    return {
      name: attendee.name,
      mobileNumber: attendee.mobileNumber,
      company: attendee.company || job.customerName,
      course: attendee.course || job.course,
      idOrVisaNo: attendee.idOrVisaNo || "",
      hasPhoto: !!(attendee.photoDataUrl || attendee.extraPhotoDataUrl),
      hasSignature: !!attendee.signature,
    };
  }

  /** Edit job fields. Admin may still correct dates and names after certificates are issued. */
  editJob(id: string, patch: Partial<CreateTrainingInput>): TrainingJob {
    const job = this.getJob(id);
    if (job.status === "Cancelled") {
      throw new ConflictError("a cancelled job cannot be edited", "status");
    }
    const dateTouched = patch.trainingDate !== undefined || patch.trainingDateTo !== undefined;
    const companyTouched = patch.certificateUnder !== undefined || patch.certifiedBy !== undefined;
    Object.assign(job, {
      location: patch.location ?? job.location,
      course: joinCourseNames(patch.course, patch.courses) || job.course,
      trainingTime: patch.trainingTime ?? job.trainingTime,
      mode: patch.mode ?? job.mode,
      address: patch.address ?? job.address,
      trnNo: patch.trnNo ?? job.trnNo,
      contactNameNumber: patch.contactNameNumber ?? job.contactNameNumber,
      salesPerson: patch.salesPerson ?? job.salesPerson,
      standardReference: patch.standardReference ?? job.standardReference,
      typeOfTraining: patch.typeOfTraining ?? job.typeOfTraining,
      clientRequirements: patch.clientRequirements ?? job.clientRequirements,
      jobOrderNo: patch.jobOrderNo ?? job.jobOrderNo,
      workStatus: patch.workStatus ?? job.workStatus,
      requiredDateForService: patch.requiredDateForService ?? job.requiredDateForService,
      handedOverTo: patch.handedOverTo ?? job.handedOverTo,
      workCodeTraining: patch.workCodeTraining ?? job.workCodeTraining,
      workCodeCertification: patch.workCodeCertification ?? job.workCodeCertification,
      workCodeCalibration: patch.workCodeCalibration ?? job.workCodeCalibration,
      workCodeSupply: patch.workCodeSupply ?? job.workCodeSupply,
      workCodeRepairing: patch.workCodeRepairing ?? job.workCodeRepairing,
      mappingType: patch.mappingType ?? job.mappingType,
      mappingRange: patch.mappingRange ?? job.mappingRange,
      assetName: patch.assetName ?? job.assetName,
      seasonYear: patch.seasonYear ?? job.seasonYear,
      engineerDesignation: patch.engineerDesignation ?? job.engineerDesignation,
      protocolEngineerName: patch.protocolEngineerName ?? job.protocolEngineerName,
      protocolNumber: patch.protocolNumber ?? job.protocolNumber,
      protocolPreparedDate: patch.protocolPreparedDate ?? job.protocolPreparedDate,
      protocolPerson1: patch.protocolPerson1 ?? job.protocolPerson1,
      protocolDesignationP1: patch.protocolDesignationP1 ?? job.protocolDesignationP1,
      protocolCompanyName: patch.protocolCompanyName ?? job.protocolCompanyName,
      protocolPerson2: patch.protocolPerson2 ?? job.protocolPerson2,
      protocolDesignationP2: patch.protocolDesignationP2 ?? job.protocolDesignationP2,
      protocolPerson3: patch.protocolPerson3 ?? job.protocolPerson3,
      protocolDesignationP3: patch.protocolDesignationP3 ?? job.protocolDesignationP3,
      mappingHeadName: patch.mappingHeadName ?? job.mappingHeadName,
      assetDimension: patch.assetDimension ?? job.assetDimension,
      resultsAddedDate: patch.resultsAddedDate ?? job.resultsAddedDate,
      dataAddedDate: patch.dataAddedDate ?? job.dataAddedDate,
      testEndTime: patch.testEndTime ?? job.testEndTime,
      loggerProductName: patch.loggerProductName ?? job.loggerProductName,
      softwareProductName: patch.softwareProductName ?? job.softwareProductName,
      minTempRange: patch.minTempRange ?? job.minTempRange,
      maxTempRange: patch.maxTempRange ?? job.maxTempRange,
      maxHumRange: patch.maxHumRange ?? job.maxHumRange,
      mappingDays: patch.mappingDays ?? job.mappingDays,
      mappingStartDate: patch.mappingStartDate ?? job.mappingStartDate,
      mappingEndDate: patch.mappingEndDate ?? job.mappingEndDate,
      assetSetPoint: patch.assetSetPoint ?? job.assetSetPoint,
      loggerTotal: patch.loggerTotal ?? job.loggerTotal,
      loggerMinimum: patch.loggerMinimum ?? job.loggerMinimum,
      loggerLocations: patch.loggerLocations !== undefined ? cleanLoggerLocations(patch.loggerLocations) : job.loggerLocations,
      tempResults: patch.tempResults !== undefined ? cleanTempResults(patch.tempResults) : job.tempResults,
      humResults: patch.humResults !== undefined ? cleanHumResults(patch.humResults) : job.humResults,
      protocolChanges: patch.protocolChanges !== undefined ? cleanProtocolChanges(patch.protocolChanges) : job.protocolChanges,
      protocolNotes: patch.protocolNotes ?? job.protocolNotes,
      layoutImageDataUrl: patch.layoutImageDataUrl !== undefined
        ? (String(patch.layoutImageDataUrl || "").startsWith("data:image/") ? String(patch.layoutImageDataUrl) : undefined)
        : job.layoutImageDataUrl,
      certificateDesign: patch.certificateDesign ?? job.certificateDesign,
      lineItems: patch.lineItems ?? job.lineItems,
    });
    if (job.serviceType === "Mapping" && (patch.mappingType !== undefined || patch.mappingRange !== undefined)) {
      const mappingType = String(job.mappingType ?? "").trim();
      const mappingRange = String(job.mappingRange ?? "").trim();
      job.course = `${mappingType}${mappingRange ? ` · ${mappingRange}` : ""}`;
    }
    if (patch.customerName !== undefined || patch.companies !== undefined) {
      const companies = joinCompanyNames(patch.customerName ?? job.customerName, patch.companies ?? job.companies);
      if (!companies.length) throw new ValidationError("at least one company is required", "customerName");
      job.customerName = companies[0];
      job.companies = companies;
    }
    if (patch.trainingDate !== undefined || patch.trainingDateTo !== undefined) {
      const range = resolveDateRange(
        patch.trainingDate ?? job.trainingDate,
        patch.trainingDateTo ?? job.trainingDateTo
      );
      job.trainingDate = range.trainingDate;
      job.trainingDateTo = range.trainingDateTo;
    }
    if (patch.certificateUnder !== undefined || patch.certifiedBy !== undefined) {
      job.certificateUnder = String(patch.certificateUnder ?? patch.certifiedBy ?? "").trim() || job.customerName;
    }
    job.updatedAt = new Date();
    if (job.status === "Approved" || job.status === "Issued") {
      this.refreshIssuedCertificates(job, { dates: dateTouched, company: companyTouched });
    }
    return job;
  }

  deleteJob(id: string): void {
    if (!this.jobs.has(id)) throw new NotFoundError("training job not found");
    this.jobs.delete(id);
  }

  listJobs(): TrainingJob[] {
    return [...this.jobs.values()];
  }

  findCertificateByVerificationRef(
    verificationRef: string
  ): { job: TrainingJob; certificate: TrainingCertificate } | undefined {
    for (const job of this.jobs.values()) {
      const certificate = job.certificates.find((c) => c.verificationRef === verificationRef);
      if (certificate) return { job, certificate };
    }
    return undefined;
  }

  /** Jobs assigned to one user — this is the "my area" list in the mobile app. */
  listForAssignee(userId: string): TrainingJob[] {
    return [...this.jobs.values()].filter((j) => j.assignedToId === userId);
  }

  /** After users are restored, point jobs at the live trainer/engineer ids. */
  relinkMissingAssignees(users: Array<{ id: string; displayName: string; identifier: string }>): number {
    let n = 0;
    const byId = new Set(users.map((u) => u.id));
    for (const job of this.jobs.values()) {
      if (!job.assignedToId) continue;
      if (byId.has(job.assignedToId)) continue;
      const label = String(job.assigneeName || job.trainerName || "").trim().toLowerCase();
      const match =
        users.find((u) => u.displayName.toLowerCase() === label) ||
        users.find((u) => u.identifier === "trainer1" && (!job.serviceType || job.serviceType === "Training"));
      if (!match) continue;
      job.assignedToId = match.id;
      job.assigneeName = match.displayName;
      n += 1;
    }
    return n;
  }

  /**
   * Admin assigns the job to a Trainer or a Site Engineer. The assignee sees it
   * in their own job list immediately and gets a notification, which is what
   * the mobile app polls.
   */
  assignJob(jobId: string, assigneeId: string, assigneeName: string): TrainingJob {
    const job = this.getJob(jobId);
    if (job.status === "Cancelled") {
      throw new ConflictError("a cancelled job cannot be assigned", "status");
    }
    if (job.status === "Approved" || job.status === "Issued") {
      throw new ConflictError("an approved/issued job cannot be reassigned", "status");
    }
    const role = this.assigneeRoleOf(assigneeId);
    if (!role) {
      throw new ValidationError("assignee must be a Trainer or Site Engineer", "assigneeId");
    }
    job.assignedToId = assigneeId;
    job.assigneeName = assigneeName;
    job.assigneeRole = role;
    // trainerName is what the printed Work Permit / certificates read from
    job.trainerName = assigneeName;
    job.status = "Assigned";
    job.updatedAt = new Date();
    // notify the assignee (this drives the mobile-app notification)
    this.notify(assigneeId, `New job assigned: ${job.jobNo} — ${job.course} for ${job.customerName}`, job.id);
    return job;
  }

  saveContractReview(jobId: string, review: ContractReview): TrainingJob {
    const job = this.getJob(jobId);
    job.contractReview = review;
    job.updatedAt = new Date();
    return job;
  }

  addAttachment(
    jobId: string,
    input: {
      type: TrainingAttachmentType;
      fileName: string;
      dataUrl: string;
      uploadedById: string;
    }
  ): TrainingAttachment {
    const job = this.getJob(jobId);
    if (!input.fileName?.trim() || !input.dataUrl?.startsWith("data:")) {
      throw new ValidationError("choose a valid attachment", "file");
    }
    const allowed: TrainingAttachmentType[] = [
      "Invoice", "Quotation", "LPO", "Training Report", "Customer Document", "Other",
    ];
    if (!allowed.includes(input.type)) {
      throw new ValidationError("invalid attachment type", "type");
    }
    const attachment: TrainingAttachment = {
      id: newId(),
      type: input.type,
      fileName: input.fileName.trim(),
      dataUrl: input.dataUrl,
      uploadedById: input.uploadedById,
      uploadedAt: new Date(),
    };
    job.attachments.push(attachment);
    job.updatedAt = new Date();
    return attachment;
  }

  saveWorkPermit(jobId: string, permit: WorkPermit): TrainingJob {
    const job = this.getJob(jobId);
    job.workPermit = permit;
    job.updatedAt = new Date();
    return job;
  }

  /**
   * Site engineer records a Pass/Fail (+ reading) against a line item on a
   * Calibration, Inspection or Testing job.
   */
  recordItemResult(
    jobId: string,
    input: { sn: number; reading?: string; result: "Pass" | "Fail"; remarks?: string }
  ): ItemTestResult {
    const job = this.getJob(jobId);
    if (job.serviceType === "Training") {
      throw new ValidationError("training jobs use attendance, not item results", "serviceType");
    }
    const sn = Number(input.sn);
    const item = job.lineItems.find((l) => l.sn === sn);
    if (!item) throw new ValidationError("line item not found", "sn");
    if (input.result !== "Pass" && input.result !== "Fail") {
      throw new ValidationError("result must be Pass or Fail", "result");
    }
    const rec: ItemTestResult = {
      sn,
      reading: String(input.reading ?? "").trim(),
      result: input.result,
      remarks: String(input.remarks ?? "").trim(),
      recordedAt: new Date(),
    };
    job.itemResults = job.itemResults.filter((r) => r.sn !== rec.sn);
    job.itemResults.push(rec);
    job.itemResults.sort((a, b) => a.sn - b.sn);
    if (job.status === "Assigned") job.status = "In Progress";
    job.updatedAt = new Date();
    return rec;
  }

  addAttendeeFromId(
    jobId: string,
    fetched: {
      name: string;
      company: string;
      idOrVisaNo: string;
      nationality: string;
      mobileNumber: string;
      dateOfBirth?: string;
      idCardFileName?: string;
      idCardDataUrl?: string;
      photoDataUrl?: string;
      extraPhotoDataUrl?: string;
      signature?: string;
      autoFetched?: boolean;
      course?: string;
      courses?: string[];
    }
  ): Attendee {
    const job = this.getJob(jobId);
    if (job.status === "Cancelled") {
      throw new ConflictError("a cancelled job cannot take more attendance", "status");
    }
    if (!fetched.name?.trim()) throw new ValidationError("name is required", "name");
    // Mobile number is now optional - validation removed
    const mobileNumber = String(fetched.mobileNumber ?? "").replace(/[\s-+]/g, "");
    if (fetched.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(fetched.dateOfBirth)) {
      throw new ValidationError("date of birth must be yyyy-mm-dd", "dateOfBirth");
    }
    const fromList = (fetched.courses ?? []).map((name) => String(name ?? "").trim()).filter(Boolean);
    const raw = fromList.length ? fromList : [String(fetched.course ?? "").trim()].filter(Boolean);
    const fallback = !raw.length && jobCourseList(job.course).length === 1 ? jobCourseList(job.course) : raw;
    const courseNames = [...new Set(fallback.map((name) => attendeeCertificateCourse(job, name)))];
    if (!courseNames.length) {
      throw new ValidationError("select at least one training course for this trainee", "course");
    }
    if (job.expectedTraineeCount && job.attendees.length + courseNames.length > job.expectedTraineeCount) {
      job.expectedTraineeCount = job.attendees.length + courseNames.length;
    }
    let last: Attendee | undefined;
    for (const course of courseNames) {
      last = this.pushAttendeeRow(job, { ...fetched, mobileNumber, course });
    }
    if (job.status === "Assigned") job.status = "In Progress";
    job.updatedAt = new Date();
    return last!;
  }

  private pushAttendeeRow(
    job: TrainingJob,
    fetched: {
      name: string;
      company: string;
      idOrVisaNo?: string;
      nationality?: string;
      mobileNumber: string;
      dateOfBirth?: string;
      idCardFileName?: string;
      idCardDataUrl?: string;
      photoDataUrl?: string;
      extraPhotoDataUrl?: string;
      signature?: string;
      autoFetched?: boolean;
      course: string;
    }
  ): Attendee {
    const course = fetched.course;
    const duplicate = job.attendees.find(
      (a) => attendeeAssignedCourse(a) === course && isSameTrainee(a, fetched)
    );
    if (duplicate) {
      throw new ConflictError(
        `${duplicate.name} is already on ${course}. Tick a different course, or edit that trainee's row.`,
        "attendees"
      );
    }
    const attendee: Attendee = {
      id: newId(),
      name: fetched.name.trim(),
      company: fetched.company?.trim() ?? "",
      idOrVisaNo: fetched.idOrVisaNo?.trim() ?? "",
      nationality: fetched.nationality?.trim() ?? "",
      mobileNumber: fetched.mobileNumber,
      dateOfBirth: fetched.dateOfBirth,
      idCardFileName: fetched.idCardFileName,
      idCardDataUrl: fetched.idCardDataUrl,
      photoDataUrl: fetched.photoDataUrl,
      extraPhotoDataUrl: fetched.extraPhotoDataUrl,
      signature: fetched.signature,
      signedAt: fetched.signature ? new Date() : undefined,
      autoFetched: !!fetched.autoFetched,
      editToken: newId(),
      course,
    };
    job.attendees.push(attendee);
    return attendee;
  }

  joinViaTraineeLink(
    token: string,
    fetched: Parameters<TrainingService["addAttendeeFromId"]>[1]
  ): Attendee {
    const job = this.getJobByInviteToken(token);
    return this.joinAsTrainee(job.id, fetched);
  }

  joinViaPublicSheet(
    jobId: string,
    fetched: Parameters<TrainingService["addAttendeeFromId"]>[1]
  ): Attendee {
    return this.joinAsTrainee(jobId, fetched);
  }

  private joinAsTrainee(
    jobId: string,
    fetched: Parameters<TrainingService["addAttendeeFromId"]>[1]
  ): Attendee {
    const job = this.getJob(jobId);
    if (!fetched.signature) {
      throw new ValidationError("signature is required", "signature");
    }
    const courses = jobCourseList(job.course);
    const fromList = (fetched.courses ?? []).map((name) => String(name ?? "").trim()).filter(Boolean);
    const chosen = fromList.length
      ? fromList
      : [String(fetched.course || "").trim() || (courses.length === 1 ? courses[0] : "")].filter(Boolean);
    if (!chosen.length) {
      throw new ValidationError("select the training course for the certificate", "course");
    }
    for (const c of chosen) {
      if (courses.length && !courses.includes(c)) {
        throw new ValidationError("course must match this job", "course");
      }
    }
    return this.addAttendeeFromId(job.id, { ...fetched, courses: chosen, course: chosen[0] });
  }

  signPublicAttendee(jobId: string, attendeeId: string, signature: string): Attendee {
    const job = this.getJob(jobId);
    if (job.status === "Approved" || job.status === "Issued" || job.status === "Cancelled") {
      throw new ConflictError("this training is closed", "status");
    }
    return this.updateAttendee(jobId, attendeeId, { signature: String(signature ?? "").trim() });
  }

  updateAttendeeByEditToken(
    inviteToken: string,
    editToken: string,
    patch: Parameters<TrainingService["updateAttendee"]>[2]
  ): Attendee {
    const job = this.getJobByInviteToken(inviteToken);
    const attendee = job.attendees.find((a) => a.editToken === editToken);
    if (!attendee) throw new NotFoundError("trainee record not found");
    return this.updateAttendee(job.id, attendee.id, patch);
  }

  saveAttendanceMeta(
    jobId: string,
    input: {
      expectedTraineeCount?: number;
      trainerSignature?: string;
      trainerVerified?: boolean;
      authorizedBy?: string;
      sheetInsigniaName?: string;
      sheetInsigniaLogoDataUrl?: string;
      sheetJobLabel?: string;
      sheetJobNo?: string;
      sheetCourseCode?: string;
      sheetCourseTitle?: string;
      sheetCompany?: string;
      certificateUnder?: string;
      certifiedBy?: string;
      trainingDate?: string;
      trainingDateTo?: string;
      trainingTime?: string;
    }
  ): TrainingJob {
    const job = this.getJob(jobId);
    if (job.status === "Cancelled") {
      throw new ConflictError("a cancelled job cannot be edited", "status");
    }
    const issued = job.status === "Approved" || job.status === "Issued";
    if (input.expectedTraineeCount !== undefined) {
      const n = Number(input.expectedTraineeCount);
      if (!Number.isInteger(n) || n < 1 || n > 200) {
        throw new ValidationError("trainee number must be between 1 and 200", "expectedTraineeCount");
      }
      job.expectedTraineeCount = n;
    }
    if (input.trainerSignature !== undefined) {
      job.trainerSignature = input.trainerSignature || undefined;
      job.trainerSignedAt = input.trainerSignature ? new Date() : undefined;
    }
    if (input.trainerVerified !== undefined) {
      job.trainerVerified = !!input.trainerVerified;
    }
    if (input.authorizedBy !== undefined) {
      job.authorizedBy = input.authorizedBy.trim() || undefined;
    }
    const textFields = [
      "sheetInsigniaName",
      "sheetJobLabel",
      "sheetJobNo",
      "sheetCourseCode",
      "sheetCourseTitle",
      "sheetCompany",
      "certificateUnder",
    ] as const;
    for (const key of textFields) {
      if (input[key] !== undefined) job[key] = String(input[key] ?? "").trim() || undefined;
    }
    if (input.certifiedBy !== undefined) {
      const certifiedBy = String(input.certifiedBy ?? "").trim();
      if (!certifiedBy) {
        throw new ValidationError("certified to is required on the attendance sheet", "certifiedBy");
      }
      job.certificateUnder = certifiedBy;
    }
    if (input.sheetInsigniaLogoDataUrl !== undefined) {
      const logo = String(input.sheetInsigniaLogoDataUrl ?? "").trim();
      if (logo && !logo.startsWith("data:image/")) {
        throw new ValidationError("insignia must be an image", "sheetInsigniaLogoDataUrl");
      }
      job.sheetInsigniaLogoDataUrl = logo || undefined;
    }
    if (input.trainingDate !== undefined || input.trainingDateTo !== undefined) {
      const range = resolveDateRange(
        input.trainingDate ?? job.trainingDate,
        input.trainingDateTo ?? job.trainingDateTo
      );
      job.trainingDate = range.trainingDate;
      job.trainingDateTo = range.trainingDateTo;
    }
    if (input.trainingTime !== undefined) {
      job.trainingTime = String(input.trainingTime ?? "").trim() || undefined;
    }
    job.updatedAt = new Date();
    if (issued) {
      this.refreshIssuedCertificates(job, {
        dates: input.trainingDate !== undefined || input.trainingDateTo !== undefined,
        company: input.certifiedBy !== undefined || input.certificateUnder !== undefined,
      });
    }
    // Temporarily commented out due to TypeScript inference issue
    // TODO: Fix the type issue - this should reset status to "In Progress" when editing submitted/rejected jobs
    // if (job.status !== "Approved" && (job.status === "Submitted" || job.status === "Rejected")) {
    //   job.status = "In Progress";
    // }
    return job;
  }

  updateAttendee(
    jobId: string,
    attendeeId: string,
    patch: Partial<{
      name: string;
      company: string;
      idOrVisaNo: string;
      nationality: string;
      mobileNumber: string;
      dateOfBirth: string;
      idCardDataUrl: string;
      photoDataUrl: string;
      extraPhotoDataUrl: string;
      signature: string;
      autoFetched: boolean;
      course: string;
    }>
  ): Attendee {
    const job = this.getJob(jobId);
    if (job.status === "Cancelled") {
      throw new ConflictError("a cancelled job cannot be edited", "status");
    }
    const attendee = job.attendees.find((a) => a.id === attendeeId);
    if (!attendee) throw new NotFoundError("attendee not found");
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new ValidationError("name is required", "name");
      attendee.name = patch.name.trim();
    }
    if (patch.company !== undefined) attendee.company = patch.company.trim();
    if (patch.idOrVisaNo !== undefined) attendee.idOrVisaNo = patch.idOrVisaNo.trim();
    if (patch.nationality !== undefined) attendee.nationality = patch.nationality.trim();
    if (patch.mobileNumber !== undefined) {
      // Mobile number is now optional - validation removed
      const mob = String(patch.mobileNumber).replace(/[\s-+]/g, "");
      attendee.mobileNumber = mob;
    }
    if (patch.dateOfBirth !== undefined) {
      if (patch.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(patch.dateOfBirth)) {
        throw new ValidationError("date of birth must be yyyy-mm-dd", "dateOfBirth");
      }
      attendee.dateOfBirth = patch.dateOfBirth || undefined;
    }
    if (patch.idCardDataUrl !== undefined) attendee.idCardDataUrl = patch.idCardDataUrl;
    if (patch.photoDataUrl !== undefined) attendee.photoDataUrl = patch.photoDataUrl;
    if (patch.extraPhotoDataUrl !== undefined) attendee.extraPhotoDataUrl = patch.extraPhotoDataUrl;
    if (patch.signature !== undefined) {
      attendee.signature = patch.signature || undefined;
      attendee.signedAt = patch.signature ? new Date() : undefined;
    }
    if (patch.autoFetched !== undefined) attendee.autoFetched = patch.autoFetched;
    if (patch.course !== undefined) attendee.course = attendeeCertificateCourse(job, patch.course);
    job.updatedAt = new Date();
    if (job.status === "Approved" || job.status === "Issued") {
      this.refreshIssuedCertificates(job, { attendeeId: attendee.id });
    } else if (job.status === "Submitted" || job.status === "Rejected") {
      job.status = "In Progress";
    }
    return attendee;
  }

  /** Trainer submits the completed job for admin approval. */
  submitForApproval(jobId: string): TrainingJob {
    const job = this.getJob(jobId);
    if (job.status === "Cancelled") {
      throw new ConflictError("a cancelled job cannot be submitted", "status");
    }
    if (job.status === "Approved" || job.status === "Issued") {
      throw new ConflictError("this job is already approved/issued", "status");
    }
    if (job.serviceType === "Training") {
      if (!job.trainerVerified) {
        throw new ValidationError("trainer must verify the attendance sheet", "trainerVerified");
      }
      if (!job.authorizedBy) {
        throw new ValidationError("trainer must complete Authorized by", "authorizedBy");
      }
      if (!String(job.certificateUnder ?? "").trim()) {
        throw new ValidationError("certified to is required on the attendance sheet", "certifiedBy");
      }
      if (!job.trainingDate) {
        throw new ValidationError("training date is required on the attendance sheet", "trainingDate");
      }
      if (job.attendees.length < 1) {
        throw new ValidationError("at least one attendee is required", "attendees");
      }
      if (job.attendees.some((a) => !(a.course || job.course))) {
        throw new ValidationError("each trainee needs a training course for the certificate", "course");
      }
      if (job.expectedTraineeCount && job.attendees.length < job.expectedTraineeCount) {
        throw new ValidationError(
          `mark all ${job.expectedTraineeCount} trainees before sending to admin`,
          "attendees"
        );
      }
    } else if (job.attendees.length >= 1) {
      // trainer attendance path on mixed jobs
    } else {
      const recorded = new Set(job.itemResults.map((r) => r.sn));
      if (!job.lineItems.every((li) => recorded.has(li.sn))) {
        throw new ValidationError("record a result for every line item", "itemResults");
      }
    }
    job.status = "Submitted";
    job.updatedAt = new Date();
    return job;
  }

  /** Admin approves -> generate a certificate (QR + barcode) per trainee or item. */
  async approve(jobId: string, approverId: string, design?: string): Promise<TrainingJob> {
    const job = this.getJob(jobId);
    if (job.status !== "Submitted") {
      throw new ConflictError("job must be submitted before approval", "status");
    }
    if (design) job.certificateDesign = design;
    if (!job.certificateDesign) job.certificateDesign = "achievement";
    const expiresOn = addOneYear(job.trainingDate);
    if (job.attendees.length >= 1) {
      for (const attendee of job.attendees) {
        await this.pushCertificate(job, {
          attendeeId: attendee.id,
          idOrVisaNo: attendee.idOrVisaNo,
          name: attendee.name,
          company: (job.certificateUnder || attendee.company || job.customerName).trim(),
          course: attendeeCertificateCourse(job, attendee.course),
          trainingDate: job.trainingDate,
          expiresOn,
        });
      }
    } else {
      for (const item of job.lineItems) {
        const rec = job.itemResults.find((r) => r.sn === item.sn);
        await this.pushCertificate(job, {
          attendeeId: `item-${item.sn}`,
          name: item.description,
          company: (job.certificateUnder || job.customerName).trim(),
          course: `${job.course} — ${rec?.result ?? "Pass"}`,
          trainingDate: job.trainingDate,
          expiresOn,
        });
      }
    }
    // Auto-change status to "Issued" after certificates are created
    job.status = "Issued";
    job.approvedBy = approverId;
    job.issuedAt = new Date();
    job.updatedAt = new Date();
    return job;
  }

  /** Trainees added after issue get their certificate straight away. */
  async issueMissingCertificates(jobId: string): Promise<TrainingJob> {
    const job = this.getJob(jobId);
    if (job.status !== "Approved" && job.status !== "Issued") return job;
    const expiresOn = addOneYear(job.trainingDate);
    for (const attendee of job.attendees) {
      if (job.certificates.some((c) => c.attendeeId === attendee.id)) continue;
      await this.pushCertificate(job, {
        attendeeId: attendee.id,
        idOrVisaNo: attendee.idOrVisaNo,
        name: attendee.name,
        company: (job.certificateUnder || attendee.company || job.customerName).trim(),
        course: attendeeCertificateCourse(job, attendee.course),
        trainingDate: job.trainingDate,
        expiresOn,
      });
    }
    job.updatedAt = new Date();
    return job;
  }

  /** Admin corrects an already-issued certificate. The next PDF download uses these fields. */
  editCertificate(
    jobId: string,
    certificateId: string,
    patch: Partial<Pick<TrainingCertificate, "name" | "company" | "course" | "trainingDate" | "expiresOn" | "idOrVisaNo">>
  ): TrainingCertificate {
    const job = this.getJob(jobId);
    const cert = job.certificates.find((c) => c.id === certificateId);
    if (!cert) throw new NotFoundError("certificate not found");
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new ValidationError("name is required", "name");
      cert.name = patch.name.trim();
    }
    if (patch.company !== undefined) cert.company = patch.company.trim();
    if (patch.course !== undefined) cert.course = patch.course.trim();
    if (patch.idOrVisaNo !== undefined) cert.idOrVisaNo = patch.idOrVisaNo.trim();
    if (patch.trainingDate !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.trainingDate)) {
        throw new ValidationError("training date must be yyyy-mm-dd", "trainingDate");
      }
      cert.trainingDate = patch.trainingDate;
      cert.expiresOn = patch.expiresOn || addOneYear(patch.trainingDate);
    } else if (patch.expiresOn !== undefined) {
      if (patch.expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(patch.expiresOn)) {
        throw new ValidationError("expiry must be yyyy-mm-dd", "expiresOn");
      }
      cert.expiresOn = patch.expiresOn;
    }
    const attendee = job.attendees.find((a) => a.id === cert.attendeeId);
    if (attendee) {
      if (patch.name !== undefined) attendee.name = cert.name;
      if (patch.idOrVisaNo !== undefined) attendee.idOrVisaNo = cert.idOrVisaNo || "";
      if (patch.course !== undefined) attendee.course = cert.course;
    }
    job.updatedAt = new Date();
    return cert;
  }

  private refreshIssuedCertificates(
    job: TrainingJob,
    opts: { dates?: boolean; company?: boolean; attendeeId?: string } = {}
  ): void {
    for (const cert of job.certificates) {
      if (opts.attendeeId && cert.attendeeId !== opts.attendeeId) continue;
      const attendee = job.attendees.find((a) => a.id === cert.attendeeId);
      if (attendee) {
        cert.name = attendee.name;
        cert.idOrVisaNo = attendee.idOrVisaNo;
        if (attendee.course) cert.course = attendeeCertificateCourse(job, attendee.course);
      }
      if (opts.dates && job.trainingDate) {
        cert.trainingDate = job.trainingDate;
        cert.expiresOn = addOneYear(job.trainingDate);
      }
      if (opts.company && job.certificateUnder) {
        cert.company = job.certificateUnder;
      }
    }
  }

  private async pushCertificate(
    job: TrainingJob,
    fields: Pick<TrainingCertificate, "attendeeId" | "name" | "company" | "course" | "trainingDate" | "expiresOn"> &
      Partial<Pick<TrainingCertificate, "idOrVisaNo">>
  ): Promise<void> {
    this.certSeq += 1;
    const certificateNo = `${job.jobNo}-${String(this.certSeq).padStart(2, "0")}`;
    this.codes.validateBarcodeEncodable(certificateNo);
    const verificationRef = newVerificationRef();
    const qr = await this.codes.renderVerificationQr(verificationRef);
    const barcode = await this.codes.renderDocumentBarcode(certificateNo);
    job.certificates.push({
      id: newId(),
      certificateNo,
      jobNo: job.jobNo,
      ...fields,
      verificationRef,
      qrDataUrl: qr.dataUrl,
      barcodeDataUrl: barcode.dataUrl,
      generatedAt: new Date(),
    });
  }

  reject(jobId: string, reason: string): TrainingJob {
    const job = this.getJob(jobId);
    if (job.status === "Cancelled") {
      throw new ConflictError("a cancelled job cannot be returned", "status");
    }
    job.status = "Rejected";
    job.rejectedReason = reason;
    job.updatedAt = new Date();
    if (job.assignedToId) {
      this.notify(job.assignedToId, `Certificate request for ${job.jobNo} was returned: ${reason || "review required"}`, job.id);
    }
    return job;
  }

  /** Office Admin adds invoice number and closes job directly */
  addInvoiceAndClose(jobId: string, invoiceNumber: string, closedBy: string): TrainingJob {
    const job = this.getJob(jobId);
    if (job.status !== "Issued" && job.status !== "Approved") {
      throw new ConflictError("only issued jobs can be invoiced and closed", "status");
    }
    if (!invoiceNumber.trim()) {
      throw new ValidationError("Invoice number is required");
    }
    job.invoiceNumber = invoiceNumber.trim();
    job.invoicedAt = new Date();
    job.invoicedBy = closedBy;
    job.closedBy = closedBy;
    job.closedAt = new Date();
    job.status = "Closed";
    job.updatedAt = new Date();
    return job;
  }

  /** Get invoicing statistics for reports */
  getInvoiceStats() {
    const jobs = this.listJobs();
    const issued = jobs.filter(j => j.status === "Issued");
    const closed = jobs.filter(j => j.status === "Closed" && j.invoiceNumber);
    
    return {
      totalJobs: jobs.length,
      issued: issued.length,
      closed: closed.length,
      pendingInvoice: issued.length,
      jobs: [...issued.map(j => ({
        id: j.id,
        jobNo: j.jobNo,
        customerName: j.customerName,
        course: j.course,
        status: j.status,
        approvedBy: j.approvedBy,
        issuedAt: j.issuedAt?.toISOString()
      })), ...closed.map(j => ({
        id: j.id,
        jobNo: j.jobNo,
        customerName: j.customerName,
        course: j.course,
        status: j.status,
        invoiceNumber: j.invoiceNumber,
        closedAt: j.closedAt?.toISOString(),
        closedBy: j.closedBy
      }))].slice(0, 20) // Recent 20 jobs
    };
  }

  cancelJob(jobId: string, reason: string, cancelledBy: string): TrainingJob {
    const job = this.getJob(jobId);
    if (job.status === "Cancelled") {
      throw new ConflictError("this job is already cancelled", "status");
    }
    if (!CANCELLABLE.includes(job.status)) {
      throw new ConflictError("only new or assigned jobs can be cancelled", "status");
    }
    const why = String(reason ?? "").trim();
    if (!why) throw new ValidationError("enter the reason for cancelling this job", "reason");
    job.status = "Cancelled";
    job.cancelledReason = why;
    job.cancelledBy = cancelledBy;
    job.cancelledAt = new Date();
    job.cancelRequest = undefined;
    job.updatedAt = new Date();
    this.notify(job.createdById, `Job ${job.jobNo} was cancelled by ${cancelledBy}: ${why}`, job.id);
    if (job.assignedToId) {
      this.notify(job.assignedToId, `Job ${job.jobNo} was cancelled: ${why}`, job.id);
    }
    return job;
  }

  requestCancel(jobId: string, reason: string, requestedBy: string, requestedById: string): TrainingJob {
    const job = this.getJob(jobId);
    if (job.status === "Cancelled") {
      throw new ConflictError("this job is already cancelled", "status");
    }
    if (!CANCELLABLE.includes(job.status)) {
      throw new ConflictError("only new or assigned jobs can be cancelled", "status");
    }
    if (job.cancelRequest) {
      throw new ConflictError("a cancel request is already waiting for the Super Admin", "status");
    }
    const why = String(reason ?? "").trim();
    if (!why) throw new ValidationError("enter the reason for cancelling this job", "reason");
    job.cancelRequest = { reason: why, requestedBy, requestedById, requestedAt: new Date() };
    job.updatedAt = new Date();
    return job;
  }

  rejectCancelRequest(jobId: string, rejectedBy: string): TrainingJob {
    const job = this.getJob(jobId);
    const request = job.cancelRequest;
    if (!request) throw new ConflictError("there is no cancel request on this job", "status");
    job.cancelRequest = undefined;
    job.updatedAt = new Date();
    this.notify(request.requestedById, `Cancel request for ${job.jobNo} was rejected by ${rejectedBy}`, job.id);
    return job;
  }
}

function addOneYear(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const next = new Date(d);
  next.setFullYear(d.getFullYear() + 1);
  next.setDate(next.getDate() - 1);
  return next.toISOString().slice(0, 10);
}
