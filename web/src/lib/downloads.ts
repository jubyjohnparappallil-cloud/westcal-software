import { downloadFile } from "../api";

const certBase = (jobId: string, certId: string) => `/api/training/${jobId}/certificates/${certId}`;

export const downloads = {
  certificate: (jobId: string, certId: string, no: string) =>
    downloadFile(`${certBase(jobId, certId)}/pdf`, no + "-certificate.pdf"),
  certificateNoPhoto: (jobId: string, certId: string, no: string) =>
    downloadFile(`${certBase(jobId, certId)}/nophoto-pdf`, no + "-certificate-nophoto.pdf"),
  certificateLayout: (jobId: string, certId: string, no: string) =>
    downloadFile(`${certBase(jobId, certId)}/layout-pdf`, no + "-layout.pdf"),
  certificateContent: (jobId: string, certId: string, no: string) =>
    downloadFile(`${certBase(jobId, certId)}/content-pdf`, no + "-data.pdf"),
  certificateContentNoPhoto: (jobId: string, certId: string, no: string) =>
    downloadFile(`${certBase(jobId, certId)}/content-nophoto-pdf`, no + "-data-nophoto.pdf", {
      failMessage: "Inside data without photo download failed",
    }),
  certificateOld: (jobId: string, certId: string, no: string) =>
    downloadFile(`${certBase(jobId, certId)}/old-docx`, no + "-old-design.docx", {
      failMessage: "Old design document download failed",
    }),
  certificateSpecial: (jobId: string, certId: string, no: string) =>
    downloadFile(`${certBase(jobId, certId)}/special-docx`, no + "-special.docx", {
      failMessage: "Special certificate download failed",
    }),
  card: (jobId: string, certId: string, no: string) =>
    downloadFile(`${certBase(jobId, certId)}/card-pdf`, no + "-card.pdf", { failMessage: "Card PDF download failed" }),
  cardClassic: (jobId: string, certId: string, no: string) =>
    downloadFile(`${certBase(jobId, certId)}/classic-card-pdf`, no + "-classic-card.pdf", {
      failMessage: "Old ID card download failed",
    }),
  cardClassicShrink: (jobId: string, certId: string, no: string) =>
    downloadFile(`${certBase(jobId, certId)}/classic-card-pdf?fit=shrink`, no + "-old-card-shrink.pdf", {
      failMessage: "Old ID card download failed",
    }),
  cardLayout: (jobId: string, certId: string, no: string) =>
    downloadFile(`${certBase(jobId, certId)}/card-layout-pdf`, no + "-card-design.pdf", {
      failMessage: "Card design download failed",
    }),
  jobData: (jobId: string, jobNo: string) =>
    downloadFile(`/api/training/${jobId}/data-pdf`, jobNo + "-submitted-data.pdf", { failMessage: "Data PDF download failed" }),
  attendance: (jobId: string, jobNo: string) =>
    downloadFile(`/api/training/${jobId}/attendance-pdf`, "WESTCAL-" + jobNo + "-attendance.pdf", {
      failMessage: "Attendance PDF download failed",
    }),
  jobSheet: (jobId: string, jobNo: string) =>
    downloadFile(
      `/api/training/${jobId}/job-sheet-pdf`,
      "WESTCAL-" + String(jobNo || "job").replace(/^WC-/i, "").replace(/[^a-zA-Z0-9_-]/g, "_") + "-training-contract-review-form.pdf",
    ),
  workPermit: (jobId: string, jobNo: string) =>
    downloadFile(`/api/training/${jobId}/work-permit-pdf`, "WESTCAL-" + jobNo + "-work-permit.pdf"),
  review: (jobId: string, jobNo: string) =>
    downloadFile(
      `/api/training/${jobId}/review-pdf`,
      "WESTCAL-" + String(jobNo || "job").replace(/^WC-/i, "").replace(/[^a-zA-Z0-9_-]/g, "_") + "-training-contract-review-form.pdf",
    ),
  mappingProtocol: (jobId: string) =>
    downloadFile(`/api/training/${jobId}/protocol`, "mapping-protocol.docx", {
      failMessage: "Protocol download failed",
      useServerName: true,
    }),
};

export async function copyText(text: string, okMessage: string, promptLabel: string, promptValue = text) {
  try {
    await navigator.clipboard.writeText(text);
    alert(okMessage);
  } catch {
    prompt(promptLabel, promptValue);
  }
}

export function copyPublicLink(jobId: string) {
  const url = location.origin + "/public/training/" + jobId;
  const text =
    "Westcal training attendance — open this link, upload your Emirates ID, check your details, sign and send:\n" + url;
  return copyText(text, "Customer attendance link copied.", "Copy this customer link", url);
}

export function copyTraineeJoin(token: string, editToken?: string) {
  const url = location.origin + "/join/" + token + (editToken ? "/" + editToken : "");
  const text =
    "Westcal training — open this link, check your details, upload your Emirates ID, sign and send:\n" + url;
  return copyText(text, "Trainee link copied. Send it to that person:\n" + url, "Copy this trainee link", url);
}
