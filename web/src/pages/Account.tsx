import { useState } from "react";
import { api } from "../api";
import { useSession } from "../session";
import { CompanyShell } from "../shell";
import { FormError, useToast } from "../ui";
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
      </main>
      {toast}
    </CompanyShell>
  );
}
