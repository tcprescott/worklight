import { useState } from "react";
import { api } from "../../../api";
import { formatPages, parsePages, sceneMinutes } from "../../../lib/pages";
import type { Breakdown, Scene } from "../../../types";
import { Dialog, FormError, Icon } from "../../../ui";
import { Confirm, errorText } from "./Confirm";
import { actName, groupActs, orderedCharacters, orderedScenes } from "./model";

const NEW_ACT = "__new";

/** Add a scene, or edit one (with move and delete). */
export function SceneDialog(props: {
  showId: string;
  bd: Breakdown;
  minutesPerPage: number;
  scene?: Scene;
  defaultActId?: string;
  onClose: () => void;
  onSaved: (message: string) => Promise<void> | void;
}) {
  const { bd, scene } = props;
  const groups = groupActs(bd);
  const characters = orderedCharacters(bd);
  const [actId, setActId] = useState(scene?.actId ?? props.defaultActId ?? groups[groups.length - 1]?.act.actId ?? NEW_ACT);
  const [newAct, setNewAct] = useState(actName(groups.length + 1));
  const [name, setName] = useState(scene?.name ?? "");
  const [number, setNumber] = useState(scene?.number ?? "");
  const [pages, setPages] = useState(scene ? formatPages(scene.eighths) : "");
  const [minutes, setMinutes] = useState(scene?.minutesOverride ? String(scene.minutesOverride) : "");
  const [chars, setChars] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const eighths = parsePages(pages);
  const group = groups.find((g) => g.act.actId === actId);
  const autoNumber =
    actId === NEW_ACT ? `${groups.length + 1}.1` : `${group?.index ?? 1}.${(group?.scenes.filter((s) => s.sceneId !== scene?.sceneId).length ?? 0) + 1}`;
  const minutesNum = minutes.trim() ? Number(minutes) : undefined;
  const estimate = sceneMinutes({ eighths: eighths ?? 0 }, props.minutesPerPage);

  // Moving: within its act, by swapping with the neighbouring scene in running order.
  const inAct = scene ? (groups.find((g) => g.act.actId === scene.actId)?.scenes ?? []) : [];
  const pos = scene ? inAct.findIndex((s) => s.sceneId === scene.sceneId) : -1;
  const move = async (delta: number) => {
    if (!scene) return;
    const other = inAct[pos + delta];
    if (!other) return;
    const ids = orderedScenes(bd).map((s) => s.sceneId);
    const a = ids.indexOf(scene.sceneId);
    const b = ids.indexOf(other.sceneId);
    [ids[a], ids[b]] = [ids[b]!, ids[a]!];
    setBusy(true);
    try {
      await api.reorder(props.showId, "scenes", ids);
      await props.onSaved(`Moved ${scene.number} ${delta < 0 ? "earlier" : "later"}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setError(undefined);
    if (!name.trim()) return setError("Give the scene a name.");
    if (eighths === undefined) return setError('Pages should look like "4", "4 3/8" or "4.5".');
    if (minutesNum !== undefined && (!Number.isInteger(minutesNum) || minutesNum < 5 || minutesNum > 600))
      return setError("Minutes should be a whole number from 5 to 600, or blank.");
    if (actId === NEW_ACT && !newAct.trim()) return setError("Name the new act.");
    setBusy(true);
    try {
      let target = actId;
      if (actId === NEW_ACT) target = (await api.createAct(props.showId, newAct.trim())).actId;
      if (scene) {
        await api.updateScene(props.showId, scene.sceneId, {
          actId: target,
          name: name.trim(),
          number: number.trim() || undefined,
          eighths,
          minutesOverride: minutesNum ?? null,
        });
        await props.onSaved(`Saved ${number.trim() || scene.number}`);
      } else {
        const created = await api.createScene(props.showId, {
          actId: target,
          name: name.trim(),
          number: number.trim() || null,
          eighths,
          minutesOverride: minutesNum ?? null,
          characterIds: characters.filter((c) => chars.has(c.charId)).map((c) => c.charId),
        });
        await props.onSaved(`Added ${created.number} ${created.name}`);
      }
      props.onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  if (confirmDelete && scene)
    return (
      <Confirm
        title={`Delete ${scene.number}?`}
        confirmLabel="Delete scene"
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await api.deleteScene(props.showId, scene.sceneId);
          await props.onSaved(`Deleted ${scene.number} ${scene.name}`);
          props.onClose();
        }}
      >
        <p>
          {scene.number} {scene.name} and who's in it will be removed from the breakdown. This can't be undone.
        </p>
      </Confirm>
    );

  return (
    <Dialog title={scene ? `Edit ${scene.number}` : "Add scene"} onClose={props.onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="form-grid">
          <label className="field">
            Act
            <select value={actId} onChange={(e) => setActId(e.target.value)}>
              {groups.map((g) => (
                <option key={g.act.actId} value={g.act.actId}>
                  {g.act.name}
                </option>
              ))}
              <option value={NEW_ACT}>New act...</option>
            </select>
          </label>
          {actId === NEW_ACT ? (
            <label className="field">
              New act name
              <input value={newAct} onChange={(e) => setNewAct(e.target.value)} maxLength={80} />
            </label>
          ) : null}
        </div>
        <label className="field">
          Scene name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Theseus's palace" maxLength={120} autoFocus />
        </label>
        <div className="form-grid">
          <label className="field">
            Number
            <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder={scene ? scene.number : autoNumber} maxLength={20} />
            <span className="hint">{scene ? "Blank keeps the current number." : `Leave blank for ${autoNumber}.`}</span>
          </label>
          <label className="field">
            Pages
            <input value={pages} onChange={(e) => setPages(e.target.value)} placeholder="4 3/8" inputMode="decimal" />
            <span className="hint">In eighths, the way the script counts: 4 3/8.</span>
          </label>
        </div>
        <label className="field">
          <span>
            Rehearsal minutes <span className="hint">(optional)</span>
          </span>
          <input
            value={minutes}
            onChange={(e) => setMinutes(e.target.value.replace(/[^\d]/g, ""))}
            placeholder={String(estimate)}
            inputMode="numeric"
            style={{ maxWidth: 160 }}
          />
          <span className="hint">
            For dances and fights that need more time than their pages. Blank uses the pages: about {estimate} minutes.
          </span>
        </label>
        {!scene && characters.length > 0 && (
          <div className="field">
            Who's in it
            <div className="chips">
              {characters.map((c) => {
                const pressed = chars.has(c.charId);
                return (
                  <button
                    type="button"
                    key={c.charId}
                    className="sp-chip"
                    aria-pressed={pressed}
                    onClick={() => {
                      const next = new Set(chars);
                      if (pressed) next.delete(c.charId);
                      else next.add(c.charId);
                      setChars(next);
                    }}
                  >
                    {pressed && <Icon name="check" size={12} strokeWidth={3.5} />}
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {scene && (
          <div className="sp-dialog-tools">
            <button type="button" className="btn btn-sm" disabled={busy || pos <= 0} onClick={() => void move(-1)}>
              <Icon name="up" size={16} /> Move earlier
            </button>
            <button type="button" className="btn btn-sm" disabled={busy || pos < 0 || pos >= inAct.length - 1} onClick={() => void move(1)}>
              <Icon name="down" size={16} /> Move later
            </button>
          </div>
        )}
        <FormError error={error} />
        <div className="dialog-actions sp-actions-split">
          {scene ? (
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
              Delete scene
            </button>
          ) : (
            <span />
          )}
          <span className="row">
            <button type="button" className="btn" onClick={props.onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving..." : scene ? "Save" : "Add scene"}
            </button>
          </span>
        </div>
      </form>
    </Dialog>
  );
}
