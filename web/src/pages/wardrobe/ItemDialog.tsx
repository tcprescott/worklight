import { useMemo, useState } from "react";
import { api } from "../../api";
import type { ItemKind, ItemSource, ItemStatus, ItemView, Photo, Tracker } from "../../types";
import { Dialog, FormError, Icon } from "../../ui";
import { PhotoStrip } from "./PhotoStrip";
import { SOURCES, STATUS, centsText, isLoan, parseMoney } from "./wardrobeLib";

/** Add or edit one costume piece or prop: who wears or carries it, in which scenes, where it's coming from,
 * what it cost and whether it's ready. */
export function ItemDialog(props: {
  showId: string;
  data: Tracker;
  item?: ItemView;
  kind: ItemKind;
  charId?: string;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const it = props.item;
  const kind = it?.kind ?? props.kind;
  const chars = props.data.characters;
  const sceneOf = useMemo(() => new Map(chars.map((c) => [c.charId, c.sceneIds ?? []])), [chars]);

  const [name, setName] = useState(it?.name ?? "");
  const [charIds, setCharIds] = useState<string[]>(it?.charIds ?? (props.charId ? [props.charId] : []));
  const [sceneIds, setSceneIds] = useState<string[]>(it?.sceneIds ?? (props.charId ? (sceneOf.get(props.charId) ?? []) : []));
  const [status, setStatus] = useState<ItemStatus>(it?.status ?? "needed");
  const [source, setSource] = useState<ItemSource | null>(it?.source ?? null);
  const [lender, setLender] = useState(it?.lender ?? "");
  const [contact, setContact] = useState(it?.lenderContact ?? "");
  const [dueBack, setDueBack] = useState(it?.dueBack ?? "");
  const [cost, setCost] = useState(centsText(it?.costCents));
  const [rental, setRental] = useState(centsText(it?.rentalFeeCents));
  const [deposit, setDeposit] = useState(centsText(it?.depositCents));
  const [depositBack, setDepositBack] = useState(Boolean(it?.depositBackAt));
  const [returned, setReturned] = useState(Boolean(it?.returnedAt));
  const [notes, setNotes] = useState(it?.notes ?? "");
  const [photos, setPhotos] = useState<Photo[]>(it?.photos ?? []);
  const [allScenes, setAllScenes] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loan = isLoan(source);
  const fromStock = source === "stock" && Boolean(it?.stockItemId);

  // Scenes offered: the ones the chosen characters are in, unless asked for all of them.
  const offered = useMemo(() => {
    if (allScenes || charIds.length === 0) return props.data.scenes;
    const ids = new Set(charIds.flatMap((c) => sceneOf.get(c) ?? []));
    for (const s of sceneIds) ids.add(s);
    return props.data.scenes.filter((s) => ids.has(s.sceneId));
  }, [allScenes, charIds, sceneIds, sceneOf, props.data.scenes]);

  const flipChar = (id: string) => {
    const on = charIds.includes(id);
    setCharIds(on ? charIds.filter((x) => x !== id) : [...charIds, id]);
    // Adding a character adds their scenes; taking one away leaves the scenes alone.
    if (!on) setSceneIds((cur) => [...new Set([...cur, ...(sceneOf.get(id) ?? [])])]);
  };
  const flipScene = (id: string) => setSceneIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const save = async () => {
    if (!name.trim()) return setError(kind === "costume" ? "Name the piece, like Grey wool suit." : "Name the prop, like Lantern.");
    const costCents = parseMoney(cost);
    const rentalFeeCents = parseMoney(rental);
    const depositCents = parseMoney(deposit);
    if (costCents === undefined || rentalFeeCents === undefined || depositCents === undefined)
      return setError("Money goes in as dollars, like 40 or 12.50.");
    if (loan && !lender.trim()) return setError(`Say who it's ${source === "rented" ? "rented" : "borrowed"} from.`);
    const order = new Map(props.data.scenes.map((s, i) => [s.sceneId, i]));
    const sortedScenes = [...sceneIds].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    const common = {
      name: name.trim(),
      charIds,
      sceneIds: sortedScenes,
      status,
      source,
      lender: loan ? lender.trim() : null,
      lenderContact: loan ? contact.trim() || null : null,
      dueBack: loan ? dueBack || null : null,
      costCents: loan ? null : costCents,
      rentalFeeCents: source === "rented" ? rentalFeeCents : null,
      depositCents: loan ? depositCents : null,
      notes: notes.trim() || null,
      photoIds: photos.map((p) => p.photoId),
    };
    setBusy(true);
    setError(undefined);
    try {
      if (it) {
        await api.updateItem(props.showId, it.itemId, {
          ...common,
          ...(loan ? { returned, depositBack: depositCents ? depositBack : null } : {}),
        });
        await props.onSaved(`Saved ${common.name}`);
      } else {
        await api.createItem(props.showId, { ...common, kind });
        await props.onSaved(`Added ${common.name}`);
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!it) return;
    setBusy(true);
    try {
      await api.deleteItem(props.showId, it.itemId);
      await props.onSaved(fromStock ? `Removed ${it.name}; it's back in stock` : `Removed ${it.name}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const noun = kind === "costume" ? "costume piece" : "prop";
  return (
    <Dialog title={it ? `Edit ${noun}` : `Add a ${noun}`} onClose={props.onClose} wide>
      <div className="wr-dlg">
        <label className="field">
          {kind === "costume" ? "What is it" : "Prop"}
          <input
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === "costume" ? "Grey wool suit" : "Lantern"}
            autoFocus={!it}
          />
        </label>
        {fromStock && <p className="small muted">Pulled from company stock: {it?.stockName}. Removing it here puts it back in stock.</p>}

        <div className="stack-sm">
          <span className="field">{kind === "costume" ? "Who wears it" : "Who uses it"}</span>
          <div className="chips">
            {chars.map((c) => (
              <button key={c.charId} type="button" className="chip" aria-pressed={charIds.includes(c.charId)} onClick={() => flipChar(c.charId)}>
                {c.name}
              </button>
            ))}
          </div>
          {chars.length === 0 && <span className="small muted">Add characters in Breakdown to tie things to them.</span>}
        </div>

        {props.data.scenes.length > 0 && (
          <div className="stack-sm">
            <span className="field wr-field-row">
              Scenes
              {charIds.length > 0 && (
                <button type="button" className="linkish small" onClick={() => setAllScenes(!allScenes)}>
                  {allScenes ? "Only their scenes" : "Show every scene"}
                </button>
              )}
            </span>
            <div className="chips wr-scene-chips">
              {offered.map((s) => (
                <button
                  key={s.sceneId}
                  type="button"
                  className="chip"
                  title={s.name}
                  aria-pressed={sceneIds.includes(s.sceneId)}
                  onClick={() => flipScene(s.sceneId)}
                >
                  {s.number}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="stack-sm">
          <span className="field">Status</span>
          <div className="segmented" role="group" aria-label="Status">
            {STATUS.map((s) => (
              <button key={s.id} type="button" aria-pressed={status === s.id} onClick={() => setStatus(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          Where it's coming from
          <select
            value={source ?? ""}
            onChange={(e) => setSource((e.target.value || null) as ItemSource | null)}
            disabled={fromStock}
          >
            <option value="">Not decided</option>
            {SOURCES.filter((s) => s.id !== "stock" || fromStock).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        {loan && (
          <div className="wr-loan">
            <div className="wr-two">
              <label className="field">
                {source === "rented" ? "Rented from" : "Borrowed from"}
                <input
                  value={lender}
                  maxLength={120}
                  list="wr-lenders"
                  onChange={(e) => setLender(e.target.value)}
                  placeholder="Costume Barn"
                />
                <datalist id="wr-lenders">
                  {props.data.lenders.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
              </label>
              <label className="field">
                Due back
                <input type="date" value={dueBack} onChange={(e) => setDueBack(e.target.value)} />
              </label>
            </div>
            <label className="field">
              Contact <span className="hint">Optional, like a name and phone number</span>
              <input value={contact} maxLength={200} onChange={(e) => setContact(e.target.value)} />
            </label>
            <div className="wr-two">
              {source === "rented" && (
                <label className="field">
                  Rental fee
                  <MoneyInput value={rental} onChange={setRental} />
                </label>
              )}
              <label className="field">
                Deposit
                <MoneyInput value={deposit} onChange={setDeposit} />
              </label>
            </div>
            {it && (
              <div className="row wr-checks">
                {parseMoney(deposit) ? (
                  <label className="check">
                    <input type="checkbox" checked={depositBack} onChange={(e) => setDepositBack(e.target.checked)} />
                    Deposit back
                  </label>
                ) : null}
                <label className="check">
                  <input type="checkbox" checked={returned} onChange={(e) => setReturned(e.target.checked)} />
                  Returned
                </label>
              </div>
            )}
            <p className="small muted">
              <Icon name="check" size={14} /> It goes on the strike checklist as a return to {lender.trim() || "the lender"}.
            </p>
          </div>
        )}
        {(source === "bought" || source === "built") && (
          <label className="field">
            {source === "built" ? "Materials cost" : "Cost"}
            <MoneyInput value={cost} onChange={setCost} />
          </label>
        )}

        <PhotoStrip
          label="Photos"
          photos={photos}
          onChange={setPhotos}
          upload={(blob) => api.uploadShowPhoto(props.showId, blob)}
        />

        <label className="field">
          Notes <span className="hint">Optional, like alterations or "needs a quick-change zip"</span>
          <textarea value={notes} maxLength={1000} rows={2} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <FormError error={error} />
      <div className="dialog-actions wr-dlg-actions">
        {it &&
          (confirmDelete ? (
            <button className="btn btn-danger" disabled={busy} onClick={() => void remove()}>
              Yes, remove it
            </button>
          ) : (
            <button className="btn" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" size={16} /> Remove
            </button>
          ))}
        <span className="grow" />
        <button className="btn" onClick={props.onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving..." : it ? "Save" : "Add"}
        </button>
      </div>
    </Dialog>
  );
}

function MoneyInput(props: { value: string; onChange: (v: string) => void }) {
  return (
    <span className="wr-money-in">
      <span aria-hidden="true">$</span>
      <input inputMode="decimal" value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder="0" />
    </span>
  );
}
