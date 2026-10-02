export interface Session {
  token: string;
  userId?: string;
  displayName: string;
  roles: string[];
  perms: string[];
  modules?: string[] | null;
  [key: string]: any;
}

export type Course = string | { id?: string; name: string; description?: string };

export interface Attendee {
  id: string;
  name: string;
  company?: string;
  mobileNumber?: string;
  idOrVisaNo?: string;
  course?: string;
  dob?: string;
  nationality?: string;
  photoDataUrl?: string;
  extraPhotoDataUrl?: string;
  signature?: string;
  signatureDataUrl?: string;
  editToken?: string;
  [key: string]: any;
}

export interface Certificate {
  id: string;
  name: string;
  certificateNo: string;
  attendeeId?: string;
  company?: string;
  course?: string;
  idOrVisaNo?: string;
  trainingDate?: string;
  expiresOn?: string;
  verificationRef?: string;
  [key: string]: any;
}

export interface CancelRequest {
  reason: string;
  requestedBy: string;
  requestedById?: string;
  requestedAt: string;
}

export interface Job {
  id: string;
  jobNo: string;
  jobOrderNo?: string;
  serviceType?: string;
  customerName: string;
  companies?: string[];
  course?: string;
  trainingDate?: string;
  trainingDateTo?: string;
  status: string;
  assigneeId?: string;
  assigneeName?: string;
  trainerName?: string;
  certificateUnder?: string;
  certificateDesign?: string;
  sheetCourseTitle?: string;
  sheetCompany?: string;
  traineeInviteToken?: string;
  invoiceNo?: string;
  cancelRequest?: CancelRequest;
  createdAt?: string;
  updatedAt?: string;
  attendees: Attendee[];
  certificates: Certificate[];
  [key: string]: any;
}

export interface Notification {
  id?: string;
  message: string;
  read: boolean;
  jobId?: string;
  createdAt?: string;
  [key: string]: any;
}
