import { useEffect, useState } from "react";
import { api } from "../api";
import { Link } from "../router";
import type { ApprovedPickup, EmergencyContact, MedicalNotes, SafetyAccessView, SafetyInfo } from "../types";
import { FormError } from "../ui";
import "./director/safety.css";

const MEDICAL: { key: keyof MedicalNotes; label: string; hint: string }[] = [
  { key: "allergies", label: "Allergies", hint: "e.g. peanuts, bee stings, and what to do" },
  { key: "conditions", label: "Conditions", hint: "e.g. asthma, diabetes, seizures" },
  { key: "medications", label: "Medications", hint: "Anything staff may need to help with, and where it is" },
  { key: "other", label: "Anything else", hint: "" },
];

const blankContact = (): EmergencyContact => ({ name: "", phone: "", relationship: "", guardian: false });
const blankPickup = (): ApprovedPickup => ({ name: "", note: "" });

function whenText(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** The person's own emergency contacts, optional medical notes, minors' pickups, and who has looked. */
export function SafetyCard(props: { onSaved: (message: string) => void }) {
  const [info, setInfo] = useState<SafetyInfo>();
  const [views, setViews] = useState<SafetyAccessView[]>([]);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [minor, setMinor] = useState(false);
  const [pickups, setPickups] = useState<ApprovedPickup[]>([]);
  const [hasMedical, setHasMedical] = useState(false);
  const [medical, setMedical] = useState<MedicalNotes>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [showLog, setShowLog] = useState(false);

  function fill(i: SafetyInfo) {
    setInfo(i);
    setContacts(i.contacts.length ? i.contacts : [blankContact()]);
    setMinor(i.minor);
    setPickups(i.pickups);
    setHasMedical(Boolean(i.medical));
    setMedical(i.medical ?? {});
  }

  useEffect(() => {
    void Promise.all([api.mySafety(), api.mySafetyViews()])
      .then(([i, v]) => {
        fill(i);
        setViews(v);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const filled = contacts.filter((c) => c.name.trim() || c.phone.trim());
    if (filled.some((c) => !c.name.trim() || !c.phone.trim())) return setError("Each contact needs a name and a phone number.");
    if (minor && !filled.some((c) => c.guardian)) return setError("Mark at least one contact as a parent or guardian.");
    setSaving(true);
    setError(undefined);
    try {
      const saved = await api.saveMySafety({
        minor,
        contacts: filled,
        pickups: minor ? pickups.filter((p) => p.name.trim()) : [],
        medical: hasMedical ? medical : null,
      });
      fill(saved);
      props.onSaved("Safety info saved");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const setContact = (i: number, patch: Partial<EmergencyContact>) =>
    setContacts((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const setPickup = (i: number, patch: Partial<ApprovedPickup>) =>
    setPickups((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  useEffect(() => {
    if (info && location.hash === "#safety") document.getElementById("safety")?.scrollIntoView({ block: "start" });
  }, [info]);

  if (!info && !error) return null;

  return (
    <form id="safety" className="card stack" onSubmit={save}>
      <div className="stack-sm">
        <h2 className="title-sm">Safety info</h2>
        <p className="small muted">
          Staff on your active shows can see your emergency contacts. Only staff given medical access can open medical notes. You
          can see every time someone looks.
        </p>
      </div>

      <span className="caps">Emergency contacts</span>
      {contacts.map((c, i) => (
        <div key={i} className="stack-sm safety-contact">
          <div className="form-grid">
            <label className="field">
              Name
              <input value={c.name} onChange={(e) => setContact(i, { name: e.target.value })} autoComplete="off" />
            </label>
            <label className="field">
              Relationship
              <input value={c.relationship ?? ""} placeholder="Mother, spouse, friend..." onChange={(e) => setContact(i, { relationship: e.target.value })} />
            </label>
            <label className="field">
              Phone
              <input type="tel" value={c.phone} onChange={(e) => setContact(i, { phone: e.target.value })} />
            </label>
            <label className="field">
              Other phone <span className="hint">Optional</span>
              <input type="tel" value={c.altPhone ?? ""} onChange={(e) => setContact(i, { altPhone: e.target.value })} />
            </label>
          </div>
          <div className="spread">
            {minor ? (
              <label className="check">
                <input type="checkbox" checked={Boolean(c.guardian)} onChange={(e) => setContact(i, { guardian: e.target.checked })} />
                Parent or guardian
              </label>
            ) : (
              <span />
            )}
            {contacts.length > 1 && (
              <button type="button" className="link-btn" onClick={() => setContacts((l) => l.filter((_, j) => j !== i))}>
                Remove
              </button>
            )}
          </div>
        </div>
      ))}
      {contacts.length < 5 && (
        <button type="button" className="btn btn-dashed btn-sm" onClick={() => setContacts((l) => [...l, blankContact()])}>
          + Add another contact
        </button>
      )}

      <label className="check">
        <input type="checkbox" checked={minor} onChange={(e) => setMinor(e.target.checked)} />
        I'm under 18
      </label>
      {minor && (
        <div className="stack-sm">
          <span className="caps">Approved pickups</span>
          <span className="small muted">Adults besides your guardians who may take you home from rehearsal.</span>
          {pickups.map((p, i) => (
            <div key={i} className="form-grid">
              <label className="field">
                Name
                <input value={p.name} onChange={(e) => setPickup(i, { name: e.target.value })} />
              </label>
              <label className="field">
                Note <span className="hint">e.g. neighbor, silver minivan</span>
                <input value={p.note ?? ""} onChange={(e) => setPickup(i, { note: e.target.value })} />
              </label>
            </div>
          ))}
          {pickups.length < 10 && (
            <button type="button" className="btn btn-dashed btn-sm" onClick={() => setPickups((l) => [...l, blankPickup()])}>
              + Add an approved adult
            </button>
          )}
        </div>
      )}

      <label className="check">
        <input type="checkbox" checked={hasMedical} onChange={(e) => setHasMedical(e.target.checked)} />
        Add medical notes <span className="hint">Optional</span>
      </label>
      {hasMedical && (
        <div className="stack-sm">
          {MEDICAL.map((f) => (
            <label key={f.key} className="field">
              {f.label} {f.hint && <span className="hint">{f.hint}</span>}
              <textarea rows={2} value={medical[f.key] ?? ""} onChange={(e) => setMedical((m) => ({ ...m, [f.key]: e.target.value }))} />
            </label>
          ))}
        </div>
      )}

      <FormError error={error} />
      <div className="actor-save-row">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving..." : "Save safety info"}
        </button>
      </div>

      <div className="stack-sm">
        <div className="spread">
          <span className="caps">Who has looked</span>
          {views.length > 0 && (
            <button type="button" className="link-btn" onClick={() => setShowLog(!showLog)}>
              {showLog ? "Hide" : `Show ${views.length}`}
            </button>
          )}
        </div>
        {views.length === 0 ? (
          <span className="small muted">Nobody has looked yet.</span>
        ) : (
          showLog && (
            <div className="list">
              {views.map((v, i) => (
                <div key={i} className="spread safety-view">
                  <span className="grow small">
                    {v.viewerName}
                    {v.viewerTitle ? `, ${v.viewerTitle}` : ""} · {v.view === "medical" ? <strong>medical notes</strong> : "contacts"}
                    <span className="muted"> · {v.showName}</span>
                  </span>
                  <span className="small muted">{whenText(v.at)}</span>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </form>
  );
}

const DISMISS_KEY = "worklight:safety-nudge-dismissed";

/** On show home until the person has an emergency contact. Adults can dismiss it; minors can't. */
export function SafetyNudge() {
  const [info, setInfo] = useState<SafetyInfo>();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    void api.mySafety().then(setInfo, () => undefined);
  }, []);
  if (!info || info.contacts.length > 0) return null;
  if (dismissed && !info.minor) return null;
  return (
    <div className="actor-section" style={{ paddingTop: 18 }}>
    <div className="safety-banner" role="status">
      <strong>Add an emergency contact</strong>
      <span className="small">Stage management needs someone to call if anything happens at rehearsal. It takes a minute.</span>
      <div className="row">
        <Link to="/account#safety" className="btn btn-sm btn-primary">
          Add it
        </Link>
        {!info.minor && (
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              try {
                localStorage.setItem(DISMISS_KEY, "1");
              } catch {
                /* private window */
              }
              setDismissed(true);
            }}
          >
            Not now
          </button>
        )}
      </div>
    </div>
    </div>
  );
}
