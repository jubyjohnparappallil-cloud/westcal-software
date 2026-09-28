/**
 * Runnable walkthrough of the platform modules. Run with:
 *   npx tsx src/demo.ts
 * It exercises: user creation, auth, permissions, job creation + assignment,
 * field work (GPS + QR + calibration), auto-completion, and certificate
 * generation with both a verification QR code and a Code 128 barcode.
 */
import { createPlatform } from "./app.js";
import { FixedClock } from "./shared/clock.js";

function line(title: string): void {
  console.log("\n" + "=".repeat(60) + "\n" + title + "\n" + "=".repeat(60));
}

async function main(): Promise<void> {
  const clock = new FixedClock(new Date("2026-09-04T08:00:00Z"));
  const p = createPlatform(clock);

  line("1. PERMISSIONS — grant the Site_Engineer role its permissions");
  p.permissions.setRolePermissions("role-site-engineer", [
    { module: "Jobs", action: "read" },
    { module: "Jobs", action: "edit" },
  ]);
  console.log("Site_Engineer effective permissions:",
    [...p.permissions.getEffectivePermissions("will-attach-after-user")]);

  line("2. USERS — Super Admin creates a Site Engineer account");
  const engineer = p.users.createUser({
    identifier: "eng-omar",
    displayName: "Omar (Site Engineer)",
    credential: "pw",
    roleIds: ["role-site-engineer"],
  });
  console.log("Created user:", { id: engineer.id, identifier: engineer.identifier, status: engineer.status });
  console.log("Omar's permissions (via role):",
    [...p.permissions.getEffectivePermissions(engineer.id)]);
  console.log("Can Omar edit Jobs?", p.permissions.authorize(engineer.id, "Jobs", "edit"));
  console.log("Can Omar delete Users?", p.permissions.authorize(engineer.id, "Users", "delete"));

  line("3. AUTH — Omar signs in, session is resolved");
  const { token } = p.auth.signIn("eng-omar", "pw");
  console.log("Signed in, session token:", token.slice(0, 8) + "...");
  console.log("Resolved session userId:", p.auth.resolveSession(token).userId);
  console.log("Wrong password rejected?");
  try { p.auth.signIn("eng-omar", "wrong"); } catch (e) { console.log("  ->", (e as Error).message); }

  line("4. JOBS — a calibration job is created and assigned to Omar");
  const job = p.jobs.createJob({
    type: "Calibration",
    customerName: "Gulf Refinery LLC",
    siteLocation: "Jebel Ali, Dubai",
    createdById: "admin",
    items: [
      { assetName: "Pressure Gauge PG-1", qrToken: "PG-1-TOKEN", requiredMeasurements: ["reading"] },
      { assetName: "Thermometer TH-2", qrToken: "TH-2-TOKEN", requiredMeasurements: ["reading"] },
    ],
  });
  console.log("Job created:", { id: job.id.slice(0, 8), status: job.status, items: p.jobs.getItems(job.id).length });
  p.jobs.assignJob(job.id, engineer.id, "2026-09-10", "assistant");
  console.log("After assignment, status:", p.jobs.getJob(job.id).status);
  console.log("Omar's assigned jobs:", p.jobs.getAssignedJobs(engineer.id).map((j) => j.customerName));

  line("5. FIELD (mobile workflow) — start job, capture GPS, scan QR, record");
  p.jobs.startJob(job.id, engineer.id);
  console.log("Job status now:", p.jobs.getJob(job.id).status);

  const gps = p.field.persistGps(job.id, {
    clientCaptureId: "cap-1",
    eventType: "Start",
    latitude: 25.0125,
    longitude: 55.0631,
    accuracyMeters: 12,
    capturedAt: clock.now().toISOString(),
  });
  console.log("GPS captured:", { lat: gps.latitude, lon: gps.longitude, accuracy: gps.accuracyMeters + "m", lowAccuracy: gps.lowAccuracy });

  const lowGps = p.field.persistGps(job.id, {
    clientCaptureId: "cap-2", eventType: "Start",
    latitude: 25.0, longitude: 55.0, accuracyMeters: 80,
    capturedAt: clock.now().toISOString(),
  });
  console.log("A weak GPS fix (80m) is flagged:", { accuracy: "80m", lowAccuracy: lowGps.lowAccuracy });

  for (const item of p.jobs.getItems(job.id)) {
    const scan = p.field.recordScan(job.id, item.qrToken!, clock.now().toISOString());
    console.log(`Scanned '${item.assetName}' -> matched:`, scan.matched);
    p.field.submitCalibrationRecord(job.id, item.id, { reading: 101.3 }, "Pass", engineer.id);
    console.log(`  recorded calibration for ${item.assetName}`);
  }

  console.log("A wrong QR (not in this job) is handled:");
  const bad = p.field.recordScan(job.id, "UNKNOWN-QR", clock.now().toISOString());
  console.log("  matched?", bad.matched, "(recorded against the job, not an item)");

  line("6. COMPLETION + CERTIFICATE — with QR code AND Code 128 barcode");
  console.log("Job status after all items recorded:", p.jobs.getJob(job.id).status);
  const cert = await p.certificates.generateCertificate(job.id);
  console.log("Certificate generated:");
  console.log("  documentNumber (in BARCODE):", cert.documentNumber);
  console.log("  verificationRef (in QR):    ", cert.verificationRef.slice(0, 12) + "...");
  console.log("  customer:", cert.customerName);
  console.log("  item results:", cert.itemResults.map((r) => `${r.assetName}=${r.result}`).join(", "));
  console.log("  QR image:     ", cert.qrDataUrl.slice(0, 40) + "...  (" + cert.qrDataUrl.length + " chars)");
  console.log("  Barcode image:", cert.barcodeDataUrl.slice(0, 40) + "...  (" + cert.barcodeDataUrl.length + " chars)");

  line("7. STATUS HISTORY — every transition recorded");
  for (const h of p.jobs.getStatusHistory(job.id)) {
    console.log(`  ${h.fromStatus ?? "(none)"} -> ${h.toStatus}  by ${h.changedById}`);
  }

  console.log("\nDone. All modules exercised end-to-end.\n");
}

main().catch((e) => {
  console.error("Demo failed:", e);
  process.exit(1);
});
