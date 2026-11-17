import { useState } from "react";
import { api } from "../../../api";
import { conflictStatus, displayName } from "../../../lib/people";
import type { Breakdown, Character, Member } from "../../../types";
import { Dialog, FormError, Icon } from "../../../ui";
import { Confirm, errorText } from "./Confirm";
import { orderedCharacters, playerFull } from "./model";

const MEMBER_STATUS = { invited: "Invite sent", waiting: "Joined", in: "Joined" } as const;

/** Characters and casting: add, rename, reorder, delete, and pick who plays each. */
export function CharactersDialog(props: {
  showId: string;
  bd: Breakdown;
  members: Member[];
  readOnly: boolean;
  startWith?: string; // charId to open straight away
  onClose: () => void;
  onSaved: (message: string) => Promise<void> | void;
}) {
  const chars = orderedCharacters(props.bd);
  const memberMap = new Map(props.members.map((m) => [m.userId, m]));
  const [editing, setEditing] = useState<string | undefined>(props.startWith);
  const [name, setName] = useState("");
  const [ensemble, setEnsemble] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const editingChar = chars.find((c) => c.charId === editing);
  if (editingChar)
    return (
      <CharacterEditor
        {...props}
        character={editingChar}
        onBack={() => (props.startWith ? props.onClose() : setEditing(undefined))}
      />
    );

  const add = async () => {
    if (!name.trim()) return setError("Type a character name.");
    setBusy(true);
    setError(undefined);
    try {
      await api.createCharacter(props.showId, { name: name.trim(), ensemble, castUserIds: [] });
      await props.onSaved(`Added ${name.trim()}`);
      setName("");
      setEnsemble(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const move = async (i: number, delta: number) => {
    const ids = chars.map((c) => c.charId);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    try {
      await api.reorder(props.showId, "characters", ids);
      await props.onSaved(`Moved ${chars[i]!.name}`);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <Dialog title="Characters and casting" onClose={props.onClose} wide>
      <p className="lede">
        {props.readOnly
          ? "Who plays each part."
          : "Everyone who appears in a scene. Pick who plays each part. Ensembles and double casting are fine."}
      </p>
      {chars.length === 0 ? (
        <p className="sp-muted-box">No characters yet. Add the first one below.</p>
      ) : (
        <div className="list sp-char-list">
          {chars.map((c, i) => {
            const played = playerFull(c, memberMap);
            return (
              <div key={c.charId} className="sp-char-row">
                <button className="sp-char-main" onClick={() => setEditing(c.charId)} disabled={props.readOnly}>
                  <span className="sp-char-name">
                    {c.name}
                    {c.ensemble && <span className="tag">Ensemble</span>}
                  </span>
                  <span className={played ? "small muted" : "small sp-faint"}>{played ? `Played by ${played}` : "Not cast"}</span>
                </button>
                {!props.readOnly && (
                  <span className="sp-char-tools">
                    <button className="sp-icon-btn" aria-label={`Move ${c.name} up`} disabled={i === 0} onClick={() => void move(i, -1)}>
                      <Icon name="up" size={16} />
                    </button>
                    <button className="sp-icon-btn" aria-label={`Move ${c.name} down`} disabled={i === chars.length - 1} onClick={() => void move(i, 1)}>
                      <Icon name="down" size={16} />
                    </button>
                    <button className="btn btn-sm" onClick={() => setEditing(c.charId)}>
                      {c.castUserIds.length ? "Edit" : "Cast"}
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!props.readOnly && (
        <form
          className="sp-add-char"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label className="field grow">
            New character
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hermia" maxLength={80} autoFocus={chars.length === 0} />
          </label>
          <label className="check">
            <input type="checkbox" checked={ensemble} onChange={(e) => setEnsemble(e.target.checked)} />
            Ensemble (several people)
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Add character
          </button>
        </form>
      )}
      <FormError error={error} />
      <div className="dialog-actions">
        <button className="btn" onClick={props.onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

function CharacterEditor(props: {
  showId: string;
  members: Member[];
  character: Character;
  readOnly: boolean;
  onBack: () => void;
  onClose: () => void;
  onSaved: (message: string) => Promise<void> | void;
}) {
  const c = props.character;
  const [name, setName] = useState(c.name);
  const [ensemble, setEnsemble] = useState(c.ensemble);
  const [cast, setCast] = useState<string[]>(c.castUserIds);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const byName = (a: Member, b: Member) => displayName(a).localeCompare(displayName(b));
  const castMembers = props.members.filter((m) => m.role === "cast").sort(byName);
  const others = props.members.filter((m) => m.role !== "cast").sort(byName);

  const toggle = (id: string) => setCast((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const save = async () => {
    if (!name.trim()) return setError("The character needs a name.");
    setBusy(true);
    setError(undefined);
    try {
      await api.updateCharacter(props.showId, c.charId, { name: name.trim(), ensemble, castUserIds: cast });
      await props.onSaved(`Saved ${name.trim()}`);
      props.onBack();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  if (confirmDelete)
    return (
      <Confirm
        title={`Delete ${c.name}?`}
        confirmLabel="Delete character"
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await api.deleteCharacter(props.showId, c.charId);
          await props.onSaved(`Deleted ${c.name}`);
          props.onBack();
        }}
      >
        <p>{c.name} comes out of every scene and off the cast list. The people who play the part stay in the show.</p>
      </Confirm>
    );

  const person = (m: Member) => (
    <label key={m.userId} className="sp-cast-option">
      <input type="checkbox" checked={cast.includes(m.userId)} onChange={() => toggle(m.userId)} />
      <span className="grow">
        <span className="sp-cast-name">{displayName(m)}</span>
        {m.role !== "cast" && <span className="small muted"> · {m.title || (m.role === "staff" ? "Staff" : "Crew")}</span>}
      </span>
      <span className="small muted">{MEMBER_STATUS[conflictStatus(m)]}</span>
    </label>
  );

  return (
    <Dialog title={c.name} onClose={props.onClose} wide>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="sp-add-char">
          <label className="field grow">
            Character name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </label>
          <label className="check">
            <input type="checkbox" checked={ensemble} onChange={(e) => setEnsemble(e.target.checked)} />
            Ensemble (several people)
          </label>
        </div>
        <div className="field">
          <span>
            Played by <span className="hint">{ensemble ? "pick everyone in the ensemble" : "pick one, or more for double casting"}</span>
          </span>
          {props.members.length === 0 ? (
            <p className="sp-muted-box">Nobody is in the show yet. Invite your cast from the People page, then cast them here.</p>
          ) : (
            <div className="sp-cast-list">
              {castMembers.length > 0 && <span className="caps">Cast</span>}
              {castMembers.map(person)}
              {others.length > 0 && <span className="caps">Crew and staff</span>}
              {others.map(person)}
            </div>
          )}
        </div>
        <FormError error={error} />
        <div className="dialog-actions sp-actions-split">
          <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
            Delete character
          </button>
          <span className="row">
            <button type="button" className="btn" onClick={props.onBack}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving..." : "Save"}
            </button>
          </span>
        </div>
      </form>
    </Dialog>
  );
}
