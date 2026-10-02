import { useState, type ChangeEvent } from "react";
import { api, hasValidToken } from "../../api";
import { useApp, usePageData } from "../../app-context";
import { Modal } from "../../components/Modal";
import { PageLoading } from "../../components/PageLoading";
import { courseDescription, courseNames, jobCompanyNames, jobCourses } from "../../lib/jobs";
import type { Assignee } from "../../lib/roles";
import type { Course, Job } from "../../types";
import { MappingFormModal } from "./MappingFormModal";

interface FormProps {
  service: string;
  editId?: string;
  onClose: () => void;
  onSaved: () => void;
}

interface JobFormLoaded {
  courses: Course[];
  assignees: Assignee[];
  nextOrder: string;
  editing: Job | null;
}

interface LineItem {
  key: number;
  description: string;
  qty: string;
  remarks: string;
  fromCourse: boolean;
}

let lineSeq = 0;
const newLine = (patch: Partial<LineItem> = {}): LineItem => ({
  key: ++lineSeq,
  description: "",
  qty: "",
  remarks: "",
  fromCourse: false,
  ...patch,
});

export function JobFormModal(props: FormProps) {
  return props.service === "Mapping" ? <MappingFormModal {...props} /> : <ServiceJobFormModal {...props} />;
}

const EMPTY_LOADED: JobFormLoaded = { courses: [], assignees: [], nextOrder: "", editing: null };

function ServiceJobFormModal({ service, editId, onClose, onSaved }: FormProps) {
  const { setCourses } = useApp();
  const { loading, data } = usePageData<JobFormLoaded>(async () => {
    try {
      if (!hasValidToken()) {
        window.location.reload();
        throw new Error("Authentication required");
      }
      const assignees = await api<Assignee[]>("GET", "/api/assignees").catch(() => [] as Assignee[]);
      const [courses, nextOrder, jobs] = await Promise.all([
        api<Course[]>("GET", "/api/courses").catch(() => [] as Course[]),
        editId
          ? Promise.resolve("")
          : api("GET", `/api/training/next-job-order?serviceType=${encodeURIComponent(service)}`)
              .then((r) => r.jobOrderNo as string)
              .catch(() => ""),
        editId ? api<Job[]>("GET", "/api/training") : Promise.resolve([] as Job[]),
      ]);
      setCourses(courses);
      return { courses, assignees: assignees || [], nextOrder, editing: jobs.find((j) => j.id === editId) || null };
    } catch {
      return EMPTY_LOADED;
    }
  });
  const training = service === "Training";
  return (
    <Modal
      title={`${editId ? "Edit" : "Add"} ${service} job`}
      subtitle={
        editId
          ? "Change the details, then save. Job number stays the same."
          : training
            ? "Four short steps: company, when, who, courses."
            : "Customer, when, engineer, then equipment."
      }
      onClose={onClose}
    >
      <div className="steps">
        <span>1 Company</span>
        <span>2 When & where</span>
        <span>3 Who</span>
        <span>4 {training ? "Courses" : "Scope"}</span>
      </div>
      {loading || !data ? <PageLoading /> : <ServiceJobForm service={service} editId={editId} loaded={data} onSaved={onSaved} />}
    </Modal>
  );
}

function ServiceJobForm({ service, editId, loaded, onSaved }: { service: string; editId?: string; loaded: JobFormLoaded; onSaved: () => void }) {
  const { setCourses } = useApp();
  const training = service === "Training";
  const job = loaded.editing;
  const [courses, setLocalCourses] = useState(loaded.courses);
  const [companies, setCompanies] = useState<string[]>(job ? jobCompanyNames(job) : []);
  const [companyDraft, setCompanyDraft] = useState("");
  const [certifiedTo, setCertifiedTo] = useState((job && (job.certificateUnder || job.customerName)) || "");
  const [certifiedEdited, setCertifiedEdited] = useState(!!(job && job.certificateUnder && job.certificateUnder !== job.customerName));
  const [f, setF] = useState({
    customer: job?.customerName || "",
    addr: job?.address || "",
    location: job?.location || "On-site",
    time: job?.trainingTime || "",
    dateFrom: job?.trainingDate || "",
    dateTo: job?.trainingDateTo || job?.trainingDate || "",
    order: job ? job.jobOrderNo || "" : loaded.nextOrder,
    sales: job?.salesPerson || "",
    handed: job?.handedOverTo || "",
    contact: job?.contactNameNumber || "",
    assignee: job?.assigneeId || "",
    scope: (job && !training && job.course) || "",
    req: job?.clientRequirements || "",
  });
  const [description, setDescription] = useState({ value: "", fromCourse: true });
  const [picked, setPicked] = useState<string[]>(job && training ? jobCourses(job) : []);
  const [courseSearch, setCourseSearch] = useState("");
  const [newCourse, setNewCourse] = useState("");
  const [courseMsg, setCourseMsg] = useState({ text: "", ok: false });
  const [lines, setLines] = useState<LineItem[]>(() =>
    job
      ? ((job.lineItems || []) as any[]).map((l) =>
          newLine({ description: l.description || "", qty: l.qty || "", remarks: l.remarks || "", fromCourse: true }),
        )
      : training
        ? []
        : [newLine()],
  );
  const [codeTraining, setCodeTraining] = useState(job ? job.workCodeTraining !== false : training);
  const [codeCertification, setCodeCertification] = useState(job ? !!job.workCodeCertification : !training);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const bind = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });
  const people = loaded.assignees.filter((a) => a.roleName === (training ? "Trainer" : "Site Engineer"));
  const allCourses = courseNames(courses);

  function syncCertifiedTo(list: string[]) {
    const first = list[0] || "";
    if (!certifiedEdited || !certifiedTo.trim()) {
      setCertifiedTo(first);
      setCertifiedEdited(false);
    }
  }
  function addCompany() {
    const name = companyDraft.trim();
    if (!name) return;
    const next = companies.some((c) => c.toLowerCase() === name.toLowerCase()) ? companies : [...companies, name];
    setCompanies(next);
    setCompanyDraft("");
    syncCertifiedTo(next);
  }
  function removeCompany(index: number) {
    const next = companies.filter((_, i) => i !== index);
    setCompanies(next);
    syncCertifiedTo(next);
  }
  function pickCourses(next: string[], list: Course[] = courses) {
    setPicked(next);
    const text = next.map((c) => courseDescription(list, c)).join("\n");
    if (!description.value || description.fromCourse) setDescription({ value: text, fromCourse: true });
    const typed = lines.filter((l) => l.description && !l.fromCourse);
    setLines([...next.map((c) => newLine({ description: courseDescription(list, c), qty: "1", fromCourse: true })), ...typed]);
  }
  function toggleCourse(name: string) {
    pickCourses(picked.includes(name) ? picked.filter((c) => c !== name) : [...picked, name]);
  }
  async function addCourse() {
    setCourseMsg({ text: "", ok: false });
    const name = newCourse.trim();
    if (!name) {
      setCourseMsg({ text: "Type the new course name first.", ok: false });
      return;
    }
    try {
      await api("POST", "/api/courses", { name });
      const list = await api<Course[]>("GET", "/api/courses");
      setLocalCourses(list);
      setCourses(list);
      pickCourses([...picked, name], list);
      setNewCourse("");
      setCourseMsg({ text: "Course added and selected.", ok: true });
    } catch (e) {
      setCourseMsg({ text: (e as Error).message, ok: false });
    }
  }
  const setLine = (key: number, patch: Partial<LineItem>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const lineItems = () =>
    lines.map((l, i) => ({ sn: i + 1, description: l.description, qty: l.qty, remarks: l.remarks })).filter((l) => l.description);

  async function save() {
    setErr("");
    const customer = training ? companies[0] || "" : f.customer.trim();
    const course = training ? picked.join(" · ") : f.scope.trim();
    const address = f.addr.trim();
    const assignee = f.assignee;
    if (!customer)
      return setErr(
        training ? (editId ? "Add at least one company." : "Add at least one company, then create the job.") : "Customer name is required.",
      );
    if (!address)
      return setErr(editId ? "Site address is required." : "Site address is required so the trainer/engineer can find the location.");
    if (!f.dateFrom) return setErr("Date from is required.");
    if (!f.dateTo) return setErr("Date to is required.");
    if (f.dateTo < f.dateFrom) return setErr("Date to cannot be before date from.");
    if (!f.time) return setErr("Start time is required.");
    if (!f.contact.trim()) return setErr("Contact name / number is required.");
    if (!course)
      return setErr(
        training
          ? editId
            ? "Tick at least one course."
            : "Tick at least one course, or add a new one under the list."
          : "Please type the scope of work.",
      );
    if (!editId && !assignee)
      return setErr(training ? "Assign a trainer. Add one under Add trainers if the list is empty." : "Assign a site engineer.");
    if (training && !certifiedTo.trim()) return setErr("Certified to is required. It is the name printed on the certificate.");
    if (!editId && !training && lineItems().length < 1)
      return setErr("Add at least one equipment line item (description), then create the job.");
    const body = {
      location: f.location,
      course,
      courses: training ? picked : undefined,
      customerName: customer,
      companies: training ? companies.slice() : undefined,
      certificateUnder: training ? certifiedTo.trim() : undefined,
      address,
      contactNameNumber: f.contact.trim(),
      trainingDate: f.dateFrom,
      trainingDateTo: f.dateTo,
      trainingTime: f.time,
      salesPerson: f.sales.trim(),
      clientRequirements: f.req.trim() || description.value.trim(),
      handedOverTo: f.handed.trim(),
      workCodeTraining: codeTraining,
      workCodeCertification: codeCertification,
      lineItems: lineItems(),
    };
    setBusy(true);
    try {
      let id = editId;
      if (editId) await api("PATCH", `/api/training/${editId}`, body);
      else id = (await api<Job>("POST", "/api/training", { serviceType: service, ...body })).id;
      if (assignee) await api("POST", `/api/training/${id}/assign`, { assigneeId: assignee });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  const printedName = certifiedTo.trim() || companies[0] || "";
  const descPlaceholder = training ? "Filled from the selected course" : "e.g. Pressure gauge PG-1";

  return (
    <div className="job-form">
      {training ? (
        <div className="job-block">
          <h4>1 · Company</h4>
          <div className="job-row">
            <div className="span-4">
              <label>Companies *</label>
              <div className="add-row">
                <input
                  value={companyDraft}
                  placeholder="Type a company name"
                  autoComplete="off"
                  onChange={(e) => setCompanyDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCompany();
                    }
                  }}
                />
                <button type="button" className="btn sec" onClick={addCompany}>
                  Add company
                </button>
              </div>
              <div className="course-picks">
                {companies.length ? (
                  companies.map((c, i) => (
                    <span key={c} className="chip">
                      {c}
                      {i === 0 ? " (booking customer)" : ""}{" "}
                      <button type="button" className="btn ghost sm" onClick={() => removeCompany(i)}>
                        ×
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="muted">No companies yet. Type a name and click Add company.</span>
                )}
              </div>
              <label style={{ marginTop: 16 }}>Certified to (name on certificate) *</label>
              <input
                value={certifiedTo}
                autoComplete="off"
                placeholder="Filled from the company — edit if needed"
                onChange={(e) => {
                  const v = e.target.value.trim();
                  setCertifiedTo(e.target.value);
                  setCertifiedEdited(!!v && v !== (companies[0] || ""));
                }}
              />
              <p className="hint" style={{ margin: "8px 0 0" }}>
                {printedName ? (
                  <>
                    Certificate will print: <b>{printedName}</b> — you can edit this.
                  </>
                ) : (
                  "Add a company first. The same name appears here and is printed on the certificate. You can edit it."
                )}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="job-block">
          <h4>1 · Customer</h4>
          <div className="job-row">
            <div className="span-2">
              <label>Customer name *</label>
              <input value={f.customer} placeholder="Company name" onChange={bind("customer")} />
            </div>
          </div>
        </div>
      )}
      <div className="job-block">
        <h4>2 · When and where</h4>
        <div className="job-row">
          <div className="span-2">
            <label>Site address *</label>
            <input value={f.addr} placeholder="Building, area, city" onChange={bind("addr")} />
          </div>
          <div>
            <label>Location *</label>
            <select value={f.location} onChange={bind("location")}>
              <option>On-site</option>
              <option>Off-site</option>
            </select>
          </div>
          <div>
            <label>Start time *</label>
            <input type="time" value={f.time} onChange={bind("time")} />
          </div>
          <div>
            <label>Date from *</label>
            <input type="date" value={f.dateFrom} onChange={bind("dateFrom")} />
          </div>
          <div>
            <label>Date to *</label>
            <input type="date" value={f.dateTo} onChange={bind("dateTo")} />
          </div>
        </div>
      </div>
      <div className="job-block">
        <h4>3 · Who</h4>
        <div className="job-row">
          <div>
            <label>Job order no</label>
            <input value={f.order} readOnly />
          </div>
          <div>
            <label>Sales person</label>
            <input value={f.sales} placeholder="Name" onChange={bind("sales")} />
          </div>
          <div>
            <label>Handed over to</label>
            <input value={f.handed} placeholder="Name" onChange={bind("handed")} />
          </div>
          <div>
            <label>Contact *</label>
            <input value={f.contact} placeholder="Name and mobile" onChange={bind("contact")} />
          </div>
          <div className="span-2">
            <label>Assign {training ? "trainer" : "site engineer"} *</label>
            <select value={f.assignee} onChange={bind("assignee")}>
              <option value="">{training ? "Choose trainer *" : "Choose site engineer *"}</option>
              {people.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName} — {a.roleName}
                </option>
              ))}
            </select>
            {people.length === 0 && <div className="muted">No {training ? "trainers" : "site engineers"} added yet.</div>}
          </div>
        </div>
      </div>
      <div className="job-block">
        <h4>4 · {training ? "Courses" : "Scope"}</h4>
        {training ? (
          <div>
            <label>Courses *</label>
            <input value={courseSearch} placeholder="Search courses" onChange={(e) => setCourseSearch(e.target.value)} />
            {allCourses.length ? (
              <div>
                <div className="course-box">
                  {allCourses
                    .filter((c) => !courseSearch || c.toLowerCase().includes(courseSearch.toLowerCase()))
                    .map((c) => (
                      <label key={c}>
                        <input type="checkbox" checked={picked.includes(c)} onChange={() => toggleCourse(c)} /> {c}
                      </label>
                    ))}
                </div>
                <div className="course-picks">
                  {picked.length ? (
                    picked.map((c) => (
                      <span key={c} className="chip">
                        {c}
                      </span>
                    ))
                  ) : (
                    <span className="muted">No course selected yet.</span>
                  )}
                </div>
              </div>
            ) : (
              <p className="muted" style={{ margin: "8px 0" }}>
                No courses yet. Add one below.
              </p>
            )}
            <label style={{ marginTop: 14 }}>Add a course not in the list</label>
            <div className="add-row">
              <input value={newCourse} placeholder="e.g. Working at Height" onChange={(e) => setNewCourse(e.target.value)} />
              <button className="btn dark" type="button" onClick={addCourse}>
                Add course
              </button>
            </div>
            <p className="hint" style={{ margin: "8px 0 0" }}>
              Tick every course for this job.
            </p>
            <div className={courseMsg.ok ? "ok-msg" : "err"}>{courseMsg.text}</div>
          </div>
        ) : (
          <div>
            <label>Scope of work *</label>
            <input value={f.scope} placeholder={`e.g. Pressure gauge ${service.toLowerCase()}`} onChange={bind("scope")} />
          </div>
        )}
      </div>
      <div className="job-block">
        <h4>5 · {training ? "Line items" : "Equipment"}</h4>
        <table>
          <thead>
            <tr>
              <th>SN</th>
              <th>Description</th>
              <th>Qty</th>
              <th>Remarks</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.key}>
                <td>{i + 1}</td>
                <td>
                  <input
                    value={l.description}
                    placeholder={descPlaceholder}
                    onChange={(e) => setLine(l.key, { description: e.target.value, fromCourse: false })}
                  />
                </td>
                <td>
                  <input value={l.qty} placeholder="1" style={{ maxWidth: 90 }} onChange={(e) => setLine(l.key, { qty: e.target.value })} />
                </td>
                <td>
                  <input value={l.remarks} onChange={(e) => setLine(l.key, { remarks: e.target.value })} />
                </td>
                <td>
                  <button className="btn ghost sm" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn sec sm" style={{ marginTop: 10 }} onClick={() => setLines([...lines, newLine()])}>
          + Add line item
        </button>
        <div style={{ marginTop: 16 }}>
          <label>Work codes</label>
          <label className="checkline">
            <input type="checkbox" checked={codeTraining} onChange={(e) => setCodeTraining(e.target.checked)} /> Training
          </label>
          <label className="checkline" style={{ marginLeft: 20 }}>
            <input type="checkbox" checked={codeCertification} onChange={(e) => setCodeCertification(e.target.checked)} /> Certification
          </label>
        </div>
        {training && (
          <div style={{ marginTop: 14 }}>
            <label>Description</label>
            <textarea
              rows={2}
              value={description.value}
              placeholder="Filled from the selected course"
              onChange={(e) => setDescription({ value: e.target.value, fromCourse: false })}
            />
          </div>
        )}
        <div style={{ marginTop: 14 }}>
          <label>Client requirements</label>
          <textarea rows={2} value={f.req} onChange={bind("req")} />
        </div>
      </div>
      <button className="btn wide" onClick={save} disabled={busy}>
        {editId ? "Save changes" : "Create " + service + " job"}
      </button>
      <div className="err">{err}</div>
    </div>
  );
}
