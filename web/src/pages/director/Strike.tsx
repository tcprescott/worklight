import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShowPageProps } from "../../App";
import { api } from "../../api";
import { addDays, longDate, time12 } from "../../lib/dates";
import { displayName, firstName } from "../../lib/people";
import { StaffShell } from "../../shell";
import type { Member, StrikeChecklist, StrikeTaskView } from "../../types";
import { Dialog, ErrorView, FormError, Icon, Loading, Progress, useToast } from "../../ui";
import "./strike.css";

const POLL_MS = 20_000;
// Strike tasks go to named crew and staff. Cast aren't offered.
const assignable = (m: Member) => m.role === "crew" || m.role === "staff";

/** The stage manager's strike checklist: one list grouped by area, with who has each task. */
export function Strike(props: ShowPageProps) {
  const show = props.view.show;
  const showId = show.showId;
  const [list, setList] = useState<StrikeChecklist>();
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string>();
  const [assigning, setAssigning] = useState<StrikeTaskView>();
  const [editing, setEditing] = useState<StrikeTaskView | { area?: string }>();
  const [toast, showToast] = useToast();
  const pending = useRef(0);

  const load = useCallback(async () => {
    try {
      const next = await api.strike(showId);
      // Don't let a poll undo a box someone is ticking right now.
      if (pending.current === 0) setList(next);
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [showId]);

  useEffect(() => {
    void load();
    api
      .members(showId)
      .then(setMembers)
      .catch(() => undefined);
  }, [load, showId]);

  // Crew tick things off on their phones during strike: pick that up as it happens.
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  const people = useMemo(() => members.filter(assignable), [members]);
  const nameOf = useMemo(() => new Map(members.map((m) => [m.userId, displayName(m)])), [members]);

  /** Applies a change on screen at once, then saves it; puts it back if the save fails. */
  const change = async (task: StrikeTaskView, patch: Partial<StrikeTaskView>, save: () => Promise<unknown>) => {
    const swap = (t: StrikeTaskView) => (list ? { ...list, tasks: list.tasks.map((x) => (x.taskId === task.taskId ? t : x)) } : list);
    setList(swap({ ...task, ...patch }));
    pending.current += 1;
    try {
      await save();
    } catch (err) {
      setList(swap(task));
      showToast(`Couldn't save that: ${(err as Error).message}`);
    } finally {
      pending.current -= 1;
    }
    await load();
  };

  const toggle = (task: StrikeTaskView) =>
    change(task, { doneAt: task.doneAt ? null : new Date().toISOString() }, () =>
      api.updateStrikeTask(showId, task.taskId, { done: !task.doneAt }),
    );

  const assign = async (task: StrikeTaskView, ids: string[]) => {
    setAssigning(undefined);
    await change(task, { assigneeIds: ids, assignees: ids.map((u) => ({ userId: u, name: nameOf.get(u) })) }, () =>
      api.updateStrikeTask(showId, task.taskId, { assigneeIds: ids }),
    );
  };

  const copyTemplate = async () => {
    try {
      setList(await api.copyStrikeTemplate(showId));
      showToast("Copied the company's strike list");
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  let body;
  if (error && !list) body = <ErrorView message={error} onRetry={() => void load()} />;
  else if (!list) body = <Loading />;
  else {
    const total = list.tasks.length;
    const canEdit = list.canEdit;
    body = (
      <main className="page strike-page">
        <div className="strike-head">
          <span className="kicker">Strike</span>
          <h1 className="title-md">{show.name}</h1>
          <StrikeCallLine list={list} view={props} onChanged={load} showToast={showToast} />
        </div>

        {total > 0 && (
          <div className="strike-progress">
            <div className="strike-progress-row">
              <span>
                {list.doneCount} of {total} done
              </span>
              {list.unassignedCount > 0 && <span className="strike-unassigned-count">{list.unassignedCount} unassigned</span>}
            </div>
            <Progress parts={[{ value: list.doneCount }]} total={total} label="Strike tasks done" />
          </div>
        )}

        {total === 0 ? (
          <div className="empty strike-empty">
            <strong>No strike tasks yet</strong>
            <span>
              {list.templateAvailable
                ? "Start from your company's standard strike list, then assign each task to someone."
                : "Add the jobs that need doing, area by area. Company admins can also keep a standard list that every show starts from."}
            </span>
            {canEdit && (
              <div className="row">
                {list.templateAvailable && (
                  <button type="button" className="btn btn-primary" onClick={() => void copyTemplate()}>
                    Copy the company list
                  </button>
                )}
                <button type="button" className={list.templateAvailable ? "btn" : "btn btn-primary"} onClick={() => setEditing({})}>
                  <Icon name="plus" /> Add a task
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="strike-list">
            {list.areas.map((area) => {
              const tasks = list.tasks.filter((t) => t.area === area);
              return (
                <section key={area} className="strike-area" aria-label={area}>
                  <h2 className="strike-area-head">
                    <span>{area}</span>
                    <span>
                      {tasks.filter((t) => t.doneAt).length} / {tasks.length}
                    </span>
                  </h2>
                  {tasks.map((t) => (
                    <TaskRow
                      key={t.taskId}
                      task={t}
                      canEdit={canEdit}
                      onToggle={() => void toggle(t)}
                      onAssign={() => setAssigning(t)}
                      onEdit={() => setEditing(t)}
                    />
                  ))}
                  {canEdit && (
                    <button type="button" className="strike-add-here" onClick={() => setEditing({ area })}>
                      <Icon name="plus" size={16} /> Add to {area}
                    </button>
                  )}
                </section>
              );
            })}
            {canEdit && (
              <div className="row">
                <button type="button" className="btn" onClick={() => setEditing({})}>
                  <Icon name="plus" /> Add a task in a new area
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    );
  }

  return (
    <StaffShell view={props.view} current="strike">
      {body}
      {assigning && (
        <AssignDialog task={assigning} people={people} onClose={() => setAssigning(undefined)} onSave={(ids) => void assign(assigning, ids)} />
      )}
      {editing && list && (
        <TaskDialog
          showId={showId}
          task={"taskId" in editing ? editing : undefined}
          area={"taskId" in editing ? editing.area : editing.area}
          areas={list.areas}
          people={people}
          onClose={() => setEditing(undefined)}
          onSaved={async (message) => {
            setEditing(undefined);
            await load();
            showToast(message);
          }}
        />
      )}
      {toast}
    </StaffShell>
  );
}

function TaskRow(props: { task: StrikeTaskView; canEdit: boolean; onToggle: () => void; onAssign: () => void; onEdit: () => void }) {
  const t = props.task;
  const done = Boolean(t.doneAt);
  return (
    <div className={done ? "strike-task done" : "strike-task"}>
      <input
        type="checkbox"
        className="strike-box"
        checked={done}
        disabled={!props.canEdit && !t.canCheck}
        onChange={props.onToggle}
        aria-label={`${t.text}: ${done ? "done" : "not done"}`}
      />
      <div className="strike-task-body">
        <span className="strike-task-text">{t.text}</span>
        {t.note && <span className="strike-task-note">{t.note}</span>}
        {t.returnItems && t.returnItems.length > 0 && <span className="strike-task-note strike-return-items">{t.returnItems.join(", ")}</span>}
        <div className="strike-who">
          {t.assignees.length === 0 ? (
            <button type="button" className="strike-chip none" onClick={props.onAssign} disabled={!props.canEdit}>
              Unassigned
            </button>
          ) : (
            t.assignees.map((a) => (
              <button key={a.userId} type="button" className="strike-chip" onClick={props.onAssign} disabled={!props.canEdit}>
                {a.name ? firstName(a.name) : "Someone"}
              </button>
            ))
          )}
          {props.canEdit && t.assignees.length > 0 && (
            <button type="button" className="strike-chip add" onClick={props.onAssign} aria-label="Change who has this">
              +
            </button>
          )}
          {done && t.doneByName && <span className="strike-done-by">Done by {firstName(t.doneByName)}</span>}
        </div>
      </div>
      {props.canEdit && (
        <button type="button" className="strike-edit" onClick={props.onEdit} aria-label={`Edit ${t.text}`} title="Edit">
          <Icon name="edit" size={18} />
        </button>
      )}
    </div>
  );
}

/** The strike call: when it is, or a quick way to add one (the day after closing by default). */
function StrikeCallLine(props: {
  list: StrikeChecklist;
  view: ShowPageProps;
  onChanged: () => Promise<void>;
  showToast: (m: string) => void;
}) {
  const show = props.view.view.show;
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState(addDays(show.endDate, 1));
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("14:00");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const call = props.list.calls[0];

  if (call) {
    const where = call.location ?? show.venue;
    return (
      <div className="strike-call">
        <span className="strike-call-when">
          {longDate(call.date)} · {time12(call.start)} to {time12(call.end)}
          {where ? ` · ${where}` : ""}
        </span>
        {!call.published && props.list.canEdit && (
          <span className="strike-call-draft">
            Not published yet, so nobody is called.{" "}
            <button
              type="button"
              className="link-btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.publish(show.showId, call.date, call.date);
                  await props.onChanged();
                  props.showToast("Strike call published. Everyone is called.");
                } catch (err) {
                  props.showToast((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Publish it
            </button>
          </span>
        )}
      </div>
    );
  }
  if (!props.list.canEdit) return <span className="strike-call muted">No strike call on the schedule.</span>;
  if (!adding)
    return (
      <div className="strike-call">
        <span className="muted">There's no strike call on the schedule yet.</span>
        <button type="button" className="btn btn-sm btn-outline" onClick={() => setAdding(true)}>
          Add the strike call
        </button>
      </div>
    );

  const submit = async () => {
    setError(undefined);
    if (end <= start) return setError("Strike has to end after it starts.");
    setBusy(true);
    try {
      await api.createCall(show.showId, { date, start, end, type: "strike" });
      setAdding(false);
      await props.onChanged();
      props.showToast("Strike call added. Publish it when you're ready to call everyone.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="strike-call-form">
      <div className="form-grid strike-call-fields">
        <label className="field">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          Starts
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          Ends
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <p className="small muted">Everyone in the show is called. If the list is empty, it starts as a copy of the company's.</p>
      <FormError error={error} />
      <div className="row">
        <button type="button" className="btn" onClick={() => setAdding(false)}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
          {busy ? "Adding..." : "Add the strike call"}
        </button>
      </div>
    </div>
  );
}

function AssignDialog(props: { task: StrikeTaskView; people: Member[]; onClose: () => void; onSave: (ids: string[]) => void }) {
  const [ids, setIds] = useState<string[]>(props.task.assigneeIds ?? []);
  const flip = (id: string) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const byDept = new Map<string, Member[]>();
  for (const m of props.people) {
    const d = m.department ?? (m.role === "staff" ? "Staff" : "Crew");
    byDept.set(d, [...(byDept.get(d) ?? []), m]);
  }
  return (
    <Dialog title="Who has this?" onClose={props.onClose}>
      <p className="strike-dlg-sub">{props.task.text}</p>
      {props.people.length === 0 ? (
        <p className="small muted">There's no crew in this show yet. Invite them from People.</p>
      ) : (
        [...byDept].map(([dept, ms]) => (
          <div key={dept} className="stack-sm">
            <span className="caps small muted">{dept}</span>
            <div className="chips">
              {ms.map((m) => (
                <button key={m.userId} type="button" className="chip" aria-pressed={ids.includes(m.userId)} onClick={() => flip(m.userId)}>
                  {displayName(m)}
                </button>
              ))}
            </div>
          </div>
        ))
      )}
      <div className="dialog-actions">
        <button className="btn" onClick={props.onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={() => props.onSave(ids)}>
          {ids.length === 0 ? "Leave unassigned" : `Assign ${ids.length === 1 ? "1 person" : `${ids.length} people`}`}
        </button>
      </div>
    </Dialog>
  );
}

const NEW_AREA = "__new";

function TaskDialog(props: {
  showId: string;
  task?: StrikeTaskView;
  area?: string;
  areas: string[];
  people: Member[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const t = props.task;
  const [area, setArea] = useState(props.area ?? props.areas[0] ?? NEW_AREA);
  const [newArea, setNewArea] = useState("");
  const [text, setText] = useState(t?.text ?? "");
  const [note, setNote] = useState(t?.note ?? "");
  const [ids, setIds] = useState<string[]>(t?.assigneeIds ?? []);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const flip = (id: string) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const save = async () => {
    const chosen = (area === NEW_AREA ? newArea : area).trim();
    if (!chosen) return setError("Give the area a name, like Set or Props.");
    if (!text.trim()) return setError("Say what needs doing.");
    setBusy(true);
    setError(undefined);
    try {
      if (t) {
        await api.updateStrikeTask(props.showId, t.taskId, { area: chosen, text: text.trim(), note: note.trim() || null, assigneeIds: ids });
        await props.onSaved("Task saved");
      } else {
        await api.addStrikeTask(props.showId, { area: chosen, text: text.trim(), note: note.trim() || null, assigneeIds: ids });
        await props.onSaved(`Added to ${chosen}`);
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!t) return;
    setBusy(true);
    try {
      await api.deleteStrikeTask(props.showId, t.taskId);
      await props.onSaved("Task removed");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog title={t ? "Edit task" : "Add a strike task"} onClose={props.onClose}>
      <label className="field">
        Area
        <select value={area} onChange={(e) => setArea(e.target.value)}>
          {props.areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
          <option value={NEW_AREA}>New area...</option>
        </select>
      </label>
      {area === NEW_AREA && (
        <label className="field">
          New area <span className="hint">Like Set, Props, Lights &amp; sound, or Space</span>
          <input value={newArea} maxLength={60} onChange={(e) => setNewArea(e.target.value)} autoFocus />
        </label>
      )}
      <label className="field">
        What needs doing
        <input value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder="Break down the platform, stack lumber by length" />
      </label>
      <label className="field">
        Note <span className="hint">Optional, like "Leave the booth unlocked"</span>
        <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </label>
      {props.people.length > 0 && (
        <div className="stack-sm">
          <span className="field">Who has it</span>
          <div className="chips">
            {props.people.map((m) => (
              <button key={m.userId} type="button" className="chip" aria-pressed={ids.includes(m.userId)} onClick={() => flip(m.userId)}>
                {displayName(m)}
              </button>
            ))}
          </div>
        </div>
      )}
      <FormError error={error} />
      <div className="dialog-actions strike-dlg-actions">
        {t &&
          (confirmDelete ? (
            <button className="btn btn-danger" disabled={busy} onClick={() => void remove()}>
              Yes, remove it
            </button>
          ) : (
            <button className="btn" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" size={16} /> Remove
            </button>
          ))}
        <span className="grow" />
        <button className="btn" onClick={props.onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving..." : t ? "Save" : "Add task"}
        </button>
      </div>
    </Dialog>
  );
}
