import { useState } from "react";
import { api } from "../../../api";
import type { Breakdown, Member, ShowRole } from "../../../types";
import { Dialog, FormError, Icon } from "../../../ui";
import { errorText } from "../breakdown/Confirm";
import { ROLE_LABEL, type Person } from "./model";

/** Change which characters someone plays. Saves each character whose cast list changed. */
export function PartsDialog(props: {
  showId: string;
  person: Person;
  bd?: Breakdown;
  onClose: () => void;
  onSaved: (message: string) => Promise<void> | void;
}) {
  const uid = props.person.member.userId;
  const chars = [...(props.bd?.characters ?? [])].sort((a, b) => a.order - b.order);
  const [picked, setPicked] = useState<string[]>(chars.filter((c) => c.castUserIds.includes(uid)).map((c) => c.charId));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      for (const c of chars) {
        const was = c.castUserIds.includes(uid);
        const now = picked.includes(c.charId);
        if (was === now) continue;
        await api.updateCharacter(props.showId, c.charId, {
          castUserIds: now ? [...c.castUserIds, uid] : c.castUserIds.filter((x) => x !== uid),
        });
      }
      const names = chars.filter((c) => picked.includes(c.charId)).map((c) => c.name);
      await props.onSaved(names.length ? `${props.person.name} plays ${names.join(", ")}` : `${props.person.name} has no part now`);
      props.onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Dialog title={`${props.person.name}'s part`} onClose={props.onClose}>
      {chars.length === 0 ? (
        <p className="sp-muted-box">No characters yet. Add them on the Breakdown page, then cast people here.</p>
      ) : (
        <>
          <p className="lede">Pick every part they play. Others can share a part (double casting or an ensemble).</p>
          <div className="chips">
            {chars.map((c) => {
              const on = picked.includes(c.charId);
              const others = c.castUserIds.filter((x) => x !== uid).length;
              return (
                <button
                  key={c.charId}
                  type="button"
                  className="sp-chip"
                  aria-pressed={on}
                  title={others ? `${others} other${others === 1 ? "" : "s"} in this part` : undefined}
                  onClick={() => setPicked(on ? picked.filter((x) => x !== c.charId) : [...picked, c.charId])}
                >
                  {on && <Icon name="check" size={12} strokeWidth={3.5} />}
                  {c.name}
                  {others > 0 && !c.ensemble && <span className="sp-chip-note">+{others}</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
      <FormError error={error} />
      <div className="dialog-actions">
        <button className="btn" onClick={props.onClose}>
          Cancel
        </button>
        {chars.length > 0 && (
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving..." : "Save"}
          </button>
        )}
      </div>
    </Dialog>
  );
}

/** Role, title and department. */
export function EditMemberDialog(props: {
  showId: string;
  person: Person;
  isMe: boolean;
  departments: string[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void> | void;
}) {
  const m: Member = props.person.member;
  const [role, setRole] = useState<ShowRole>(m.role);
  const [title, setTitle] = useState(m.title ?? "");
  const [department, setDepartment] = useState(m.department ?? "");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.updateMember(props.showId, m.userId, {
        role,
        title: title.trim() || null,
        department: department.trim() || null,
      });
      await props.onSaved(`Saved ${props.person.name}`);
      props.onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Edit ${props.person.name}`} onClose={props.onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="field">
          In this show as
          <div className="chips" role="group" aria-label="Role">
            {(["cast", "crew", "staff"] as const).map((r) => (
              <button
                type="button"
                key={r}
                className="chip chip-lg"
                aria-pressed={role === r}
                disabled={props.isMe && r !== "staff"}
                onClick={() => setRole(r)}
              >
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>
          {props.isMe && <span className="hint">You can't take away your own staff access.</span>}
        </div>
        <div className="form-grid">
          <label className="field">
            <span>
              Title <span className="hint">(optional)</span>
            </span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Stage manager" maxLength={60} />
          </label>
          <label className="field">
            <span>
              Department <span className="hint">(optional)</span>
            </span>
            <input value={department} onChange={(e) => setDepartment(e.target.value)} list="sp-edit-departments" maxLength={60} />
            <datalist id="sp-edit-departments">
              {props.departments.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </label>
        </div>
        {role === "cast" && <span className="hint">Cast are listed under Cast. Department only groups crew and staff.</span>}
        <FormError error={error} />
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
