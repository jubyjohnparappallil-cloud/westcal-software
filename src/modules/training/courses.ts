import { newId } from "../../shared/id.js";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors.js";

/**
 * Master Westcal training-course list (from the WESTCAL course spreadsheet).
 * Super Admin can add more at runtime; they then appear in the job dropdown.
 */
export const SEED_COURSES: string[] = [
  "Accident and Incident Investigation",
  "Air Receiver / Compressor Inspector",
  "Authorized Gas Tester",
  "Baby Sitters Leisure and Safety Training",
  "Back Hoe Loader",
  "Banks Man and Flag Man",
  "Bar Bending and Cutting Machine Operator",
  "Basic Explosive Awareness Training",
  "Behavioral Safety Training",
  "Block Cutting Operator",
  "Bobcat Operator",
  "Boom Lift Operator",
  "Breathing Apparatus Awareness",
  "Brazing And Soldering",
  "Cylinder / Oxygen Awareness",
  "Confined Space Entry",
  "Confined Space Rescue Safety Training",
  "Crane Operator",
  "Crawler Crane Operator",
  "Concrete Pump Operator",
  "Crisis Management Training",
  "Cylinder Awareness Training",
  "Dangerous Goods Handling",
  "Defensive Driving Training",
  "Defensive Fire Safety Training",
  "Disability Awareness",
  "Dozer Machine Operator",
  "Electrical Safety Training",
  "Elevator Inspector",
  "Emergency Response Training",
  "EOT Crane Operator",
  "Excavator Operator",
  "Excavation Safety",
  "Fire Watch / Fire Warden",
  "Flagman Training",
  "Forklift Operator",
  "General HSE Awareness at Work Training",
  "Grader Machine Operator",
  "Hand and Power Tools Operator",
  "Hazard Recognition and Assessment",
  "H2S Awareness",
  "Hot Work Training",
  "Hydra Operator",
  "Incident Investigation Training",
  "Job Safety Analysis",
  "Lifting Supervisor",
  "Load Test Engineer Course",
  "Lock Out Tag Out (LOTO)",
  "Manlift Operator",
  "MEWP Operator",
  "Mobile Crane Operator",
  "Mobile Elevating Working Platform Inspector",
  "Overhead Crane Operator",
  "Permit To Work",
  "Piling Rig Operator",
  "Pressure Test",
  "Rigger & Slinger",
  "Risk Assessment Training",
  "Road Safety Awareness Training",
  "Safe Construction / Work at Height",
  "Safe Use of Ladder and General Working",
  "Tower Crane Operator",
  "Scaffolding Erection & Dismantling",
  "Scaffolding Inspector",
  "Scaffolding Supervisor",
  "Scissor Lift Operator",
  "Shuttering Carpenter",
  "Skid Steer Loader Operator",
  "Spill Response Training",
  "Spreader Beams Inspector",
  "Telehandler Operator",
  "Tower Crane Inspector",
  "Usage of Personal Protective Equipment",
  "Vehicle Lift Inspector",
  "Working at Height",
  "Working at Height and Safety Training",
  "Wheel Loader Operator",
  "Window Cradle Operator",
  "Work at Height and Rescue",
  "First Aid / CPR",
  "Basic Fire Fighting",
];

/** @deprecated use CourseCatalog — kept as the seed name list. */
export const COURSES = SEED_COURSES;

export interface Course {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
}

export class CourseCatalog {
  private readonly byId = new Map<string, Course>();
  private readonly byName = new Map<string, string>();

  constructor(seed: string[] = SEED_COURSES) {
    for (const name of seed) this.add(name, defaultCourseDescription(name));
  }

  list(): Course[] {
    return [...this.byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  names(): string[] {
    return this.list().map((c) => c.name);
  }

  addIfMissing(name: string, description?: string): Course | undefined {
    const key = (name ?? "").trim().toLowerCase();
    if (!key || this.byName.has(key)) return this.byId.get(this.byName.get(key) ?? "");
    return this.add(name, description);
  }

  add(name: string, description?: string): Course {
    const trimmed = (name ?? "").trim();
    if (trimmed.length < 2) {
      throw new ValidationError("course name is required", "name");
    }
    const key = trimmed.toLowerCase();
    if (this.byName.has(key)) {
      throw new ConflictError("that course is already in the list", "name");
    }
    const desc = (description ?? "").trim() || defaultCourseDescription(trimmed);
    const course: Course = { id: newId(), name: trimmed, description: desc, createdAt: new Date() };
    this.byId.set(course.id, course);
    this.byName.set(key, course.id);
    return course;
  }

  remove(id: string): void {
    const c = this.byId.get(id);
    if (!c) throw new NotFoundError("course not found");
    this.byId.delete(id);
    this.byName.delete(c.name.toLowerCase());
  }
}

function defaultCourseDescription(name: string): string {
  return `${name} training and certification.`;
}
