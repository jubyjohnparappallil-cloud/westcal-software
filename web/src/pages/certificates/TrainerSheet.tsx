import { useRef, useState } from "react";
import { useApp } from "../../app-context";
import { downloadBlob, setFieldSession } from "../../field/api";
import { FieldProvider } from "../../field/FieldApp";
import { Attendance } from "../../field/JobView";
import type { Job } from "../../types";
import "../../field/field-embed.css";

/** The trainer's attendance sheet (add by Emirates ID, edit, photos, signatures) inside the office console. */
export function TrainerSheet({ job, canMark, onChanged }: { job: Job; canMark: boolean; onChanged: () => void }) {
  const { session } = useApp();
  const [msg, setMsg] = useState("");
  const timer = useRef<number>();
  setFieldSession(session);

  const toast = (text: string) => {
    setMsg(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(""), 3200);
  };
  const reload = async () => {
    onChanged();
    return [] as Job[];
  };
  const download = async (path: string, name: string, done?: string) => {
    try {
      await downloadBlob(path, name);
      if (done) toast(done);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <FieldProvider value={{ session, toast, openJob: async () => onChanged() }}>
      <div className="field-embed">
        <Attendance j={job} canMark={canMark} showAttendance reload={reload} download={download} office />
        {msg && (
          <div className="toast" role="status">
            {msg}
          </div>
        )}
      </div>
    </FieldProvider>
  );
}
