import { describe, it, expect } from "vitest";
import { TrainingService, CreateTrainingInput } from "./training.js";
import { DocumentCodes } from "../documents/documentCodes.js";
import { parseEmiratesId } from "./idFetch.js";
import { AppError } from "../../shared/errors.js";

const TRAINERS = ["trainer1"];
const ENGINEERS = ["eng1", "eng2"];

function svc() {
  return new TrainingService(
    new DocumentCodes(),
    (id) => TRAINERS.includes(id),
    (id) => ENGINEERS.includes(id)
  );
}

function jobInput(over: Partial<CreateTrainingInput> = {}): CreateTrainingInput {
  return {
    course: "Working at Height",
    customerName: "BCC Building Contracting L.L.C",
    trainingDate: "2026-09-10",
    address: "Jebel Ali, Dubai",
    mode: "Onsite",
    createdById: "sales1",
    ...over,
  };
}

describe("job order numbers", () => {
  it("increments automatically for training jobs", () => {
    const s = svc();
    const a = s.createJob(jobInput());
    const b = s.createJob(jobInput());
    expect(a.jobOrderNo).toBe("TR 4500");
    expect(b.jobOrderNo).toBe("TR 4501");
    expect(s.peekNextJobOrderNo("Training")).toBe("TR 4502");
  });

  it("uses a separate incrementing sequence for other services", () => {
    const s = svc();
    const items = [{ sn: 1, description: "PG-101", qty: "1", remarks: "" }];
    const a = s.createJob(jobInput({ serviceType: "Testing", course: "Gauges", lineItems: items }));
    const b = s.createJob(jobInput({ serviceType: "Calibration", course: "Gauges", lineItems: items }));
    expect(a.jobOrderNo).toBe("JO 120");
    expect(b.jobOrderNo).toBe("JO 121");
  });

  it("stores several training courses on one job", () => {
    const s = svc();
    const job = s.createJob(jobInput({
      courses: ["Working at Height", "Basic Fire Fighting", "First Aid / CPR"],
    }));
    expect(job.course).toBe("Working at Height · Basic Fire Fighting · First Aid / CPR");
  });

  it("stores several companies on one job", () => {
    const s = svc();
    const job = s.createJob(jobInput({
      customerName: "DC SERVE EQUIPMENT TRADING L.L.C",
      companies: ["SPX Cooling Technologies Trading", "BCC Building Contracting L.L.C"],
    }));
    expect(job.customerName).toBe("DC SERVE EQUIPMENT TRADING L.L.C");
    expect(job.companies).toEqual([
      "DC SERVE EQUIPMENT TRADING L.L.C",
      "SPX Cooling Technologies Trading",
      "BCC Building Contracting L.L.C",
    ]);
  });
});

describe("assigning jobs to trainers and site engineers", () => {
  it("assigns to a site engineer and moves the job to Assigned", () => {
    const s = svc();
    const job = s.createJob(jobInput());
    const assigned = s.assignJob(job.id, "eng1", "Site Engineer One");

    expect(assigned.assignedToId).toBe("eng1");
    expect(assigned.assigneeRole).toBe("Site Engineer");
    expect(assigned.assigneeName).toBe("Site Engineer One");
    expect(assigned.status).toBe("Assigned");
  });

  it("still assigns to a trainer, tagged with the Trainer role", () => {
    const s = svc();
    const job = s.createJob(jobInput());
    const assigned = s.assignJob(job.id, "trainer1", "Trainer One");

    expect(assigned.assigneeRole).toBe("Trainer");
    // the printed Work Permit reads trainerName, so it must be filled either way
    expect(assigned.trainerName).toBe("Trainer One");
  });

  it("refuses anyone who is neither a trainer nor a site engineer", () => {
    const s = svc();
    const job = s.createJob(jobInput());
    expect(() => s.assignJob(job.id, "sales1", "Sales Person")).toThrowError(AppError);
  });

  it("shows each assignee only their own jobs", () => {
    const s = svc();
    const a = s.createJob(jobInput({ course: "Confined Space" }));
    const b = s.createJob(jobInput({ course: "Fire Warden" }));
    const c = s.createJob(jobInput({ course: "Unassigned" }));

    s.assignJob(a.id, "eng1", "Site Engineer One");
    s.assignJob(b.id, "eng2", "Site Engineer Two");

    expect(s.listForAssignee("eng1").map((j) => j.course)).toEqual(["Confined Space"]);
    expect(s.listForAssignee("eng2").map((j) => j.course)).toEqual(["Fire Warden"]);
    // the unassigned job belongs to nobody's list
    expect(s.listForAssignee("eng1").some((j) => j.id === c.id)).toBe(false);
  });

  it("notifies the assignee, and nobody else", () => {
    const s = svc();
    const job = s.createJob(jobInput());
    s.assignJob(job.id, "eng1", "Site Engineer One");

    const mine = s.getNotifications("eng1");
    expect(mine.length).toBe(1);
    expect(mine[0].jobId).toBe(job.id);
    expect(s.getNotifications("eng2").length).toBe(0);
    expect(s.getNotifications("trainer1").length).toBe(0);
  });
});

describe("capturing a trainee from an ID card", () => {
  function assignedJob() {
    const s = svc();
    const job = s.createJob(jobInput());
    s.assignJob(job.id, "eng1", "Site Engineer One");
    return { s, job };
  }

  it("stores date of birth, photo, ID image and signature", () => {
    const { s, job } = assignedJob();
    const att = s.addAttendeeFromId(job.id, {
      name: "Haroon Ur Rasheed",
      company: "BCC",
      idOrVisaNo: "784-1990-1234567-1",
      nationality: "Pakistan",
      mobileNumber: "971566654326",
      dateOfBirth: "1990-09-05",
      idCardDataUrl: "data:image/jpeg;base64,AAAA",
      photoDataUrl: "data:image/jpeg;base64,BBBB",
      signature: "data:image/png;base64,CCCC",
      autoFetched: true,
    });

    expect(att.dateOfBirth).toBe("1990-09-05");
    expect(att.photoDataUrl).toBe("data:image/jpeg;base64,BBBB");
    expect(att.signature).toBe("data:image/png;base64,CCCC");
    expect(att.signedAt).toBeInstanceOf(Date);
  });

  it("rejects a date of birth that is not yyyy-mm-dd", () => {
    const { s, job } = assignedJob();
    expect(() =>
      s.addAttendeeFromId(job.id, {
        name: "Test Person",
        company: "BCC",
        idOrVisaNo: "784-1990-1234567-1",
        nationality: "Pakistan",
        mobileNumber: "971566654326",
        dateOfBirth: "05/09/1990",
      })
    ).toThrowError(AppError);
  });

  it("leaves signedAt unset when nobody signed", () => {
    const { s, job } = assignedJob();
    const att = s.addAttendeeFromId(job.id, {
      name: "Unsigned Person",
      company: "BCC",
      idOrVisaNo: "784-1990-7654321-1",
      nationality: "India",
      mobileNumber: "971501234567",
    });
    expect(att.signature).toBeUndefined();
    expect(att.signedAt).toBeUndefined();
  });

  it("moves the job to In Progress on the first trainee", () => {
    const { s, job } = assignedJob();
    expect(s.getJob(job.id).status).toBe("Assigned");
    s.addAttendeeFromId(job.id, {
      name: "First Trainee",
      company: "BCC",
      idOrVisaNo: "784-1990-1111111-1",
      nationality: "Nepal",
      mobileNumber: "971509876543",
    });
    expect(s.getJob(job.id).status).toBe("In Progress");
  });
});

describe("reading an Emirates ID", () => {
  it("pulls out name, ID number, nationality and date of birth", () => {
    const parsed = parseEmiratesId(
      [
        "Name: HAROON UR RASHEED",
        "ID Number: 784-1990-1234567-1",
        "Date of Birth: 05/09/1990",
        "Nationality: Pakistan",
        "+971 56 665 4326",
      ].join("\n")
    );

    expect(parsed.name).toBe("HAROON UR RASHEED");
    expect(parsed.idOrVisaNo).toBe("784-1990-1234567-1");
    expect(parsed.nationality).toBe("Pakistan");
    expect(parsed.dateOfBirth).toBe("1990-09-05");
    expect(parsed.mobileNumber).toBe("971566654326");
    expect(parsed.confidence).toBe(1);
  });

  it("normalises the date formats printed on cards", () => {
    expect(parseEmiratesId("DOB: 5/9/1990").dateOfBirth).toBe("1990-09-05");
    expect(parseEmiratesId("Date of Birth: 05-09-1990").dateOfBirth).toBe("1990-09-05");
    expect(parseEmiratesId("Date of Birth: 1990-09-05").dateOfBirth).toBe("1990-09-05");
  });

  it("does not mistake the date of birth for a phone number", () => {
    const parsed = parseEmiratesId("Name: TEST USER\nDate of Birth: 05/09/1990");
    expect(parsed.dateOfBirth).toBe("1990-09-05");
    expect(parsed.mobileNumber).toBe("");
  });

  it("reports low confidence on unreadable text instead of inventing fields", () => {
    const parsed = parseEmiratesId("blurred smudge");
    expect(parsed.name).toBe("");
    expect(parsed.idOrVisaNo).toBe("");
    expect(parsed.dateOfBirth).toBe("");
    expect(parsed.confidence).toBe(0);
  });

  it("reads the ID number from the lower strip even when OCR drops the hyphens", () => {
    expect(parseEmiratesId("ID Number\n784 1995 1234567 1").idOrVisaNo).toBe("784-1995-1234567-1");
    expect(parseEmiratesId("784199512345671").idOrVisaNo).toBe("784-1995-1234567-1");
    expect(parseEmiratesId("IDARE784199512345671<<<<<<<<<<<<<<<").idOrVisaNo).toBe("784-1995-1234567-1");
    expect(parseEmiratesId("784-1995\n1234567-1").idOrVisaNo).toBe("784-1995-1234567-1");
  });
});

describe("calibration / testing jobs", () => {
  function fieldJob() {
    const s = svc();
    const job = s.createJob(jobInput({
      serviceType: "Testing",
      course: "Pressure gauge testing",
      lineItems: [
        { sn: 1, description: "PG-101", qty: "1", remarks: "" },
        { sn: 2, description: "PG-102", qty: "1", remarks: "" },
      ],
    }));
    s.assignJob(job.id, "eng1", "Site Engineer One");
    return { s, job };
  }

  it("requires at least one line item for a testing job", () => {
    const s = svc();
    expect(() => s.createJob(jobInput({ serviceType: "Calibration", course: "Gauges" }))).toThrowError(AppError);
  });

  it("records Pass/Fail per item and submits to admin for certificates", async () => {
    const { s, job } = fieldJob();
    s.recordItemResult(job.id, { sn: 1, reading: "101.3", result: "Pass" });
    expect(s.getJob(job.id).status).toBe("In Progress");
    expect(() => s.submitForApproval(job.id)).toThrowError(AppError);
    s.recordItemResult(job.id, { sn: 2, reading: "99.8", result: "Fail", remarks: "out of spec" });
    s.submitForApproval(job.id);
    const approved = await s.approve(job.id, "admin");
    expect(approved.status).toBe("Approved");
    expect(approved.certificates).toHaveLength(2);
    expect(approved.certificates[0].name).toBe("PG-101");
    expect(approved.certificates[1].course).toContain("Fail");
  });
});

describe("trainer attendance sheet workflow", () => {
  function tinyPng() {
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  }

  it("lets the trainer set trainee count, sign, verify, then submit", () => {
    const s = svc();
    const job = s.createJob(jobInput());
    s.assignJob(job.id, "trainer1", "Trainer One");
    expect(() => s.submitForApproval(job.id)).toThrowError(AppError);
    s.saveAttendanceMeta(job.id, {
      expectedTraineeCount: 1,
      trainerSignature: tinyPng(),
      trainerVerified: true,
      authorizedBy: "Trainer One",
    });
    expect(() => s.submitForApproval(job.id)).toThrowError(AppError);
    s.addAttendeeFromId(job.id, {
      name: "HAROON UR RASHEED",
      company: "BCC Building Contracting L.L.C",
      mobileNumber: "0566654326",
      idOrVisaNo: "784-1990-1234567-1",
      nationality: "Pakistan",
      autoFetched: true,
      signature: tinyPng(),
    });
    const submitted = s.submitForApproval(job.id);
    expect(submitted.status).toBe("Submitted");
    expect(submitted.expectedTraineeCount).toBe(1);
    expect(submitted.trainerVerified).toBe(true);
    expect(submitted.authorizedBy).toBe("Trainer One");
  });

  it("reopens a submitted sheet when the trainer replaces an unclear photo", () => {
    const s = svc();
    const job = s.createJob(jobInput());
    s.assignJob(job.id, "trainer1", "Trainer One");
    s.saveAttendanceMeta(job.id, {
      expectedTraineeCount: 1,
      trainerSignature: tinyPng(),
      trainerVerified: true,
      authorizedBy: "Trainer One",
    });
    const att = s.addAttendeeFromId(job.id, {
      name: "HAROON UR RASHEED",
      company: "BCC Building Contracting L.L.C",
      idOrVisaNo: "784-1990-1234567-1",
      nationality: "Pakistan",
      mobileNumber: "0566654326",
      autoFetched: true,
      signature: tinyPng(),
    });
    s.submitForApproval(job.id);
    const updated = s.updateAttendee(job.id, att.id, { extraPhotoDataUrl: tinyPng(), photoDataUrl: tinyPng() });
    expect(updated.extraPhotoDataUrl).toBe(tinyPng());
    expect(s.getJob(job.id).status).toBe("In Progress");
  });

  it("auto-generates a trainee link so they upload EID and sign themselves", () => {
    const s = svc();
    const job = s.createJob(jobInput());
    s.assignJob(job.id, "trainer1", "Trainer One");
    expect(job.traineeInviteToken).toBeTruthy();
    expect(s.publicJoinInfo(job.traineeInviteToken!).open).toBe(true);
    s.saveAttendanceMeta(job.id, { expectedTraineeCount: 2 });
    expect(s.publicJoinInfo(job.traineeInviteToken!).remaining).toBe(2);
    const joined = s.joinViaTraineeLink(job.traineeInviteToken!, {
      name: "HAROON UR RASHEED",
      company: "BCC Building Contracting L.L.C",
      idOrVisaNo: "784-1990-1234567-1",
      nationality: "Pakistan",
      mobileNumber: "0566654326",
      autoFetched: true,
      signature: tinyPng(),
    });
    expect(joined.editToken).toBeTruthy();
    expect(joined.course).toBe("Working at Height");
    expect(s.publicJoinInfo(job.traineeInviteToken!).remaining).toBe(1);
    const again = s.updateAttendeeByEditToken(job.traineeInviteToken!, joined.editToken!, { extraPhotoDataUrl: tinyPng() });
    expect(again.extraPhotoDataUrl).toBe(tinyPng());
  });

  it("puts name and phone on the list first, then photo and signature fill that row", () => {
    const s = svc();
    const job = s.createJob(jobInput());
    s.assignJob(job.id, "trainer1", "Trainer One");
    s.saveAttendanceMeta(job.id, { expectedTraineeCount: 1 });
    const reserved = s.addAttendeeFromId(job.id, {
      name: "Rohan Shinde",
      company: "ABC Contracting LLC",
      mobileNumber: "0501234567",
      idOrVisaNo: "",
      nationality: "",
      autoFetched: false,
    });
    const slot = s.publicSlotInfo(job.traineeInviteToken!, reserved.editToken!);
    expect(slot.name).toBe("Rohan Shinde");
    expect(slot.hasPhoto).toBe(false);
    expect(slot.hasSignature).toBe(false);
    s.updateAttendeeByEditToken(job.traineeInviteToken!, reserved.editToken!, {
      photoDataUrl: tinyPng(),
      signature: tinyPng(),
      idOrVisaNo: "784-2006-5674134-3",
    });
    const filled = s.getJob(job.id).attendees[0];
    expect(filled.photoDataUrl).toBe(tinyPng());
    expect(filled.signature).toBe(tinyPng());
    expect(filled.name).toBe("Rohan Shinde");
    expect(filled.mobileNumber).toBe("0501234567");
  });

  it("allows different companies and the same person on a second course", () => {
    const s = svc();
    const job = s.createJob(jobInput({
      courses: ["Working at Height", "Basic Fire Fighting"],
    }));
    s.assignJob(job.id, "trainer1", "Trainer One");
    s.saveAttendanceMeta(job.id, { expectedTraineeCount: 3 });
    s.addAttendeeFromId(job.id, {
      name: "Rohan Shinde",
      company: "DC SERVE EQUIPMENT TRADING L.L.C",
      mobileNumber: "0501111111",
      idOrVisaNo: "",
      nationality: "",
      course: "Working at Height",
      autoFetched: false,
    });
    s.addAttendeeFromId(job.id, {
      name: "Prenston Mariadass",
      company: "SPX Cooling Technologies Trading",
      mobileNumber: "0502222222",
      idOrVisaNo: "",
      nationality: "",
      course: "Working at Height",
      autoFetched: false,
    });
    expect(() => s.addAttendeeFromId(job.id, {
      name: "Rohan Shinde",
      company: "DC SERVE EQUIPMENT TRADING L.L.C",
      mobileNumber: "0501111111",
      idOrVisaNo: "",
      nationality: "",
      course: "Working at Height",
      autoFetched: false,
    })).toThrowError(AppError);
    const second = s.addAttendeeFromId(job.id, {
      name: "Rohan Shinde",
      company: "DC SERVE EQUIPMENT TRADING L.L.C",
      mobileNumber: "0501111111",
      idOrVisaNo: "",
      nationality: "",
      course: "Basic Fire Fighting",
      autoFetched: false,
    });
    expect(second.course).toBe("Basic Fire Fighting");
  });

  it("does not treat a different person as already on the course because they share a phone", () => {
    const s = svc();
    const job = s.createJob(jobInput({
      courses: ["Accident and Incident Investigation", "Air Receiver / Compressor Inspector"],
    }));
    s.assignJob(job.id, "trainer1", "Trainer One");
    s.addAttendeeFromId(job.id, {
      name: "Juby John",
      company: "Westcal",
      mobileNumber: "4354323",
      idOrVisaNo: "",
      nationality: "",
      course: "Accident and Incident Investigation",
      autoFetched: false,
    });
    const other = s.addAttendeeFromId(job.id, {
      name: "Alex Kumar",
      company: "abc",
      mobileNumber: "4354323",
      idOrVisaNo: "",
      nationality: "",
      course: "Air Receiver / Compressor Inspector",
      autoFetched: false,
    });
    expect(other.course).toBe("Air Receiver / Compressor Inspector");
    expect(job.attendees).toHaveLength(2);
  });

  it("adds one attendance row per selected course for the same person", () => {
    const s = svc();
    const job = s.createJob(jobInput({
      courses: ["Working at Height", "Basic Fire Fighting", "First Aid / CPR"],
    }));
    s.assignJob(job.id, "trainer1", "Trainer One");
    s.saveAttendanceMeta(job.id, { expectedTraineeCount: 1 });
    s.addAttendeeFromId(job.id, {
      name: "Rohan Shinde",
      company: "DC SERVE EQUIPMENT TRADING L.L.C",
      mobileNumber: "0501111111",
      idOrVisaNo: "",
      nationality: "",
      courses: ["Working at Height", "First Aid / CPR"],
      autoFetched: false,
    });
    expect(job.attendees).toHaveLength(2);
    expect(job.attendees.map((a) => a.course)).toEqual(["Working at Height", "First Aid / CPR"]);
    expect(job.expectedTraineeCount).toBe(2);
  });

  it("prints one certificate per trainee with that trainee's course and company", async () => {
    const s = svc();
    const job = s.createJob(jobInput({
      courses: ["Working at Height", "Basic Fire Fighting"],
    }));
    s.assignJob(job.id, "trainer1", "Trainer One");
    s.saveAttendanceMeta(job.id, {
      expectedTraineeCount: 2,
      trainerSignature: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      trainerVerified: true,
      authorizedBy: "Trainer One",
    });
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    s.addAttendeeFromId(job.id, {
      name: "Rohan Shinde",
      company: "DC SERVE EQUIPMENT TRADING L.L.C",
      mobileNumber: "0501111111",
      idOrVisaNo: "",
      nationality: "",
      course: "Working at Height",
      signature: png,
      autoFetched: false,
    });
    s.addAttendeeFromId(job.id, {
      name: "Prenston Mariadass",
      company: "SPX Cooling Technologies Trading",
      mobileNumber: "0502222222",
      idOrVisaNo: "",
      nationality: "",
      course: "Basic Fire Fighting",
      signature: png,
      autoFetched: false,
    });
    s.submitForApproval(job.id);
    const approved = await s.approve(job.id, "admin");
    expect(approved.certificates).toHaveLength(2);
    expect(approved.certificates[0]).toMatchObject({
      name: "Rohan Shinde",
      company: "DC SERVE EQUIPMENT TRADING L.L.C",
      course: "Working at Height",
    });
    expect(approved.certificates[1]).toMatchObject({
      name: "Prenston Mariadass",
      company: "SPX Cooling Technologies Trading",
      course: "Basic Fire Fighting",
    });
    expect(approved.certificates.every((c) => !c.course.includes(" · "))).toBe(true);
  });

  it("lets admin correct an issued certificate including the training date", async () => {
    const s = svc();
    const job = s.createJob(jobInput({ trainingDate: "2026-09-22", trainingDateTo: "2026-09-22" }));
    s.assignJob(job.id, "trainer1", "Trainer One");
    s.saveAttendanceMeta(job.id, {
      expectedTraineeCount: 1,
      trainerSignature: tinyPng(),
      trainerVerified: true,
      authorizedBy: "Trainer One",
    });
    s.addAttendeeFromId(job.id, {
      name: "Rohan Shinde",
      company: "BCC Building Contracting L.L.C",
      mobileNumber: "0501111111",
      idOrVisaNo: "784-1990-1234567-1",
      nationality: "",
      signature: tinyPng(),
      autoFetched: false,
    });
    s.submitForApproval(job.id);
    const approved = await s.approve(job.id, "admin");
    const moved = s.editJob(job.id, {
      trainingDate: "2026-10-01",
      trainingDateTo: "2026-10-01",
      certificateUnder: "Corrected Company LLC",
    });
    expect(moved.status).toBe("Approved");
    expect(moved.certificates[0].trainingDate).toBe("2026-10-01");
    expect(moved.certificates[0].company).toBe("Corrected Company LLC");
    const cert = s.editCertificate(job.id, approved.certificates[0].id, {
      name: "Rohan K Shinde",
      trainingDate: "2026-09-15",
      idOrVisaNo: "784-1990-1234567-1",
    });
    expect(cert.name).toBe("Rohan K Shinde");
    expect(cert.trainingDate).toBe("2026-09-15");
    expect(cert.expiresOn).toBe("2027-09-14");
    expect(s.getJob(job.id).status).toBe("Approved");
  });
});

describe("cancelling a job", () => {
  it("requires a reason and shows it on the job for admin", () => {
    const s = svc();
    const job = s.createJob(jobInput());
    s.assignJob(job.id, "trainer1", "Trainer One");
    const cancelled = s.cancelJob(job.id, "Customer postponed the training", "Sales Person");
    expect(cancelled.status).toBe("Cancelled");
    expect(cancelled.cancelledReason).toBe("Customer postponed the training");
    expect(cancelled.cancelledBy).toBe("Sales Person");
    expect(s.listJobs()[0].cancelledReason).toBe("Customer postponed the training");
  });

  it("rejects an empty cancel reason", () => {
    const s = svc();
    const job = s.createJob(jobInput());
    expect(() => s.cancelJob(job.id, "  ", "Sales Person")).toThrow(/reason/i);
  });
});

describe("certified by on the job", () => {
  it("copies the invoiced company onto certified by unless another company is entered", () => {
    const s = svc();
    const same = s.createJob(jobInput());
    expect(same.certificateUnder).toBe("BCC Building Contracting L.L.C");
    const other = s.createJob(jobInput({ certifiedBy: "Site Client Industries LLC" }));
    expect(other.customerName).toBe("BCC Building Contracting L.L.C");
    expect(other.certificateUnder).toBe("Site Client Industries LLC");
    const edited = s.editJob(other.id, { certificateUnder: "Another Certified Co LLC" });
    expect(edited.certificateUnder).toBe("Another Certified Co LLC");
    const moved = s.editJob(other.id, { location: "Off-site", address: "Lab, Dubai" });
    expect(moved.location).toBe("Off-site");
    expect(moved.address).toBe("Lab, Dubai");
  });

  it("lets the trainer edit certified by and the training dates on the attendance sheet", () => {
    const s = svc();
    const job = s.createJob(jobInput());
    s.assignJob(job.id, "trainer1", "Trainer One");
    const updated = s.saveAttendanceMeta(job.id, {
      certifiedBy: "Client Safety LLC",
      trainingDate: "2026-09-18",
      trainingDateTo: "2026-09-19",
      trainingTime: "09:16",
    });
    expect(updated.certificateUnder).toBe("Client Safety LLC");
    expect(updated.trainingDate).toBe("2026-09-18");
    expect(updated.trainingDateTo).toBe("2026-09-19");
    expect(updated.trainingTime).toBe("09:16");
    expect(() => s.saveAttendanceMeta(job.id, { certifiedBy: "  " })).toThrow(/certified to/i);
  });
});

describe("training date from and to", () => {
  it("stores a date range and rejects a to-date before from", () => {
    const s = svc();
    const job = s.createJob(jobInput({ trainingDate: "2026-09-10", trainingDateTo: "2026-09-12" }));
    expect(job.trainingDate).toBe("2026-09-10");
    expect(job.trainingDateTo).toBe("2026-09-12");
    expect(() => s.createJob(jobInput({ trainingDate: "2026-09-12", trainingDateTo: "2026-09-10" }))).toThrow(/date to/i);
  });
});
