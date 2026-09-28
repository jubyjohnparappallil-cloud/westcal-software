import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { FieldService, GpsCapture } from "./field.js";
import { JobsService, CreateJobInput } from "../jobs/jobs.js";
import { AppError } from "../../shared/errors.js";

function setup(itemCount = 2, tokens: (string | undefined)[] = []) {
  const jobs = new JobsService(() => true);
  const input: CreateJobInput = {
    type: "Calibration",
    customerName: "Acme",
    siteLocation: "Site",
    createdById: "creator",
    items: Array.from({ length: itemCount }, (_, i) => ({
      assetName: `a${i}`,
      qrToken: tokens[i],
      requiredMeasurements: ["m1"],
    })),
  };
  const job = jobs.createJob(input);
  const field = new FieldService(jobs);
  return { jobs, field, job };
}

describe("FieldService", () => {
  // Feature: calibration-services-platform, Property 13: GPS captures are
  // persisted and round-trip with the correct event type.
  it("Property 13: GPS capture round-trips with event type", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<"Start" | "Completion">("Start", "Completion"),
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: 0, max: 500, noNaN: true }),
        (eventType, lat, lon, acc) => {
          const { field, job } = setup();
          const capture: GpsCapture = {
            clientCaptureId: "c-" + Math.random(),
            eventType,
            latitude: lat,
            longitude: lon,
            accuracyMeters: acc,
            capturedAt: new Date().toISOString(),
          };
          const saved = field.persistGps(job.id, capture);
          expect(saved.jobId).toBe(job.id);
          expect(saved.eventType).toBe(eventType);
          expect(saved.latitude).toBe(lat);
          expect(saved.longitude).toBe(lon);
          expect(saved.accuracyMeters).toBe(acc);
        }
      ),
      { numRuns: 200 }
    );
  });

  // Feature: calibration-services-platform, Property 14: Low-accuracy flagging is
  // exact.
  it("Property 14: lowAccuracy iff accuracy > 50m", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 200, noNaN: true }), (acc) => {
        const { field, job } = setup();
        const saved = field.persistGps(job.id, {
          clientCaptureId: "c-" + Math.random(),
          eventType: "Start",
          latitude: 0,
          longitude: 0,
          accuracyMeters: acc,
          capturedAt: new Date().toISOString(),
        });
        expect(saved.accuracyMeters).toBe(acc);
        expect(saved.lowAccuracy).toBe(acc > 50);
      }),
      { numRuns: 200 }
    );
  });

  // Feature: calibration-services-platform, Property 15: Offline sync persists
  // each capture exactly once.
  it("Property 15: sync persists each capture exactly once under duplicates", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 8 }), { minLength: 1, maxLength: 10 }),
        (ids) => {
          const { field, job } = setup();
          const uniqueIds = [...new Set(ids)];
          const batch: GpsCapture[] = uniqueIds.map((id) => ({
            clientCaptureId: id,
            eventType: "Start",
            latitude: 1,
            longitude: 1,
            accuracyMeters: 10,
            capturedAt: new Date().toISOString(),
          }));
          // deliver batch multiple times (duplicates / retries)
          field.syncQueue(job.id, batch);
          field.syncQueue(job.id, batch);
          field.syncQueue(job.id, [...batch, ...batch]);
          expect(field.getGps(job.id).length).toBe(uniqueIds.length);
        }
      ),
      { numRuns: 200 }
    );
  });

  // Feature: calibration-services-platform, Property 16: QR scans route to the
  // item on match and to the job otherwise.
  it("Property 16: scan references item iff token matches, always references job", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), (scanValue) => {
        const token = "ITEM-TOKEN-1";
        const { field, job } = setup(2, [token, undefined]);
        const res = field.recordScan(job.id, scanValue, new Date().toISOString());
        const events = field.getScans(job.id);
        const last = events[events.length - 1];
        expect(last.jobId).toBe(job.id); // always references the job
        if (scanValue === token) {
          expect(res.matched).toBe(true);
          expect(last.jobItemId).toBeTruthy();
        } else {
          expect(res.matched).toBe(false);
          expect(last.jobItemId).toBeUndefined();
        }
        expect(last.scannedAt).toBeTruthy();
      }),
      { numRuns: 200 }
    );
  });

  // Feature: calibration-services-platform, Property 17: Calibration records
  // require all measurements and round-trip.
  it("Property 17: record needs all required measurements and round-trips", () => {
    fc.assert(
      fc.property(fc.boolean(), (provideMeasurement) => {
        const { field, job } = setup(1);
        const itemId = field["jobs"].getItems(job.id)[0].id;
        const measurements: Record<string, number | string> = provideMeasurement
          ? { m1: 42 }
          : {};
        if (provideMeasurement) {
          const rec = field.submitCalibrationRecord(job.id, itemId, measurements, "Pass", "eng");
          expect(field.getRecord(itemId)?.measurements).toEqual({ m1: 42 });
          expect(rec.result).toBe("Pass");
        } else {
          expect(() =>
            field.submitCalibrationRecord(job.id, itemId, measurements, "Pass", "eng")
          ).toThrowError(AppError);
        }
      }),
      { numRuns: 200 }
    );
  });

  // Feature: calibration-services-platform, Property 18: A job completes exactly
  // when all its items are recorded.
  it("Property 18: job Completed iff every item has a record", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (n) => {
        const { jobs, field, job } = setup(n);
        const items = jobs.getItems(job.id);
        for (let i = 0; i < items.length; i++) {
          const completedBefore = jobs.getJob(job.id).status === "Completed";
          expect(completedBefore).toBe(false);
          field.submitCalibrationRecord(job.id, items[i].id, { m1: 1 }, "Pass", "eng");
        }
        expect(jobs.getJob(job.id).status).toBe("Completed");
      }),
      { numRuns: 100 }
    );
  });
});
