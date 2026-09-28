import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { DocumentCodes } from "./documentCodes.js";
import { encodeCode128B, decodeCode128B } from "./code128.js";
import { AppError } from "../../shared/errors.js";

// Printable ASCII (code set B) for document numbers.
const docNumberArb = fc
  .stringOf(
    fc.integer({ min: 32, max: 126 }).map((c) => String.fromCharCode(c)),
    { minLength: 1, maxLength: 24 }
  );

describe("DocumentCodes (QR + Code 128 barcode)", () => {
  const codes = new DocumentCodes();

  // Feature: calibration-services-platform, Property 23: Issued documents carry
  // a QR code and a barcode that round-trip.
  it("Property 23: QR + barcode round-trip; unencodable numbers rejected", async () => {
    await fc.assert(
      fc.asyncProperty(docNumberArb, async (documentNumber) => {
        // Barcode round-trip: encoding then decoding recovers the exact value.
        const decoded = decodeCode128B(encodeCode128B(documentNumber));
        expect(decoded).toBe(documentNumber);

        // Renderer produces a PNG barcode and a QR asset.
        const barcode = await codes.renderDocumentBarcode(documentNumber);
        expect(barcode.png.length).toBeGreaterThan(0);
        expect(barcode.dataUrl.startsWith("data:image/png;base64,")).toBe(true);

        const verificationRef = "ref-" + documentNumber.replace(/[^a-zA-Z0-9]/g, "");
        const qr = await codes.renderVerificationQr(verificationRef || "ref-x");
        expect(qr.png.length).toBeGreaterThan(0);
        expect(qr.dataUrl.startsWith("data:image")).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("Property 23 (negative): non-ASCII document number is rejected", () => {
    fc.assert(
      fc.property(
        fc.stringOf(
          fc.integer({ min: 128, max: 500 }).map((c) => String.fromCodePoint(c)),
          { minLength: 1, maxLength: 6 }
        ),
        (badNumber) => {
          expect(() => codes.validateBarcodeEncodable(badNumber)).toThrowError(AppError);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("empty document number is rejected", () => {
    expect(() => codes.validateBarcodeEncodable("")).toThrowError(AppError);
  });
});
