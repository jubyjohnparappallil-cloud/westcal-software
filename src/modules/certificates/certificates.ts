import { newId, newVerificationRef } from "../../shared/id.js";
import { JobsService } from "../jobs/jobs.js";
import { FieldService } from "../field/field.js";
import { DocumentCodes } from "../documents/documentCodes.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";

export interface CertificateItemResult {
  jobItemId: string;
  assetName: string;
  measurements: Record<string, number | string>;
  result: "Pass" | "Fail";
}

export interface Certificate {
  id: string;
  jobId: string;
  documentNumber: string; // encoded in the Code 128 barcode (Req 19)
  verificationRef: string; // encoded in the verification QR (Req 18)
  customerName: string;
  calibrationDate: string;
  itemResults: CertificateItemResult[];
  qrDataUrl: string; // Verification_QR_Code image
  barcodeDataUrl: string; // Document_Barcode image
  generatedAt: Date;
}

/**
 * Certificates module (Requirements 10, 18, 19).
 *
 * Generates a calibration certificate when a job is Completed, assigns a unique
 * document number and verification reference, and embeds BOTH a verification QR
 * code and a Code 128 barcode of the document number.
 */
export class CertificateService {
  private readonly certificates = new Map<string, Certificate>();
  private readonly byJob = new Map<string, string>();
  private seq = 0;

  constructor(
    private readonly jobs: JobsService,
    private readonly field: FieldService,
    private readonly codes: DocumentCodes
  ) {}

  /** Unique, human-readable certificate number (encoded in the barcode). */
  private nextDocumentNumber(): string {
    this.seq += 1;
    const year = new Date().getFullYear();
    return `CAL-${year}-${String(this.seq).padStart(6, "0")}`;
  }

  /** AC 10.1, 10.3, 18.1, 19.x. */
  async generateCertificate(jobId: string): Promise<Certificate> {
    const job = this.jobs.getJob(jobId);
    if (job.status !== "Completed") {
      throw new ConflictError("Job is not complete", "status"); // AC 10.3
    }
    if (this.byJob.has(jobId)) {
      return this.certificates.get(this.byJob.get(jobId)!)!;
    }

    const items = this.jobs.getItems(jobId);
    const itemResults: CertificateItemResult[] = items.map((it) => {
      const rec = this.field.getRecord(it.id);
      return {
        jobItemId: it.id,
        assetName: it.assetName,
        measurements: rec?.measurements ?? {},
        result: rec?.result ?? "Fail",
      };
    });

    const documentNumber = this.nextDocumentNumber();
    // AC 19.5: reject if the document number cannot be encoded.
    this.codes.validateBarcodeEncodable(documentNumber);

    const verificationRef = newVerificationRef();
    const qr = await this.codes.renderVerificationQr(verificationRef);
    const barcode = await this.codes.renderDocumentBarcode(documentNumber);

    const cert: Certificate = {
      id: newId(),
      jobId,
      documentNumber,
      verificationRef,
      customerName: job.customerName,
      calibrationDate: new Date().toISOString().slice(0, 10),
      itemResults,
      qrDataUrl: qr.dataUrl,
      barcodeDataUrl: barcode.dataUrl,
      generatedAt: new Date(),
    };
    this.certificates.set(cert.id, cert);
    this.byJob.set(jobId, cert.id);
    return cert;
  }

  getCertificate(id: string): Certificate {
    const c = this.certificates.get(id);
    if (!c) throw new NotFoundError("certificate not found");
    return c;
  }

  getByJob(jobId: string): Certificate | undefined {
    const id = this.byJob.get(jobId);
    return id ? this.certificates.get(id) : undefined;
  }
}
