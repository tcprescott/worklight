import { useState } from "react";
import { api } from "../../../api";
import type { Act, Breakdown } from "../../../types";
import { Dialog, FormError, Icon } from "../../../ui";
import { Confirm, errorText } from "./Confirm";
import { actName, groupActs, plural } from "./model";

/** Add an act, or rename / move / delete one. */
export function ActDialog(props: {
  showId: string;
  bd: Breakdown;
  act?: Act;
  onClose: () => void;
  onSaved: (message: string) => Promise<void> | void;
}) {
  const groups = groupActs(props.bd);
  const { act } = props;
  const [name, setName] = useState(act?.name ?? actName(groups.length + 1));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pos = act ? groups.findIndex((g) => g.act.actId === act.actId) : -1;
  const sceneCount = pos >= 0 ? groups[pos]!.scenes.length : 0;

  const move = async (delta: number) => {
    const ids = groups.map((g) => g.act.actId);
    const other = pos + delta;
    if (other < 0 || other >= ids.length) return;
    [ids[pos], ids[other]] = [ids[other]!, ids[pos]!];
    setBusy(true);
    try {
      await api.reorder(props.showId, "acts", ids);
      await props.onSaved(`Moved ${act!.name}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!name.trim()) return setError("Give the act a name.");
    setBusy(true);
    setError(undefined);
    try {
      if (act) await api.updateAct(props.showId, act.actId, name.trim());
      else await api.createAct(props.showId, name.trim());
      await props.onSaved(act ? `Renamed to ${name.trim()}` : `Added ${name.trim()}`);
      props.onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  if (confirmDelete && act)
    return (
      <Confirm
        title={`Delete ${act.name}?`}
        confirmLabel={sceneCount ? `Delete act and ${plural(sceneCount, "scene")}` : "Delete act"}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await api.deleteAct(props.showId, act.actId);
          await props.onSaved(`Deleted ${act.name}`);
          props.onClose();
        }}
      >
        <p>
          {sceneCount
            ? `This deletes ${act.name} and its ${plural(sceneCount, "scene")}, with who's in each. This can't be undone.`
            : `${act.name} has no scenes. This can't be undone.`}
        </p>
      </Confirm>
    );

  return (
    <Dialog title={act ? `Edit ${act.name}` : "Add act"} onClose={props.onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="field">
          Act name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
        </label>
        {act && groups.length > 1 && (
          <div className="sp-dialog-tools">
            <button type="button" className="btn btn-sm" disabled={busy || pos <= 0} onClick={() => void move(-1)}>
              <Icon name="up" size={16} /> Move earlier
            </button>
            <button type="button" className="btn btn-sm" disabled={busy || pos >= groups.length - 1} onClick={() => void move(1)}>
              <Icon name="down" size={16} /> Move later
            </button>
          </div>
        )}
        <FormError error={error} />
        <div className="dialog-actions sp-actions-split">
          {act ? (
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
              Delete act
            </button>
          ) : (
            <span />
          )}
          <span className="row">
            <button type="button" className="btn" onClick={props.onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving..." : act ? "Save" : "Add act"}
            </button>
          </span>
        </div>
      </form>
    </Dialog>
  );
}
