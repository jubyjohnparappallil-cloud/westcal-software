import QRCode from "qrcode";
import bwipjs from "bwip-js";
import { ValidationError } from "../../shared/errors.js";

/** A rendered image asset (PNG buffer) plus a data URL for embedding. */
export interface ImageAsset {
  png: Buffer;
  dataUrl: string;
}

/**
 * Code 128 encodable character set: ASCII 0..127. bwip-js code128 supports the
 * full ASCII range. We validate against printable + control ASCII (AC 19.5).
 */
function isCode128Encodable(value: string): boolean {
  if (value.length < 1) return false;
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (code > 127) return false; // non-ASCII cannot be encoded (AC 19.5)
  }
  return true;
}

/**
 * DocumentCodes (Requirements 18, 19).
 *
 * Shared helper that renders the two distinct codes stamped on every
 * Issued_Document: a Verification_QR_Code (public verification reference,
 * Requirement 18) and a Document_Barcode (Code 128 of the document number,
 * Requirement 19). Uses established libraries (qrcode, bwip-js); no symbology
 * is implemented from scratch.
 */
export class DocumentCodes {
  constructor(
    private readonly publicBaseUrl = process.env.PUBLIC_BASE_URL ?? "http://127.0.0.1:3000"
  ) {}

  /** AC 19.5: verify the document number is encodable as Code 128. */
  validateBarcodeEncodable(documentNumber: string): void {
    if (!isCode128Encodable(documentNumber)) {
      throw new ValidationError(
        `documentNumber '${documentNumber}' cannot be encoded as Code 128`,
        "documentNumber"
      );
    }
  }

  /** Requirement 18: QR opens the public certificate-verification page. */
  async renderVerificationQr(verificationRef: string): Promise<ImageAsset> {
    const verificationUrl = `${this.publicBaseUrl.replace(/\/+$/, "")}/verify/${encodeURIComponent(verificationRef)}`;
    const dataUrl = await QRCode.toDataURL(verificationUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 240,
    });
    const png = await QRCode.toBuffer(verificationUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 240,
    });
    return { png, dataUrl };
  }

  /**
   * AC 19.3, 19.4: Code 128 barcode whose decoded value equals the document
   * number, rendered with the human-readable number underneath.
   */
  async renderDocumentBarcode(documentNumber: string): Promise<ImageAsset> {
    this.validateBarcodeEncodable(documentNumber);
    const png = await bwipjs.toBuffer({
      bcid: "code128",
      text: documentNumber,
      scale: 3,
      height: 12,
      includetext: true, // human-readable text adjacent to barcode (AC 19.4)
      textxalign: "center",
    });
    const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
    return { png, dataUrl };
  }
}
