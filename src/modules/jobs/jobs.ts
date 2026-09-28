import { newId } from "../../shared/id.js";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors.js";

export type JobType = "Calibration" | "Inspection" | "Training";
export type JobStatus = "Created" | "Assigned" | "In Progress" | "Completed";

export interface JobItem {
  id: string;
  jobId: string;
  assetName: string;
  assetDetails?: Record<string, unknown>;
  qrToken?: string;
  requiredMeasurements: string[];
}

export interface Job {
  id: string;
  type: JobType;
  customerName: string;
  customerDetails?: Record<string, unknown>;
  siteLocation: string;
  status: JobStatus;
  assignedEngineerId?: string;
  scheduledDate?: string;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobStatusHistoryEntry {
  id: string;
  jobId: string;
  fromStatus: JobStatus | null;
  toStatus: JobStatus;
  changedById: string;
  changedAt: Date;
}

export interface CreateJobInput {
  type: JobType;
  customerName: string;
  customerDetails?: Record<string, unknown>;
  siteLocation: string;
  createdById: string;
  items: Array<{
    assetName: string;
    assetDetails?: Record<string, unknown>;
    qrToken?: string;
    requiredMeasurements?: string[];
  }>;
}

const VALID_STATUSES: JobStatus[] = ["Created", "Assigned", "In Progress", "Completed"];

/**
 * Jobs module (Requirements 4, 5, 6, 12). Job CRUD, item management,
 * assignment/scheduling, status transitions, and status history.
 */
export class JobsService {
  private readonly jobs = new Map<string, Job>();
  private readonly items = new Map<string, JobItem[]>();
  private readonly history = new Map<string, JobStatusHistoryEntry[]>();

  constructor(
    /** Returns true iff the user holds the Site_Engineer role (AC 5.4). */
    private readonly isSiteEngineer: (userId: string) => boolean
  ) {}

  private recordStatus(
    job: Job,
    from: JobStatus | null,
    to: JobStatus,
    changedById: string
  ): void {
    if (!this.history.has(job.id)) this.history.set(job.id, []);
    this.history.get(job.id)!.push({
      id: newId(),
      jobId: job.id,
      fromStatus: from,
      toStatus: to,
      changedById,
      changedAt: new Date(),
    });
  }

  /** AC 4.1, 4.2, 4.3. */
  createJob(input: CreateJobInput): Job {
    if (!input.customerName || input.customerName.trim().length < 1) {
      throw new ValidationError("customerName is required", "customerName");
    }
    // Calibration/Inspection jobs require at least one item (AC 4.3).
    if (input.type !== "Training" && (!input.items || input.items.length < 1)) {
      throw new ValidationError("at least one job item is required", "items");
    }
    const now = new Date();
    const job: Job = {
      id: newId(),
      type: input.type,
      customerName: input.customerName.trim(),
      customerDetails: input.customerDetails,
      siteLocation: input.siteLocation,
      status: "Created",
      createdById: input.createdById,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    this.items.set(
      job.id,
      (input.items ?? []).map((it) => ({
        id: newId(),
        jobId: job.id,
        assetName: it.assetName,
        assetDetails: it.assetDetails,
        qrToken: it.qrToken,
        requiredMeasurements: it.requiredMeasurements ?? [],
      }))
    );
    this.recordStatus(job, null, "Created", input.createdById);
    return job;
  }

  getJob(id: string): Job {
    const j = this.jobs.get(id);
    if (!j) throw new NotFoundError("job not found");
    return j;
  }

  /** AC 6.2, 9.x support: exactly this job's items. */
  getItems(jobId: string): JobItem[] {
    this.getJob(jobId);
    return [...(this.items.get(jobId) ?? [])];
  }

  listJobs(): Job[] {
    return [...this.jobs.values()];
  }

  /** AC 4.4: editable only when not Completed. */
  updateJob(id: string, patch: Partial<Pick<Job, "customerName" | "siteLocation" | "customerDetails">>): Job {
    const job = this.getJob(id);
    if (job.status === "Completed") {
      throw new ConflictError("completed jobs cannot be edited", "status");
    }
    if (patch.customerName !== undefined) job.customerName = patch.customerName;
    if (patch.siteLocation !== undefined) job.siteLocation = patch.siteLocation;
    if (patch.customerDetails !== undefined) job.customerDetails = patch.customerDetails;
    job.updatedAt = new Date();
    return job;
  }

  /** AC 5.1, 5.2, 5.4. */
  assignJob(id: string, engineerId: string, scheduledDate: string, actorId: string): Job {
    const job = this.getJob(id);
    if (!this.isSiteEngineer(engineerId)) {
      throw new ValidationError("assignee must be a Site Engineer", "engineerId");
    }
    const from = job.status;
    job.assignedEngineerId = engineerId;
    job.scheduledDate = scheduledDate;
    job.status = "Assigned";
    job.updatedAt = new Date();
    this.recordStatus(job, from, "Assigned", actorId);
    return job;
  }

  /** AC 5.5: reassignment moves visibility between engineer job lists. */
  reassignJob(id: string, newEngineerId: string, actorId: string): Job {
    const job = this.getJob(id);
    if (!this.isSiteEngineer(newEngineerId)) {
      throw new ValidationError("assignee must be a Site Engineer", "engineerId");
    }
    const from = job.status;
    job.assignedEngineerId = newEngineerId;
    job.status = "Assigned";
    job.updatedAt = new Date();
    this.recordStatus(job, from, "Assigned", actorId);
    return job;
  }

  /** AC 6.1: assigned-to-me list. */
  getAssignedJobs(engineerId: string): Job[] {
    return [...this.jobs.values()].filter((j) => j.assignedEngineerId === engineerId);
  }

  /** AC 6.3: start work -> In Progress. */
  startJob(id: string, actorId: string): Job {
    const job = this.getJob(id);
    const from = job.status;
    job.status = "In Progress";
    job.updatedAt = new Date();
    this.recordStatus(job, from, "In Progress", actorId);
    return job;
  }

  /** AC 9.4: complete when all items recorded (caller supplies recorded set). */
  completeJob(id: string, actorId: string): Job {
    const job = this.getJob(id);
    const from = job.status;
    job.status = "Completed";
    job.updatedAt = new Date();
    this.recordStatus(job, from, "Completed", actorId);
    return job;
  }

  /** AC 12.3. */
  getStatusHistory(jobId: string): JobStatusHistoryEntry[] {
    this.getJob(jobId);
    return [...(this.history.get(jobId) ?? [])];
  }

  static isValidStatus(s: string): s is JobStatus {
    return (VALID_STATUSES as string[]).includes(s);
  }
}
