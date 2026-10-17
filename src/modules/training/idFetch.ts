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
  company: string;
  /** Employer printed on the back of the Emirates ID. */
  employer: string;
  course: string;
  trainingDate: string;
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
 * A real card name is two or more proper words. OCR noise like
 * "QO SF SLARE H x hE N M EE" is mostly 1–2 letter scraps and is dropped.
 */
export function cleanName(raw: string): string {
  const letters = String(raw || "")
    .replace(/[^A-Za-z' .-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = letters.split(" ").filter((w) => /[A-Za-z]{2,}/.test(w));
  const strong = words.filter((w) => w.replace(/[^A-Za-z]/g, "").length >= 3);
  if (strong.length < 2) return "";
  if (strong.length / words.length < 0.5) return "";
  return words.join(" ");
}

/** Latin name line on Emirates IDs when OCR misses the "Name:" label. */
function extractUnlabeledName(ocrText: string): string {
  const skip =
    /UNITED|ARAB|EMIRATES|IDENTITY|RESIDENT|NATIONALITY|BIRTH|DATE|CARD|ISLAMIC|SEX|MALE|FEMALE|SIGNATURE|OCCUPATION|SPONSOR|784|ID NUMBER|ID NO|WESTCAL|INSTRUMENTATION|CALIBRATION|CERTIFICATE|COMPANY|TRAINING|EXPIRES|OPERATOR|INSPECTOR|HTTPS/;
  let best = "";
  for (const raw of ocrText.split(/\n/)) {
    const letters = raw.replace(/[^A-Za-z ]/g, " ").replace(/\s+/g, " ").trim();
    const words = letters.split(" ").filter((w) => w.length > 1);
    if (words.length < 2 || words.length > 8) continue;
    if (letters.length < 8 || letters.length > 60) continue;
    if (skip.test(letters.toUpperCase())) continue;
    const compact = letters.replace(/ /g, "");
    const upper = compact.replace(/[^A-Z]/g, "").length / Math.max(1, compact.length);
    if (upper < 0.65 && !/^[A-Z][a-z]+(?: [A-Z][a-z]+){1,7}$/.test(letters)) continue;
    const candidate = cleanName(letters);
    if (candidate.length > best.length) best = candidate;
  }
  return best;
}

/** Employer line on the back of an Emirates ID: "Employer: Maryam Suliman Technical Services". */
export function extractEmployer(ocrText: string): string {
  const m = ocrText.match(/Employer\s*[:\-]?\s*([^\n\r]+)/i);
  if (!m) return "";
  return m[1]
    .replace(/[^\x00-\x7F]/g, " ")
    .replace(/\b(?:Issuing|Occupation|Card|Number|Place)\b[\s\S]*$/i, "")
    .replace(/[^A-Za-z0-9 .,&'()/-]/g, " ")
    .replace(/\s+\d+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function labeledValue(ocrText: string, label: RegExp): string {
  const m = ocrText.match(label);
  return m ? m[1].replace(/^[:\s]+/, "").split(/\n/)[0].trim() : "";
}

/** Westcal plastic training card (name, course, company, training date). */
function parseWestcalCard(ocrText: string): { name: string; company: string; course: string; trainingDate: string } {
  const company = labeledValue(ocrText, /Company[:\s]+([^\n]+)/i);
  const trainingDate = toIsoDate(labeledValue(ocrText, /Training\s*Date[:\s]+([\d./-]+)/i));
  const skipCourse = /CERTIFICATE|COMPANY|TRAINING|EXPIRES|WESTCAL|HTTPS|DUBAI/;
  let course = "";
  const nameParts: string[] = [];
  for (const raw of ocrText.split(/\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (/Certificate\s*No|Company|Training\s*Date|Expires/i.test(line)) continue;
    const letters = line.replace(/[^A-Za-z ]/g, " ").replace(/\s+/g, " ").trim();
    if (!letters) continue;
    if (skipCourse.test(letters.toUpperCase())) continue;
    const words = letters.split(" ").filter((w) => w.length > 1);
    const compact = letters.replace(/ /g, "");
    const upper = compact.replace(/[^A-Z]/g, "").length / Math.max(1, compact.length);
    if (!course && words.length >= 2 && words.length <= 6 && upper < 0.7) course = letters;
    if (upper >= 0.7 && words.length >= 1 && letters.length >= 5 && letters.length <= 48) {
      const piece = cleanName(letters) || (words.length === 1 && letters.replace(/[^A-Za-z]/g, "").length >= 5 ? letters : "");
      if (piece) nameParts.push(piece);
    }
  }
  const name = nameParts.join(" ").replace(/\s+/g, " ").trim();
  return { name, company, course, trainingDate };
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

  const westcal = parseWestcalCard(ocrText);
  const name =
    cleanName(get(/Name[:\s]+([^\n]+)/i)) ||
    cleanName(get(/(?:Full Name|Card Holder|Holder Name)[:\s]+([^\n]+)/i)) ||
    cleanName(westcal.name) ||
    extractUnlabeledName(ocrText);
  const idOrVisaNo = extractEmiratesIdNumber(ocrText)
    || get(/(?:Visa|File)\s*(?:No|Number)[:\s]+([\w/-]+)/i);
  const nationality = get(/Nationality[:\s]+([A-Za-z ]+)/i);
  const dobRaw = get(/(?:Date of Birth|DOB|Birth Date|Date of birth)[:\s]+([\d/-]{8,10})/i);
  const dateOfBirth = toIsoDate(dobRaw);
  const employer = extractEmployer(ocrText);
  const company = employer || westcal.company;
  const course = westcal.course;
  const trainingDate = westcal.trainingDate;
  const trainingCard = !!(company || trainingDate || /Certificate\s*No/i.test(ocrText));

  let phoneHaystack = ocrText;
  if (idOrVisaNo) phoneHaystack = phoneHaystack.split(idOrVisaNo).join(" ");
  phoneHaystack = phoneHaystack.replace(/784[\s\-–—.]?\d{4}[\s\-–—.]?\d{7}[\s\-–—.]?\d/g, " ");
  phoneHaystack = phoneHaystack.replace(/784\d{12}/g, " ");
  if (dobRaw) phoneHaystack = phoneHaystack.split(dobRaw).join(" ");
  const mobileNumber = trainingCard ? "" : findMobile(phoneHaystack);

  let filled = 0;
  if (name) filled++;
  if (idOrVisaNo) filled++;
  if (nationality) filled++;
  if (dateOfBirth) filled++;
  if (trainingCard) {
    filled = 0;
    if (name) filled++;
    if (company) filled++;
    if (trainingDate) filled++;
    if (course) filled++;
  }
  const confidence = filled / 4;

  return { name, idOrVisaNo, nationality, mobileNumber, dateOfBirth, company, employer, course, trainingDate, confidence };
}
