import { newId } from "../../shared/id.js";
import { JobsService } from "../jobs/jobs.js";
import { ValidationError } from "../../shared/errors.js";

const ACCURACY_THRESHOLD_M = 50; // AC 7.3

export type GpsEventType = "Start" | "Completion";

export interface GpsCapture {
  clientCaptureId: string;
  eventType: GpsEventType;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string; // ISO
}

export interface GpsLocation extends GpsCapture {
  id: string;
  jobId: string;
  lowAccuracy: boolean;
}

export interface ScanResult {
  matched: boolean;
  jobItemId?: string;
}

export interface QrScanEvent {
  id: string;
  jobId: string;
  jobItemId?: string;
  qrValue: string;
  matched: boolean;
  scannedAt: string;
}

export interface CalibrationRecord {
  id: string;
  jobItemId: string;
  measurements: Record<string, number | string>;
  result: "Pass" | "Fail";
  capturedById: string;
  capturedAt: Date;
}

/**
 * Field module (Requirements 6.3, 7, 8, 9). GPS persistence with accuracy
 * flagging and idempotent offline sync, QR scan recording, calibration records.
 */
export class FieldService {
  private readonly gps = new Map<string, GpsLocation[]>();
  /** idempotency: clientCaptureId -> GpsLocation.id */
  private readonly seenCaptures = new Map<string, string>();
  private readonly scans = new Map<string, QrScanEvent[]>();
  private readonly records = new Map<string, CalibrationRecord>(); // jobItemId -> record

  constructor(private readonly jobs: JobsService) {}

  /**
   * AC 7.1, 7.2, 7.3, 7.5, 7.6: persist a GPS capture idempotently keyed by
   * clientCaptureId, flag low accuracy iff accuracy > 50 m.
   */
  persistGps(jobId: string, capture: GpsCapture): GpsLocation {
    this.jobs.getJob(jobId); // validates existence
    const existingId = this.seenCaptures.get(capture.clientCaptureId);
    if (existingId) {
      // idempotent replay -> return the already-persisted record (AC 7.6)
      return this.gps.get(jobId)!.find((g) => g.id === existingId)!;
    }
    const record: GpsLocation = {
      ...capture,
      id: newId(),
      jobId,
      lowAccuracy: capture.accuracyMeters > ACCURACY_THRESHOLD_M,
    };
    if (!this.gps.has(jobId)) this.gps.set(jobId, []);
    this.gps.get(jobId)!.push(record);
    this.seenCaptures.set(capture.clientCaptureId, record.id);
    return record;
  }

  getGps(jobId: string): GpsLocation[] {
    return [...(this.gps.get(jobId) ?? [])];
  }

  /** AC 7.6: idempotent batch intake. */
  syncQueue(jobId: string, batch: GpsCapture[]): GpsLocation[] {
    return batch.map((c) => this.persistGps(jobId, c));
  }

  /**
   * AC 8.2, 8.3, 8.4: record a scan; references the job item iff the scanned
   * value matches an item's token, otherwise references the job.
   */
  recordScan(jobId: string, qrValue: string, scannedAt: string): ScanResult {
    const items = this.jobs.getItems(jobId);
    const match = items.find((it) => it.qrToken !== undefined && it.qrToken === qrValue);
    const event: QrScanEvent = {
      id: newId(),
      jobId,
      jobItemId: match?.id,
      qrValue,
      matched: !!match,
      scannedAt,
    };
    if (!this.scans.has(jobId)) this.scans.set(jobId, []);
    this.scans.get(jobId)!.push(event);
    return { matched: !!match, jobItemId: match?.id };
  }

  getScans(jobId: string): QrScanEvent[] {
    return [...(this.scans.get(jobId) ?? [])];
  }

  /**
   * AC 9.2, 9.3, 9.4: persist a record with all required measurements; when all
   * items in the job are recorded, set the job Completed.
   */
  submitCalibrationRecord(
    jobId: string,
    jobItemId: string,
    measurements: Record<string, number | string>,
    result: "Pass" | "Fail",
    capturedById: string
  ): CalibrationRecord {
    const items = this.jobs.getItems(jobId);
    const item = items.find((it) => it.id === jobItemId);
    if (!item) throw new ValidationError("job item not found in job", "jobItemId");

    for (const required of item.requiredMeasurements) {
      if (measurements[required] === undefined || measurements[required] === "") {
        throw new ValidationError(
          `missing required measurement: ${required}`,
          required
        );
      }
    }

    const record: CalibrationRecord = {
      id: newId(),
      jobItemId,
      measurements,
      result,
      capturedById,
      capturedAt: new Date(),
    };
    this.records.set(jobItemId, record);

    // AC 9.4: complete when every item has a record.
    const allRecorded = items.every((it) => this.records.has(it.id));
    if (allRecorded) this.jobs.completeJob(jobId, capturedById);

    return record;
  }

  getRecord(jobItemId: string): CalibrationRecord | undefined {
    return this.records.get(jobItemId);
  }
}
