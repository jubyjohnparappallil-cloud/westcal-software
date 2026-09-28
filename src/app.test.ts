import { describe, it, expect } from "vitest";
import { createPlatform } from "./app.js";
import { FixedClock } from "./shared/clock.js";

describe("Platform end-to-end flow", () => {
  it("runs sign-in -> create job -> assign -> field work -> certificate with QR + barcode", async () => {
    const clock = new FixedClock();
    const p = createPlatform(clock);

    // Super admin creates an engineer
    const engineer = p.users.createUser({
      identifier: "eng-omar",
      credential: "pw",
      roleIds: ["role-site-engineer"],
    });

    // Engineer signs in
    const { token } = p.auth.signIn("eng-omar", "pw");
    expect(p.auth.resolveSession(token).userId).toBe(engineer.id);

    // A job is created and assigned to the engineer
    const job = p.jobs.createJob({
      type: "Calibration",
      customerName: "Gulf Refinery",
      siteLocation: "Jebel Ali",
      createdById: "admin",
      items: [
        { assetName: "Pressure Gauge PG-1", qrToken: "PG-1-TOKEN", requiredMeasurements: ["reading"] },
      ],
    });
    p.jobs.assignJob(job.id, engineer.id, "2026-12-01", "assistant");

    // Field work: start (GPS), scan QR, record calibration
    p.jobs.startJob(job.id, engineer.id);
    p.field.persistGps(job.id, {
      clientCaptureId: "c1",
      eventType: "Start",
      latitude: 25.01,
      longitude: 55.06,
      accuracyMeters: 12,
      capturedAt: clock.now().toISOString(),
    });
    const scan = p.field.recordScan(job.id, "PG-1-TOKEN", clock.now().toISOString());
    expect(scan.matched).toBe(true);
    const item = p.jobs.getItems(job.id)[0];
    p.field.submitCalibrationRecord(job.id, item.id, { reading: 101.3 }, "Pass", engineer.id);

    // Job auto-completes and a certificate is generated with both codes
    expect(p.jobs.getJob(job.id).status).toBe("Completed");
    const cert = await p.certificates.generateCertificate(job.id);
    expect(cert.customerName).toBe("Gulf Refinery");
    expect(cert.qrDataUrl.startsWith("data:image")).toBe(true); // verification QR
    expect(cert.barcodeDataUrl.startsWith("data:image/png;base64,")).toBe(true); // Code 128 barcode
    expect(cert.documentNumber).toMatch(/^CAL-\d{4}-\d{6}$/);
  });

  it("deactivation terminates the engineer's active session", () => {
    const p = createPlatform(new FixedClock());
    const engineer = p.users.createUser({
      identifier: "eng-sara",
      credential: "pw",
      roleIds: ["role-site-engineer"],
    });
    const { token } = p.auth.signIn("eng-sara", "pw");
    p.users.deactivateUser(engineer.id);
    expect(() => p.auth.resolveSession(token)).toThrowError();
  });
});
