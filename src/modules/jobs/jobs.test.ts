import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { JobsService, CreateJobInput, JobStatus } from "./jobs.js";
import { AppError } from "../../shared/errors.js";

function svc(engineers: string[] = ["eng1"]) {
  return new JobsService((id) => engineers.includes(id));
}

function validInput(itemCount: number): CreateJobInput {
  return {
    type: "Calibration",
    customerName: "Acme",
    siteLocation: "Site A",
    createdById: "creator",
    items: Array.from({ length: itemCount }, (_, i) => ({
      assetName: `asset-${i}`,
      requiredMeasurements: ["m1"],
    })),
  };
}

describe("JobsService", () => {
  // Feature: calibration-services-platform, Property 8: Job creation requires an
  // item and starts in Created.
  it("Property 8: createJob needs >=1 item and starts Created", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 }), (itemCount) => {
        const s = svc();
        if (itemCount === 0) {
          expect(() => s.createJob(validInput(0))).toThrowError(AppError);
          expect(s.listJobs().length).toBe(0);
        } else {
          const job = s.createJob(validInput(itemCount));
          expect(job.status).toBe("Created");
          expect(s.getItems(job.id).length).toBe(itemCount);
        }
      }),
      { numRuns: 200 }
    );
  });

  // Feature: calibration-services-platform, Property 9: Jobs are editable only
  // before completion.
  it("Property 9: update succeeds iff status is not Completed", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<JobStatus>("Created", "Assigned", "In Progress", "Completed"),
        (status) => {
          const s = svc();
          const job = s.createJob(validInput(1));
          // drive to target status
          if (status === "Assigned") s.assignJob(job.id, "eng1", "2026-12-01", "a");
          if (status === "In Progress") {
            s.assignJob(job.id, "eng1", "2026-12-01", "a");
            s.startJob(job.id, "eng1");
          }
          if (status === "Completed") {
            s.assignJob(job.id, "eng1", "2026-12-01", "a");
            s.startJob(job.id, "eng1");
            s.completeJob(job.id, "eng1");
          }

          if (status === "Completed") {
            expect(() => s.updateJob(job.id, { siteLocation: "B" })).toThrowError(AppError);
          } else {
            expect(s.updateJob(job.id, { siteLocation: "B" }).siteLocation).toBe("B");
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  // Feature: calibration-services-platform, Property 10: Assignment sets Assigned
  // state and requires a Site Engineer.
  it("Property 10: assignment requires Site Engineer and sets Assigned", () => {
    fc.assert(
      fc.property(fc.constantFrom("eng1", "not-an-engineer"), (assignee) => {
        const s = svc(["eng1"]);
        const job = s.createJob(validInput(1));
        if (assignee === "eng1") {
          const assigned = s.assignJob(job.id, assignee, "2026-12-01", "a");
          expect(assigned.status).toBe("Assigned");
          expect(assigned.assignedEngineerId).toBe("eng1");
          expect(assigned.scheduledDate).toBe("2026-12-01");
        } else {
          expect(() => s.assignJob(job.id, assignee, "2026-12-01", "a")).toThrowError(AppError);
        }
      }),
      { numRuns: 200 }
    );
  });

  // Feature: calibration-services-platform, Property 11: An engineer's job list
  // reflects the current assignment.
  it("Property 11: job appears only in the currently assigned engineer's list", () => {
    const s = svc(["eng1", "eng2"]);
    const job = s.createJob(validInput(1));
    s.assignJob(job.id, "eng1", "2026-12-01", "a");
    expect(s.getAssignedJobs("eng1").map((j) => j.id)).toContain(job.id);
    expect(s.getAssignedJobs("eng2").map((j) => j.id)).not.toContain(job.id);

    s.reassignJob(job.id, "eng2", "a");
    expect(s.getAssignedJobs("eng1").map((j) => j.id)).not.toContain(job.id);
    expect(s.getAssignedJobs("eng2").map((j) => j.id)).toContain(job.id);
  });

  // Feature: calibration-services-platform, Property 12: A job's item view
  // returns exactly that job's items.
  it("Property 12: getItems returns exactly that job's items", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 6 }), (a, b) => {
        const s = svc();
        const j1 = s.createJob(validInput(a));
        const j2 = s.createJob(validInput(b));
        expect(s.getItems(j1.id).every((it) => it.jobId === j1.id)).toBe(true);
        expect(s.getItems(j1.id).length).toBe(a);
        expect(s.getItems(j2.id).length).toBe(b);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: calibration-services-platform, Property 21: Job status is always a
  // valid lifecycle value.
  it("Property 21: status always a valid lifecycle value", () => {
    const s = svc();
    const job = s.createJob(validInput(1));
    expect(JobsService.isValidStatus(job.status)).toBe(true);
    s.assignJob(job.id, "eng1", "2026-12-01", "a");
    expect(JobsService.isValidStatus(s.getJob(job.id).status)).toBe(true);
    s.startJob(job.id, "eng1");
    expect(JobsService.isValidStatus(s.getJob(job.id).status)).toBe(true);
    s.completeJob(job.id, "eng1");
    expect(JobsService.isValidStatus(s.getJob(job.id).status)).toBe(true);
  });

  // Feature: calibration-services-platform, Property 22: Every status change is
  // recorded with actor and timestamp.
  it("Property 22: status history records each transition with actor", () => {
    const s = svc();
    const job = s.createJob(validInput(1));
    s.assignJob(job.id, "eng1", "2026-12-01", "assistant");
    s.startJob(job.id, "eng1");
    s.completeJob(job.id, "eng1");
    const history = s.getStatusHistory(job.id);
    expect(history.map((h) => h.toStatus)).toEqual([
      "Created",
      "Assigned",
      "In Progress",
      "Completed",
    ]);
    for (const h of history) {
      expect(h.changedById).toBeTruthy();
      expect(h.changedAt).toBeInstanceOf(Date);
    }
  });
});
