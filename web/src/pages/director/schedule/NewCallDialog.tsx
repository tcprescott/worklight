import { useState } from "react";
import { longDate } from "../../../lib/dates";
import type { CallType, CreateCallBody } from "../../../types";
import { Dialog, FormError } from "../../../ui";

const TYPES: { id: CallType; label: string }[] = [
  { id: "rehearsal", label: "Rehearsal" },
  { id: "music", label: "Music" },
  { id: "choreography", label: "Choreography" },
  { id: "run", label: "Run-through" },
];

/** A call on a day that isn't one of the usual rehearsal nights. */
export function NewCallDialog(props: { date: string; onClose: () => void; create: (body: CreateCallBody) => Promise<boolean> }) {
  const [start, setStart] = useState("19:00");
  const [end, setEnd] = useState("21:30");
  const [type, setType] = useState<CallType>("rehearsal");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setError(undefined);
    if (!start || !end) return setError("Give a start and end time.");
    if (end <= start) return setError("The call has to end after it starts.");
    setSaving(true);
    await props.create({ date: props.date, start, end, type, title: title.trim() || null, location: location.trim() || null });
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
      <label className="field">
        Title <span className="hint">Optional, like "Fight call" or "Extra Saturday"</span>
        <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        Location <span className="hint">Optional</span>
        <input value={location} maxLength={200} onChange={(e) => setLocation(e.target.value)} />
      </label>
      <p className="small muted">Add scenes once the call is on the week. Nobody sees it until you publish.</p>
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
