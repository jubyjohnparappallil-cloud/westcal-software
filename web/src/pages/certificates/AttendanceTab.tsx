import { useState } from "react";
import { useApp } from "../../app-context";
import { AddTrainee } from "../../components/AddTrainee";
import type { Job } from "../../types";
import { TrainerSheet } from "./TrainerSheet";

/** Attendance of one job, shown as the same sheet the trainer uses on the phone. */
export function AttendanceTab({ job: j, onChanged }: { job: Job; onChanged: () => void }) {
  const { perms } = useApp();
  const [bulk, setBulk] = useState(false);
  const open = j.status !== "Cancelled" && j.status !== "Closed" && perms.canChangeJob(j.status);
  const canMark = perms.canAddTrainees() && open;
  const issued = j.status === "Approved" || j.status === "Issued";

  return (
    <>
      {canMark && (
        <div className="dl-row" style={{ marginBottom: 10 }}>
          <button className="btn sec sm" onClick={() => setBulk(!bulk)}>
            {bulk ? "Hide many at once" : "Add many trainees at once"}
          </button>
          {issued && <span className="hint">Trainees added now get their certificate straight away.</span>}
        </div>
      )}
      {canMark && bulk && <AddTrainee job={j} onAdded={onChanged} />}
      <TrainerSheet job={j} canMark={canMark} onChanged={onChanged} />
    </>
  );
}
