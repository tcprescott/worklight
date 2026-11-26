import { useEffect, useState } from "react";
import { api } from "../../api";
import { longDate, time12 } from "../../lib/dates";
import { firstName } from "../../lib/people";
import type { StrikeChecklist, StrikeTaskView } from "../../types";
import { useToast } from "../../ui";
import "../director/strike.css";

/** "Your strike tasks": only the tasks the stage manager gave me, each with a box I tick when it's done. */
export function MyStrikeTasks(props: { showId: string; userId: string; readOnly?: boolean }) {
  const [list, setList] = useState<StrikeChecklist>();
  const [toast, showToast] = useToast();

  useEffect(() => {
    let live = true;
    api
      .strike(props.showId)
      .then((l) => live && setList(l))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [props.showId]);

  if (!list || list.tasks.length === 0) return null;

  const toggle = async (task: StrikeTaskView) => {
    const flip = (t: StrikeTaskView, doneAt: string | null) => ({ ...t, doneAt });
    const swap = (doneAt: string | null) =>
      setList((l) => (l ? { ...l, tasks: l.tasks.map((x) => (x.taskId === task.taskId ? flip(x, doneAt) : x)) } : l));
    swap(task.doneAt ? null : new Date().toISOString());
    try {
      await api.updateStrikeTask(props.showId, task.taskId, { done: !task.doneAt });
    } catch (err) {
      swap(task.doneAt ?? null);
      showToast(`Couldn't save that: ${(err as Error).message}`);
    }
  };

  const done = list.tasks.filter((t) => t.doneAt).length;
  const call = list.calls[0];
  return (
    <>
      <div className="actor-section-head">
        <h2>Your strike tasks</h2>
        <span className="cond muted">
          {done} / {list.tasks.length}
        </span>
      </div>
      <div className="actor-section strike-mine">
        {call && (
          <p className="small muted">
            Strike is {longDate(call.date)}, {time12(call.start)} to {time12(call.end)}.
          </p>
        )}
        <div className="strike-area">
          {list.tasks.map((t) => {
            const mates = t.assignees.filter((a) => a.userId !== props.userId);
            return (
              <div key={t.taskId} className={t.doneAt ? "strike-task done" : "strike-task"}>
                <input
                  type="checkbox"
                  className="strike-box"
                  checked={Boolean(t.doneAt)}
                  disabled={props.readOnly || !t.canCheck}
                  onChange={() => void toggle(t)}
                  aria-label={`${t.text}: ${t.doneAt ? "done" : "not done"}`}
                />
                <div className="strike-task-body">
                  <span className="caps small muted">{t.area}</span>
                  <span className="strike-task-text">{t.text}</span>
                  {t.note && <span className="strike-task-note">{t.note}</span>}
                  {t.returnItems && t.returnItems.length > 0 && <span className="strike-task-note">{t.returnItems.join(", ")}</span>}
                  {mates.length > 0 && (
                    <span className="strike-task-note">With {mates.map((m) => (m.name ? firstName(m.name) : "someone")).join(" and ")}</span>
                  )}
                </div>
                <span />
              </div>
            );
          })}
        </div>
        <p className="small muted">Stage management sees what you tick off.</p>
      </div>
      {toast}
    </>
  );
}
