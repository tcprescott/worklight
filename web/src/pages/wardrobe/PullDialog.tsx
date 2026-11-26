import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import type { ItemKind, Stock, StockItemView, Tracker } from "../../types";
import { Dialog, ErrorView, FormError, Loading } from "../../ui";
import { Thumb } from "./PhotoStrip";

/** Pick something from company stock and put it on this show's list. It's marked as out with this show
 * until the show's strike puts it back. */
export function PullDialog(props: {
  showId: string;
  theaterId: string;
  data: Tracker;
  kind: ItemKind;
  onClose: () => void;
  onPulled: (name: string) => Promise<void>;
}) {
  const [stock, setStock] = useState<Stock>();
  const [loadError, setLoadError] = useState<string>();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<StockItemView>();
  const [charIds, setCharIds] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .stock(props.theaterId)
      .then(setStock)
      .catch((e: Error) => setLoadError(e.message));
  }, [props.theaterId]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (stock?.items ?? [])
      .filter((i) => i.kind === props.kind)
      .filter((i) => !q || [i.name, i.category, i.size, i.location].some((v) => v?.toLowerCase().includes(q)));
  }, [stock, query, props.kind]);

  const sceneOf = new Map(props.data.characters.map((c) => [c.charId, c.sceneIds ?? []]));
  const flip = (id: string) => setCharIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const pull = async () => {
    if (!picked) return;
    setBusy(true);
    setError(undefined);
    try {
      const sceneIds = [...new Set(charIds.flatMap((c) => sceneOf.get(c) ?? []))];
      await api.pullFromStock(props.showId, { stockItemId: picked.itemId, charIds, sceneIds });
      await props.onPulled(picked.name);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  let body;
  if (loadError) body = <ErrorView message={loadError} />;
  else if (!stock) body = <Loading />;
  else if (picked)
    body = (
      <div className="stack">
        <div className="wr-item static">
          <Thumb photos={picked.photos ?? []} kind={picked.kind} />
          <span className="wr-item-body">
            <span className="wr-item-name">{picked.name}</span>
            <span className="wr-item-meta">{[picked.size, picked.location].filter(Boolean).join(" · ")}</span>
          </span>
        </div>
        <div className="stack-sm">
          <span className="field">{props.kind === "costume" ? "Who wears it" : "Who uses it"}</span>
          <div className="chips">
            {props.data.characters.map((c) => (
              <button key={c.charId} type="button" className="chip" aria-pressed={charIds.includes(c.charId)} onClick={() => flip(c.charId)}>
                {c.name}
              </button>
            ))}
          </div>
          <span className="small muted">Their scenes are filled in for you. You can change them after.</span>
        </div>
      </div>
    );
  else
    body = (
      <div className="stack">
        <label className="field">
          Search {stock.theaterName} stock
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, size, rack or bin" autoFocus />
        </label>
        <div className="wr-pick-list">
          {shown.map((i) => {
            const out = Boolean(i.inShowId);
            return (
              <button key={i.itemId} type="button" className="wr-item" disabled={out} onClick={() => setPicked(i)}>
                <Thumb photos={i.photos ?? []} kind={i.kind} />
                <span className="wr-item-body">
                  <span className="wr-item-name">{i.name}</span>
                  <span className="wr-item-meta">
                    {[i.category, i.size, i.location].filter(Boolean).join(" · ")}
                    {out && <span className="wr-due">Out with {i.inShowName ?? "another show"}</span>}
                  </span>
                </span>
              </button>
            );
          })}
          {shown.length === 0 && (
            <div className="empty">
              <strong>Nothing matches</strong>
              <span>
                {stock.items.length === 0
                  ? "The company's costume and props keepers add things to stock."
                  : "Try another word, or add it as a new item instead."}
              </span>
            </div>
          )}
        </div>
      </div>
    );

  return (
    <Dialog title="Pull from company stock" onClose={props.onClose} wide>
      {body}
      <FormError error={error} />
      <div className="dialog-actions">
        {picked && (
          <button className="btn" onClick={() => setPicked(undefined)}>
            Back
          </button>
        )}
        <span className="grow" />
        <button className="btn" onClick={props.onClose}>
          Cancel
        </button>
        {picked && (
          <button className="btn btn-primary" disabled={busy} onClick={() => void pull()}>
            {busy ? "Pulling..." : "Pull for this show"}
          </button>
        )}
      </div>
    </Dialog>
  );
}
