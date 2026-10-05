/**
 * Fast list processing in JavaScript.
 * After the jobs API returns, strip photos / signatures / files in one pass
 * so React never holds megabytes of images on Dashboard, Jobs, Reports.
 */

var HEAVY = [
  "photoDataUrl",
  "extraPhotoDataUrl",
  "idCardDataUrl",
  "signature",
  "signatureDataUrl",
  "trainerSignature",
  "layoutImageDataUrl",
  "sheetInsigniaLogoDataUrl",
  "qrDataUrl",
  "barcodeDataUrl",
  "dataUrl",
];

function dropHeavy(obj) {
  if (!obj || typeof obj !== "object") return;
  for (var i = 0; i < HEAVY.length; i++) {
    var key = HEAVY[i];
    if (obj[key]) obj[key] = undefined;
  }
}

function slimPeople(list) {
  if (!list) return;
  for (var i = 0; i < list.length; i++) dropHeavy(list[i]);
}

/** True when this request is the jobs list, not one opened job. */
export function isJobListRequest(method, path) {
  return method === "GET" && path === "/api/training";
}

/**
 * Mutates the list in place (fastest). Names and status stay; images go.
 * @param {unknown} data
 * @returns {unknown}
 */
export function processJobList(data) {
  if (!Array.isArray(data)) return data;
  for (var i = 0; i < data.length; i++) {
    var job = data[i];
    if (!job || typeof job !== "object") continue;
    dropHeavy(job);
    job.contractReview = undefined;
    job.workPermit = undefined;
    job.tempResults = undefined;
    job.humResults = undefined;
    job.loggerLocations = undefined;
    job.protocolChanges = undefined;
    if (job.itemResults) job.itemResults = [];
    slimPeople(job.attendees);
    slimPeople(job.certificates);
    slimPeople(job.attachments);
  }
  return data;
}
