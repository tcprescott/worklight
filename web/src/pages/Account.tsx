import { useState } from "react";
import { api } from "../api";
import { useSession } from "../session";
import { CompanyShell } from "../shell";
import { FormError, useToast } from "../ui";
import type { NotifyPrefs } from "../types";
import { CalendarLinks } from "./actor/CalendarLinks";
import "./actor/actor.css";

export function Account() {
  const { me, reload } = useSession();
  const [name, setName] = useState(me.user.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [toast, showToast] = useToast();
  const changed = name.trim() !== (me.user.name ?? "").trim();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return setError("Your name can't be empty.");
    setSaving(true);
    setError(undefined);
    try {
      await api.updateName(clean);
      await reload();
      showToast("Name saved");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <CompanyShell>
      <main className="actor-plain">
        <div className="stack-sm">
          <h1 className="title-md">Name and email</h1>
          <p className="lede">Your name is how directors and cast mates see you on cast lists and call sheets.</p>
        </div>
        <form className="card stack" onSubmit={save}>
          <label className="field">
            Your name
            <input value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          </label>
          <FormError error={error} />
          <div className="actor-save-row">
            <button type="submit" className="btn btn-primary" disabled={saving || !changed}>
              {saving ? "Saving..." : "Save name"}
            </button>
          </div>
        </form>
        <div className="card stack">
          <div className="field">
            Email
            <div className="actor-readonly">{me.user.email}</div>
            <span className="hint">
              This is the address you sign in with and where invites and reminders go. To use another address, ask your director
              to invite it.
            </span>
          </div>
        </div>
        <Notifications onSaved={showToast} />
        <div className="card stack">
          <div className="stack-sm">
            <h2 className="title-sm">Calendar</h2>
            <p className="small muted">Every call you're in, for every show, in your own calendar app. It updates on its own.</p>
          </div>
          <CalendarLinks />
        </div>
      </main>
      {toast}
    </CompanyShell>
  );
}

const PREF_ROWS: { id: keyof NotifyPrefs; label: string; hint: string }[] = [
  { id: "emailReminders", label: "Day-before reminders", hint: "An email the day before each call, with the time and what to bring" },
  { id: "changeEmails", label: "Schedule changes", hint: "When a call you're in moves, changes, or is cancelled" },
  { id: "noticeEmails", label: "Callboard notices", hint: "When stage management posts a notice for you" },
];

/** Email preferences. Each toggle saves right away. */
function Notifications(props: { onSaved: (message: string) => void }) {
  const { me, reload } = useSession();
  const [prefs, setPrefs] = useState<NotifyPrefs>(me.user.prefs);
  const [error, setError] = useState<string>();

  async function toggle(id: keyof NotifyPrefs) {
    const next = { ...prefs, [id]: !prefs[id] };
    setPrefs(next);
    setError(undefined);
    try {
      await api.updatePrefs(next);
      await reload();
      props.onSaved(next[id] ? "Turned on" : "Turned off");
    } catch (err) {
      setPrefs(prefs);
      setError((err as Error).message);
    }
  }

  return (
    <div className="card stack">
      <div className="stack-sm">
        <h2 className="title-sm">Notifications</h2>
        <p className="small muted">What we email you at {me.user.email}. Your calls are always in the app either way.</p>
      </div>
      <div className="acct-prefs">
        {PREF_ROWS.map((p) => (
          <label key={p.id} className="acct-pref">
            <span>
              <strong>{p.label}</strong>
              <span>{p.hint}</span>
            </span>
            <input type="checkbox" role="switch" checked={prefs[p.id]} onChange={() => void toggle(p.id)} />
          </label>
        ))}
        <div className="acct-pref off">
          <span>
            <strong>Phone notifications</strong>
            <span>Coming with the app</span>
          </span>
          <input type="checkbox" disabled checked={false} aria-label="Phone notifications, coming with the app" />
        </div>
        <div className="acct-pref off">
          <span>
            <strong>
              Text messages <span className="tag tag-paid">PAID PLAN</span>
            </strong>
            <span>Only for urgent changes</span>
          </span>
          <input type="checkbox" disabled checked={false} aria-label="Text messages, paid plan" />
        </div>
      </div>
      <FormError error={error} />
    </div>
  );
}
