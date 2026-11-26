import { useState } from "react";
import { longDate } from "../../../lib/dates";
import { displayName } from "../../../lib/people";
import type { CallType, CreateCallBody, Member } from "../../../types";
import { Dialog, FormError } from "../../../ui";

const TYPES: { id: CallType; label: string }[] = [
  { id: "rehearsal", label: "Rehearsal" },
  { id: "music", label: "Music" },
  { id: "choreography", label: "Choreography" },
  { id: "run", label: "Run-through" },
  { id: "fitting", label: "Costume fitting" },
  { id: "strike", label: "Strike (calls everyone)" },
];

/** A call on a day that isn't one of the usual rehearsal nights. */
export function NewCallDialog(props: {
  date: string;
  members?: Member[];
  onClose: () => void;
  create: (body: CreateCallBody) => Promise<boolean>;
}) {
  const [start, setStart] = useState("19:00");
  const [end, setEnd] = useState("21:30");
  const [type, setType] = useState<CallType>("rehearsal");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [userIds, setUserIds] = useState<string[]>([]);
  const cast = (props.members ?? []).filter((m) => m.role === "cast");
  const flip = (id: string) => setUserIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const submit = async () => {
    setError(undefined);
    if (!start || !end) return setError("Give a start and end time.");
    if (end <= start) return setError("The call has to end after it starts.");
    if (type === "fitting" && userIds.length === 0) return setError("Pick who's coming to the fitting.");
    setSaving(true);
    await props.create({
      date: props.date,
      start,
      end,
      type,
      title: title.trim() || null,
      location: location.trim() || null,
      ...(type === "fitting" ? { userIds } : {}),
    });
    setSaving(false);
  };

  return (
    <Dialog title="Add a call" onClose={props.onClose}>
      <p className="sch-dlg-sub">{longDate(props.date)} isn't one of the usual rehearsal nights.</p>
      <div className="form-grid">
        <label className="field">
          Starts
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          Ends
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <label className="field">
        Kind of call
        <select value={type} onChange={(e) => setType(e.target.value as CallType)}>
          {TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      {type === "fitting" && (
        <div className="stack-sm">
          <span className="field">Who's coming</span>
          <div className="chips">
            {cast.map((m) => (
              <button key={m.userId} type="button" className="chip" aria-pressed={userIds.includes(m.userId)} onClick={() => flip(m.userId)}>
                {displayName(m)}
              </button>
            ))}
          </div>
          {cast.length === 0 && <span className="small muted">Add the cast in People first.</span>}
        </div>
      )}
      <label className="field">
        Title <span className="hint">Optional, like "Fight call" or "Extra Saturday"</span>
        <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        Location <span className="hint">Optional</span>
        <input value={location} maxLength={200} onChange={(e) => setLocation(e.target.value)} />
      </label>
      <p className="small muted">
        {type === "fitting"
          ? "Only the people you pick are called. Nobody sees it until you publish."
          : "Add scenes once the call is on the week. Nobody sees it until you publish."}
      </p>
      <FormError error={error} />
      <div className="dialog-actions">
        <button className="btn" onClick={props.onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={saving} onClick={() => void submit()}>
          {saving ? "Adding..." : "Add the call"}
        </button>
      </div>
    </Dialog>
  );
}
