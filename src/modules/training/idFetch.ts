/**
 * ID card auto-fetch. In production this runs OCR (e.g. Tesseract or a cloud
 * ID service) on the uploaded Emirates ID / passport image. Here we implement
 * a text parser that extracts the standard fields from OCR'd text, so the
 * workflow works end to end. The trainer always reviews/corrects the result.
 */

export interface FetchedId {
  name: string;
  idOrVisaNo: string;
  nationality: string;
  mobileNumber: string;
  /** ISO yyyy-mm-dd so it drops straight into an <input type="date">. */
  dateOfBirth: string;
  confidence: number; // 0..1 rough confidence
}

/**
 * Normalise the date formats printed on Emirates IDs / passports to ISO.
 * Cards show dd/mm/yyyy or dd-mm-yyyy; some OCR output gives yyyy-mm-dd.
 */
function toIsoDate(raw: string): string {
  const s = raw.trim();
  const iso = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return "";
}

/**
 * Find a plausible mobile number. Emirates IDs carry several long digit runs,
 * so candidates are filtered to a real phone length (7-15 digits, per E.164)
 * and the first one that qualifies wins.
 */
function findMobile(text: string): string {
  const candidates = text.match(/\+?\d[\d\s-]{5,19}\d/g) ?? [];
  for (const raw of candidates) {
    const digits = raw.replace(/[\s-]/g, "").replace(/^\+/, "");
    if (digits.length >= 7 && digits.length <= 15) return digits;
  }
  return "";
}

/** 784-YYYY-XXXXXXX-C as printed on the card. */
function formatEmiratesId(digits: string): string {
  if (!/^784\d{12}$/.test(digits)) return "";
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 14)}-${digits.slice(14)}`;
}

function ocrDigits(raw: string): string {
  return raw
    .replace(/[OoDd]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[Zz]/g, "2")
    .replace(/B/g, "8")
    .replace(/\D/g, "");
}

/**
 * Pull the Emirates ID number out of messy OCR. The number lives in the lower
 * strip (and on the back / MRZ). Tesseract often turns hyphens into spaces,
 * splits groups across lines, or reads 7841990… with no separators.
 */
export function extractEmiratesIdNumber(ocrText: string): string {
  const labeled = ocrText.match(
    /(?:ID\s*Number|ID\s*No\.?|Emirates\s*ID|Identity\s*(?:No|Number)|Card\s*No\.?)[:\s]*([0-9OIl|SZzB][0-9OIl|SZzB\s\-–—.]{10,})/i
  );
  if (labeled) {
    const formatted = formatEmiratesId(ocrDigits(labeled[1]).slice(0, 15));
    if (formatted) return formatted;
  }

  const spaced = ocrText.match(/784[\s\-–—.]{0,3}\d{4}[\s\-–—.]{0,3}\d{7}[\s\-–—.]{0,3}\d/g);
  if (spaced) {
    for (const hit of spaced) {
      const formatted = formatEmiratesId(hit.replace(/\D/g, ""));
      if (formatted) return formatted;
    }
  }

  const allDigits = ocrDigits(ocrText);
  const compact = allDigits.match(/784\d{12}/);
  if (compact) return formatEmiratesId(compact[0]);

  for (let i = 0; i <= allDigits.length - 15; i++) {
    if (allDigits.slice(i, i + 3) !== "784") continue;
    const year = Number(allDigits.slice(i + 3, i + 7));
    if (year < 1930 || year > 2035) continue;
    const formatted = formatEmiratesId(allDigits.slice(i, i + 15));
    if (formatted) return formatted;
  }
  return "";
}

/**
 * Parse OCR text from an Emirates ID. Emirates ID has predictable labels:
 *   Name: ...
 *   ID Number: 784-XXXX-XXXXXXX-X  (often in the lower / second strip)
 *   Nationality: ...
 *   Date of Birth: dd/mm/yyyy
 */
export function parseEmiratesId(ocrText: string): FetchedId {
  const get = (label: RegExp): string => {
    const m = ocrText.match(label);
    return m ? m[1].trim() : "";
  };

  const name = get(/Name[:\s]+([A-Za-z ].+)/i)
    || get(/(?:Full Name|Card Holder)[:\s]+([A-Za-z ].+)/i);
  const idOrVisaNo = extractEmiratesIdNumber(ocrText)
    || get(/(?:Visa|File)\s*(?:No|Number)[:\s]+([\w/-]+)/i);
  const nationality = get(/Nationality[:\s]+([A-Za-z ]+)/i);
  const dobRaw = get(/(?:Date of Birth|DOB|Birth Date|Date of birth)[:\s]+([\d/-]{8,10})/i);
  const dateOfBirth = toIsoDate(dobRaw);

  // Hunt for the phone number last, with the ID number and the date of birth
  // removed from the text first. Both are long digit runs and would otherwise
  // be picked up as the phone number.
  let phoneHaystack = ocrText;
  if (idOrVisaNo) phoneHaystack = phoneHaystack.split(idOrVisaNo).join(" ");
  phoneHaystack = phoneHaystack.replace(/784[\s\-–—.]?\d{4}[\s\-–—.]?\d{7}[\s\-–—.]?\d/g, " ");
  phoneHaystack = phoneHaystack.replace(/784\d{12}/g, " ");
  if (dobRaw) phoneHaystack = phoneHaystack.split(dobRaw).join(" ");
  const mobileNumber = findMobile(phoneHaystack);

  let filled = 0;
  if (name) filled++;
  if (idOrVisaNo) filled++;
  if (nationality) filled++;
  if (dateOfBirth) filled++;
  const confidence = filled / 4;

  return { name, idOrVisaNo, nationality, mobileNumber, dateOfBirth, confidence };
}
