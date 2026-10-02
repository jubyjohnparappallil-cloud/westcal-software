import { downloadFile } from "../api";

const t = () => `?t=${Date.now()}`;
const certBase = (jobId: string, certId: string) => `/api/training/${jobId}/certificates/${certId}`;

export const downloads = {
  certificate: (jobId: string, certId: string, no: string) =>
    downloadFile(`${certBase(jobId, certId)}/pdf${t()}`, no + "-certificate.pdf", { noStore: true }),
  certificateNoPhoto: (jobId: string, certId: string, no: string) =>
    downloadFile(`${certBase(jobId, certId)}/nophoto-pdf${t()}`, no + "-certificate-nophoto.pdf", { noStore: true }),
  certificateLayout: (jobId: string, certId: string, no: string) =>
    downloadFile(`${certBase(jobId, certId)}/layout-pdf${t()}`, no + "-layout.pdf", { noStore: true }),
  certificateContent: (jobId: string, certId: string, no: string) =>
    downloadFile(`${certBase(jobId, certId)}/content-pdf${t()}`, no + "-data.pdf", { noStore: true }),
  card: (jobId: string, certId: string, no: string) =>
    downloadFile(`${certBase(jobId, certId)}/card-pdf`, no + "-card.pdf", { failMessage: "Card PDF download failed" }),
  cardLayout: (jobId: string, certId: string, no: string) =>
    downloadFile(`${certBase(jobId, certId)}/card-layout-pdf${t()}`, no + "-card-design.pdf", {
      failMessage: "Card design download failed",
    }),
  jobData: (jobId: string, jobNo: string) =>
    downloadFile(`/api/training/${jobId}/data-pdf`, jobNo + "-submitted-data.pdf", { failMessage: "Data PDF download failed" }),
  attendance: (jobId: string, jobNo: string) =>
    downloadFile(`/api/training/${jobId}/attendance-pdf`, "WESTCAL-" + jobNo + "-attendance.pdf", {
      failMessage: "Attendance PDF download failed",
    }),
  jobSheet: (jobId: string, jobNo: string) =>
    downloadFile(`/api/training/${jobId}/job-sheet-pdf`, "WESTCAL-" + jobNo + "-job-sheet.pdf"),
  workPermit: (jobId: string, jobNo: string) =>
    downloadFile(`/api/training/${jobId}/work-permit-pdf`, "WESTCAL-" + jobNo + "-work-permit.pdf"),
  review: (jobId: string, jobNo: string) =>
    downloadFile(`/api/training/${jobId}/review-pdf`, "WESTCAL-" + jobNo + "-review-form.pdf"),
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
  return copyText("Customer attendance sheet: " + url, "Customer link copied:\n" + url, "Copy this customer link", url);
}

export function copyTraineeJoin(token: string, editToken?: string) {
  const url = location.origin + "/join/" + token + (editToken ? "/" + editToken : "");
  return copyText(url, "Send this link to that trainee:\n" + url, "Copy this trainee link");
}
