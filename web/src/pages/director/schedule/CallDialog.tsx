import { useMemo, useState, type ReactNode } from "react";
import { longDate, timeRange } from "../../../lib/dates";
import type { BlockBody, CallView, Member, Scene, UpdateCallBody } from "../../../types";
import { Dialog, FormError, Icon, Sheet } from "../../../ui";
import { blockTitle, sortedWarnings, toBodies, toneOf, warningText } from "./model";

interface Props {
  call: CallView;
  /** When set, the dialog opens on this block; otherwise on the call itself. */
  blockId?: string;
  sceneMap: Map<string, Scene>;
  members: Member[];
  phone: boolean;
  onClose: () => void;
  save: (body: UpdateCallBody, message: string) => Promise<boolean>;
  cancelNight: () => Promise<void>;
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

export function CallDialog(props: Props) {
  const { call } = props;
  const [blocks, setBlocks] = useState<BlockBody[]>(() => toBodies(call));
  const [start, setStart] = useState(call.start);
  const [end, setEnd] = useState(call.end);
  const [location, setLocation] = useState(call.location ?? "");
  const [bring, setBring] = useState(call.bring ?? "");
  const [note, setNote] = useState(call.note ?? "");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newMinutes, setNewMinutes] = useState("15");

  const index = props.blockId ? blocks.findIndex((b) => b.blockId === props.blockId) : -1;
  const block = index >= 0 ? blocks[index] : undefined;
  const timed = call.blocks.find((b) => b.blockId === props.blockId);

  const titleOf = (b: BlockBody) => {
    if (b.label) return b.label;
    const t = blockTitle({ label: null, sceneIds: b.sceneIds }, props.sceneMap);
    return `${t.number ? t.number + " " : ""}${t.name}`;
  };
  const title = block ? titleOf(block) : longDate(call.date);

  const setBlock = (patch: Partial<BlockBody>) => setBlocks((bs) => bs.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  const move = (by: -1 | 1) => {
    const j = index + by;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[j]] = [{ ...next[j]!, start: null }, { ...next[index]!, start: null }];
    setBlocks(next);
  };

  const submit = async (body: UpdateCallBody, message: string) => {
    setError(undefined);
    if (body.start && body.end && body.end <= body.start) return setError("The call has to end after it starts.");
    const bad = (body.blocks ?? []).find((b) => !b.minutes || b.minutes < 5 || b.minutes > 600);
    if (bad) return setError("Give each block between 5 and 600 minutes.");
    if ((body.blocks ?? []).some((b) => !b.sceneIds.length && !b.label?.trim())) return setError("Give the block a name, like Warm-up.");
    setSaving(true);
    await props.save(body, message);
    setSaving(false);
  };

  const save = () =>
    submit(
      { start, end, location: orNull(location), bring: orNull(bring), note: orNull(note), blocks: blocks.map((b) => ({ ...b, label: b.label?.trim() || null })) },
      "Saved",
    );

  const removeBlock = () => submit({ blocks: blocks.filter((_, i) => i !== index) }, "Block removed");

  const people = useMemo(
    () => [...props.members].sort((a, b) => (a.role === b.role ? (a.name ?? "").localeCompare(b.name ?? "") : a.role === "cast" ? -1 : 1)),
    [props.members],
  );

  const content: ReactNode = (
    <>
      <p className="sch-dlg-sub">
        {longDate(call.date)} · {timed ? timeRange(timed.start, timed.end) : timeRange(call.start, call.end)}
      </p>

      {block && (
        <section className="stack" aria-label="This block">
          <span className="caps">This block</span>
          {timed && timed.warnings.length > 0 && (
            <div className="sch-dlg-warn">
              {sortedWarnings(timed.warnings).map((w) => (
                <span key={w.userId} className={`sch-t-${toneOf(w)}`}>
                  {warningText(w)}
                  {w.part && w.name ? ` (${w.name})` : ""}
                  {w.note ? `: ${w.note}` : ""}
                </span>
              ))}
            </div>
          )}
          {!block.sceneIds.length && (
            <label className="field">
              Name
              <input value={block.label ?? ""} maxLength={80} placeholder="Warm-up" onChange={(e) => setBlock({ label: e.target.value })} />
            </label>
          )}
          <div className="form-grid">
            <label className="field">
              Minutes
              <input
                type="number"
                min={5}
                max={600}
                step={5}
                value={block.minutes ?? ""}
                onChange={(e) => setBlock({ minutes: e.target.value ? Number(e.target.value) : null })}
              />
            </label>
            <label className="field">
              Starts at
              <input type="time" value={block.start ?? ""} onChange={(e) => setBlock({ start: e.target.value || null })} />
              <span className="hint">Leave blank to follow the block before.</span>
            </label>
          </div>
          <div className="field">
            Also called
            <span className="hint">
              {block.sceneIds.length ? "Anyone needed on top of who's in the scene." : "Who this block needs."}
            </span>
            <div className="chips sch-people">
              {people.map((m) => {
                const on = block.userIds.includes(m.userId);
                return (
                  <button
                    key={m.userId}
                    type="button"
                    className="chip"
                    aria-pressed={on}
                    onClick={() => setBlock({ userIds: on ? block.userIds.filter((u) => u !== m.userId) : [...block.userIds, m.userId] })}
                  >
                    {m.name ?? m.email}
                    {m.title ? ` · ${m.title}` : ""}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="row">
            <button type="button" className="btn btn-sm" disabled={index === 0} onClick={() => move(-1)}>
              <Icon name="up" size={16} /> Earlier
            </button>
            <button type="button" className="btn btn-sm" disabled={index === blocks.length - 1} onClick={() => move(1)}>
              <Icon name="down" size={16} /> Later
            </button>
            <span className="grow" />
            <button type="button" className="btn btn-sm btn-danger" disabled={saving} onClick={() => void removeBlock()}>
              Remove from this night
            </button>
          </div>
        </section>
      )}

      {!block && (
        <section className="stack" aria-label="Blocks">
          <span className="caps">Blocks</span>
          {blocks.length ? (
            <ul className="sch-dlg-blocks">
              {blocks.map((b, i) => (
                <li key={b.blockId ?? `new-${i}`}>
                  <span className="grow">{titleOf(b)}</span>
                  <span className="small muted">{b.minutes ?? "?"} min</span>
                  <button
                    type="button"
                    className="sch-x"
                    aria-label={`Remove ${titleOf(b)}`}
                    onClick={() => setBlocks(blocks.filter((_, k) => k !== i))}
                  >
                    <Icon name="x" size={14} strokeWidth={2.5} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">Nothing scheduled yet.</p>
          )}
          <div className="sch-dlg-add">
            <input className="input input-sm grow" placeholder="Warm-up, notes, music..." value={newLabel} maxLength={80} onChange={(e) => setNewLabel(e.target.value)} aria-label="New block name" />
            <input className="input input-sm sch-dlg-min" type="number" min={5} max={600} step={5} value={newMinutes} onChange={(e) => setNewMinutes(e.target.value)} aria-label="Minutes" />
            <button
              type="button"
              className="btn btn-sm btn-outline"
              disabled={!newLabel.trim()}
              onClick={() => {
                setBlocks([...blocks, { label: newLabel.trim(), minutes: Number(newMinutes) || 15, sceneIds: [], userIds: [], start: null }]);
                setNewLabel("");
              }}
            >
              Add block
            </button>
          </div>
        </section>
      )}

      <section className="stack" aria-label="The call">
        <span className="caps">The call</span>
        <div className="form-grid">
          <label className="field">
            Starts
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
          </label>
          <label className="field">
            Ends
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
          </label>
        </div>
        <label className="field">
          Location
          <input value={location} maxLength={200} placeholder="Rehearsal room, stage..." onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label className="field">
          Bring
          <input value={bring} maxLength={200} placeholder="Scripts, pencils, character shoes" onChange={(e) => setBring(e.target.value)} />
        </label>
        <label className="field">
          Note
          <textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
        </label>
      </section>

      <FormError error={error} />

      {confirmCancel ? (
        <div className="sch-confirm">
          <span>
            {call.publishedAt
              ? "Cancel this night? Everyone called hears about it when you publish the week."
              : "Remove this night's call? Nobody has seen it yet."}
          </span>
          <div className="row">
            <button type="button" className="btn btn-sm" onClick={() => setConfirmCancel(false)}>
              Keep it
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => void props.cancelNight()}>
              {call.publishedAt ? "Cancel the night" : "Remove the call"}
            </button>
          </div>
        </div>
      ) : (
        <div className="sch-dlg-actions">
          {!call.cancelled && (
            <button type="button" className="link-btn sch-cancel-link" onClick={() => setConfirmCancel(true)}>
              Cancel the night
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn" onClick={props.onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      )}
    </>
  );

  return props.phone ? (
    <Sheet title={title} onClose={props.onClose}>
      {content}
    </Sheet>
  ) : (
    <Dialog title={title} onClose={props.onClose}>
      {content}
    </Dialog>
  );
}
