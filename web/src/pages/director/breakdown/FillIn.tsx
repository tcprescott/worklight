import { useState } from "react";
import { api } from "../../../api";
import { pageLabel } from "../../../lib/pages";
import type { Act, Breakdown, Character, Scene } from "../../../types";
import { Icon } from "../../../ui";
import { errorText } from "./Confirm";
import { actName, groupActs, key, orderedCharacters, plural, type ActGroup } from "./model";

export interface FillInProps {
  showId: string;
  bd: Breakdown;
  on: Set<string>;
  readOnly: boolean;
  onlyIn: boolean;
  toggle: (sceneId: string, charId: string) => void;
  editScene: (scene: Scene) => void;
  addScene: (actId?: string) => void;
  editAct: (act?: Act) => void;
  openCharacters: () => void;
  onSaved: (message: string) => Promise<void> | void;
}

function sceneMeta(s: Scene, chars: Character[], on: Set<string>) {
  const n = chars.filter((c) => on.has(key(s.sceneId, c.charId))).length;
  return `${pageLabel(s.eighths)} · ${plural(n, "character")}`;
}

function Chip(props: { name: string; pressed: boolean; readOnly: boolean; onClick: () => void; phone?: boolean }) {
  return (
    <button
      type="button"
      className={props.phone ? "sp-chip sp-chip-phone" : "sp-chip"}
      aria-pressed={props.pressed}
      disabled={props.readOnly}
      onClick={props.onClick}
    >
      {props.pressed && !props.phone && <Icon name="check" size={12} strokeWidth={3.5} />}
      {props.name}
    </button>
  );
}

/** Web: every act, scene cards two to a row. */
export function FillInWeb(props: FillInProps) {
  const groups = groupActs(props.bd);
  const chars = orderedCharacters(props.bd);
  if (!groups.length) return <StartActs {...props} />;
  return (
    <>
      {!chars.length && <NoCharacters {...props} />}
      {groups.map((g) => (
        <section key={g.act.actId} className="sp-act">
          <div className="sp-act-head">
            <h2 className="sp-act-title">{g.act.name}</h2>
            {!props.readOnly && (
              <span className="sp-act-tools">
                <button className="sp-text-action" onClick={() => props.addScene(g.act.actId)}>
                  Add scene
                </button>
                <button className="sp-text-action" onClick={() => props.editAct(g.act)}>
                  Edit act
                </button>
              </span>
            )}
          </div>
          <div className="sp-scene-grid">
            {g.scenes.map((s) => (
              <article key={s.sceneId} className="sp-scene">
                <div className="sp-scene-head">
                  <span className="sp-scene-num">{s.number}</span>
                  <span className="sp-scene-name">{s.name}</span>
                  <span className="sp-scene-meta">{sceneMeta(s, chars, props.on)}</span>
                  {!props.readOnly && (
                    <button className="sp-text-action sp-scene-edit" onClick={() => props.editScene(s)} aria-label={`Edit scene ${s.number}`}>
                      Edit
                    </button>
                  )}
                </div>
                <SceneChips {...props} scene={s} chars={chars} />
              </article>
            ))}
            {!props.readOnly && g.scenes.length === 0 && (
              <button className="sp-add-card" onClick={() => props.addScene(g.act.actId)}>
                <Icon name="plus" size={18} /> Add a scene to {g.act.name}
              </button>
            )}
          </div>
        </section>
      ))}
      {!props.readOnly && (
        <div className="row">
          <button className="btn btn-dashed" onClick={() => props.editAct()}>
            <Icon name="plus" size={18} /> Add act
          </button>
        </div>
      )}
    </>
  );
}

function SceneChips(props: FillInProps & { scene: Scene; chars: Character[]; phone?: boolean }) {
  const { scene, chars } = props;
  if (!chars.length) return <p className="small sp-faint">No characters yet.</p>;
  const shown = props.onlyIn ? chars.filter((c) => props.on.has(key(scene.sceneId, c.charId))) : chars;
  if (!shown.length) return <p className="small sp-faint">Nobody in this scene yet.</p>;
  return (
    <div className="chips">
      {shown.map((c) => (
        <Chip
          key={c.charId}
          name={c.name}
          phone={props.phone}
          pressed={props.on.has(key(scene.sceneId, c.charId))}
          readOnly={props.readOnly}
          onClick={() => props.toggle(scene.sceneId, c.charId)}
        />
      ))}
    </div>
  );
}

/** Phone: act chips, then that act's scene cards. */
export function FillInPhone(props: FillInProps) {
  const groups = groupActs(props.bd);
  const chars = orderedCharacters(props.bd);
  const [actId, setActId] = useState<string>();
  if (!groups.length) return <StartActs {...props} />;
  const current: ActGroup = groups.find((g) => g.act.actId === actId) ?? groups[0]!;
  return (
    <>
      <div className="sp-act-chips" role="group" aria-label="Acts">
        {groups.map((g) => (
          <button key={g.act.actId} className="sp-pill" aria-pressed={g === current} onClick={() => setActId(g.act.actId)}>
            Act {g.index}
          </button>
        ))}
      </div>
      {!chars.length && <NoCharacters {...props} />}
      {current.scenes.length === 0 && <p className="sp-muted-box">{current.act.name} has no scenes yet.</p>}
      {current.scenes.map((s) => (
        <article key={s.sceneId} className="sp-mscene">
          <div className="spread">
            <div className="stack-sm sp-gap-2">
              <span className="sp-mscene-name">
                {s.number} {s.name}
              </span>
              <span className="sp-mscene-meta">
                {sceneMeta(s, chars, props.on)}
                {!props.readOnly && chars.length > 0 && " · tap to add or remove"}
              </span>
            </div>
            {!props.readOnly && (
              <button className="sp-text-action sp-touch" onClick={() => props.editScene(s)} aria-label={`Edit scene ${s.number}`}>
                Edit
              </button>
            )}
          </div>
          <SceneChips {...props} scene={s} chars={chars} phone />
        </article>
      ))}
      {!props.readOnly && (
        <div className="stack-sm">
          <button className="btn btn-dashed btn-block" onClick={() => props.addScene(current.act.actId)}>
            <Icon name="plus" size={18} /> Add a scene to {current.act.name}
          </button>
          <div className="sp-phone-tools">
            <button className="btn" onClick={() => props.editAct(current.act)}>
              Edit {current.act.name}
            </button>
            <button className="btn" onClick={() => props.editAct()}>
              Add act
            </button>
          </div>
          <button className="btn btn-block" onClick={props.openCharacters}>
            Characters and casting
          </button>
        </div>
      )}
    </>
  );
}

/** A brand-new show: no acts yet. */
function StartActs(props: FillInProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (props.readOnly) return <div className="empty">This show has no scenes.</div>;
  const quickAdd = async (n: number) => {
    setBusy(true);
    setError(undefined);
    try {
      for (let i = 1; i <= n; i++) await api.createAct(props.showId, actName(i));
      await props.onSaved(n === 1 ? "Added Act One" : `Added Act One to ${actName(n)}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sp-start">
      <span className="sp-step">Step 1</span>
      <h2 className="title-sm">Start with your acts and scenes</h2>
      <p className="lede">
        Make the acts first, then add each scene with its page count. After that, tap the characters who are in each one.
        The schedule uses this to call only who's needed.
      </p>
      <div className="stack-sm">
        <span className="small sp-strong">How many acts?</span>
        <div className="chips">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className="btn" disabled={busy} onClick={() => void quickAdd(n)}>
              {n === 1 ? "Act One only" : `Act One to ${actName(n)}`}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <button className="btn btn-dashed" disabled={busy} onClick={() => props.editAct()}>
          <Icon name="plus" size={18} /> Add an act by name
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={() => props.addScene()}>
          Add scene
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {!orderedCharacters(props.bd).length && (
        <p className="small muted">
          Next you'll add the characters.{" "}
          <button className="link-btn" onClick={props.openCharacters}>
            Add characters now
          </button>
        </p>
      )}
    </div>
  );
}

function NoCharacters(props: FillInProps) {
  if (props.readOnly) return null;
  return (
    <div className="sp-start sp-start-row">
      <div className="grow stack-sm">
        <h2 className="sp-start-title">Add the characters</h2>
        <p className="small muted">List everyone who appears, then tap them into each scene. You can cast people at the same time.</p>
      </div>
      <button className="btn btn-primary" onClick={props.openCharacters}>
        Add characters
      </button>
    </div>
  );
}
