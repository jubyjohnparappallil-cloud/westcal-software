import { describe, it, expect } from "vitest";
import { CertificateService } from "./certificates.js";
import { JobsService } from "../jobs/jobs.js";
import { FieldService } from "../field/field.js";
import { DocumentCodes } from "../documents/documentCodes.js";
import { AppError } from "../../shared/errors.js";

function setup(itemCount = 2) {
  const jobs = new JobsService(() => true);
  const field = new FieldService(jobs);
  const certs = new CertificateService(jobs, field, new DocumentCodes());
  const job = jobs.createJob({
    type: "Calibration",
    customerName: "Acme",
    siteLocation: "Site",
    createdById: "creator",
    items: Array.from({ length: itemCount }, (_, i) => ({
      assetName: `asset-${i}`,
      requiredMeasurements: ["m1"],
    })),
  });
  return { jobs, field, certs, job };
}

describe("CertificateService", () => {
  // Feature: calibration-services-platform, Property 20: Certificates are only
  // produced for completed jobs.
  it("Property 20: rejects certificate for a non-completed job", async () => {
    const { certs, job } = setup();
    await expect(certs.generateCertificate(job.id)).rejects.toThrowError(AppError);
  });

  // Feature: calibration-services-platform, Property 19: Certificate content
  // reflects the completed job.
  it("Property 19: certificate contains job + item results + date", async () => {
    const { jobs, field, certs, job } = setup(2);
    const items = jobs.getItems(job.id);
    for (const it of items) {
      field.submitCalibrationRecord(job.id, it.id, { m1: 5 }, "Pass", "eng");
    }
    const cert = await certs.generateCertificate(job.id);
    expect(cert.customerName).toBe("Acme");
    expect(cert.itemResults.length).toBe(2);
    expect(cert.calibrationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cert.itemResults.every((r) => r.result === "Pass")).toBe(true);
  });

  it("certificate carries both a QR code and a Code 128 barcode (Req 18 + 19)", async () => {
    const { jobs, field, certs, job } = setup(1);
    const item = jobs.getItems(job.id)[0];
    field.submitCalibrationRecord(job.id, item.id, { m1: 5 }, "Pass", "eng");
    const cert = await certs.generateCertificate(job.id);

    // Distinct codes: QR encodes verification ref, barcode encodes doc number.
    expect(cert.verificationRef).toBeTruthy();
    expect(cert.documentNumber).toMatch(/^CAL-\d{4}-\d{6}$/);
    expect(cert.qrDataUrl.startsWith("data:image")).toBe(true);
    expect(cert.barcodeDataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(cert.verificationRef).not.toBe(cert.documentNumber);
  });

  it("document numbers are unique across certificates (AC 19.1)", async () => {
    const { jobs, field, certs } = setup(1);
    const numbers = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const job = jobs.createJob({
        type: "Calibration",
        customerName: "C",
        siteLocation: "S",
        createdById: "creator",
        items: [{ assetName: "a", requiredMeasurements: ["m1"] }],
      });
      const item = jobs.getItems(job.id)[0];
      field.submitCalibrationRecord(job.id, item.id, { m1: 1 }, "Pass", "eng");
      const cert = await certs.generateCertificate(job.id);
      numbers.add(cert.documentNumber);
    }
    expect(numbers.size).toBe(5);
  });
});
