import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { Link } from "../../router";
import { CompanyShell } from "../../shell";
import type { ItemKind, Photo, StockItemView } from "../../types";
import { Dialog, ErrorView, FormError, Icon, Loading, useToast } from "../../ui";
import { useAsync } from "../../useAsync";
import { PhotoStrip, Thumb } from "./PhotoStrip";
import "./wardrobe.css";

/** The company's costume and props stock, which carries over from show to show. Keepers add and edit it;
 * admins and people with costume or props access on a show can look. */
export function StockPage(props: { theaterId: string }) {
  const { data, error, reload } = useAsync(() => api.stock(props.theaterId), [props.theaterId]);
  const [kind, setKind] = useState<ItemKind>("costume");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>();
  const [editing, setEditing] = useState<StockItemView | "new">();
  const [toast, showToast] = useToast();

  // Someone who only keeps props starts on props.
  useEffect(() => {
    const r = data?.rights;
    if (r && kind === "costume" && !r.viewCostumes && r.viewProps) setKind("prop");
  }, [data, kind]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.items ?? [])
      .filter((i) => i.kind === kind)
      .filter((i) => !category || i.category === category)
      .filter((i) => !q || [i.name, i.category, i.size, i.location, i.notes].some((v) => v?.toLowerCase().includes(q)));
  }, [data, kind, category, query]);

  if (error)
    return (
      <CompanyShell>
        <ErrorView message={error} />
      </CompanyShell>
    );
  if (!data)
    return (
      <CompanyShell>
        <Loading />
      </CompanyShell>
    );

  const r = data.rights;
  const canEdit = kind === "costume" ? r.editCostumes : r.editProps;
  const kinds = (["costume", "prop"] as const).filter((k) => (k === "costume" ? r.viewCostumes : r.viewProps));
  const cats = [...new Set(data.items.filter((i) => i.kind === kind && i.category).map((i) => i.category!))].sort();
  const out = data.items.filter((i) => i.kind === kind && i.inShowId).length;

  return (
    <CompanyShell context={data.theaterName}>
      <main className="page wr-page">
        <div className="wr-head">
          <Link to={`/c/${props.theaterId}`} className="small">
            ← Company home
          </Link>
          <span className="kicker">Company stock</span>
          <h1 className="title-md">Costumes and props</h1>
          <p className="small muted">
            Everything the company owns. Pull pieces into a show from its tracker; they come back here at strike.
          </p>
        </div>
        {kinds.length > 1 && (
          <div className="segmented wr-tabs" role="group" aria-label="Kind">
            {kinds.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => {
                  setKind(k);
                  setCategory(undefined);
                }}
              >
                {k === "costume" ? "Costumes" : "Props"}
              </button>
            ))}
          </div>
        )}
        <div className="wr-bar">
          <input
            className="wr-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, size, rack or bin"
            aria-label="Search stock"
          />
          <span className="small muted">{out > 0 && `${out} out with shows`}</span>
          {canEdit && (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditing("new")}>
              <Icon name="plus" size={16} /> Add to stock
            </button>
          )}
        </div>
        {cats.length > 0 && (
          <div className="chips">
            <button type="button" className="chip" aria-pressed={!category} onClick={() => setCategory(undefined)}>
              All
            </button>
            {cats.map((c) => (
              <button key={c} type="button" className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
          </div>
        )}
        <div className="wr-stock-grid">
          {shown.map((i) => (
            <button
              key={i.itemId}
              type="button"
              className="wr-stock-card"
              onClick={() => canEdit && setEditing(i)}
              disabled={!canEdit}
            >
              <span className="wr-stock-pic">
                {i.photos?.[0] ? <img src={i.photos[0].url} alt="" loading="lazy" /> : <Thumb photos={[]} kind={i.kind} />}
              </span>
              <span className="wr-item-name">{i.name}</span>
              <span className="wr-item-meta">{[i.size, i.location].filter(Boolean).join(" · ") || i.category}</span>
              {i.inShowId && <span className="wr-st pulled">Out with {i.inShowName ?? "a show"}</span>}
            </button>
          ))}
        </div>
        {shown.length === 0 && (
          <div className="empty">
            <strong>{data.items.length === 0 ? "No stock yet" : "Nothing matches"}</strong>
            <span>
              {data.items.length === 0
                ? canEdit
                  ? "Add the pieces the company owns, with a photo and where they're kept."
                  : "The company's keepers add what the company owns here."
                : "Try another word or category."}
            </span>
          </div>
        )}
      </main>
      {editing && (
        <StockDialog
          theaterId={props.theaterId}
          kind={kind}
          item={editing === "new" ? undefined : editing}
          categories={cats}
          onClose={() => setEditing(undefined)}
          onSaved={async (message) => {
            setEditing(undefined);
            await reload();
            showToast(message);
          }}
        />
      )}
      {toast}
    </CompanyShell>
  );
}

function StockDialog(props: {
  theaterId: string;
  kind: ItemKind;
  item?: StockItemView;
  categories: string[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const it = props.item;
  const kind = it?.kind ?? props.kind;
  const [name, setName] = useState(it?.name ?? "");
  const [category, setCategory] = useState(it?.category ?? "");
  const [size, setSize] = useState(it?.size ?? "");
  const [location, setLocation] = useState(it?.location ?? "");
  const [notes, setNotes] = useState(it?.notes ?? "");
  const [photos, setPhotos] = useState<Photo[]>(it?.photos ?? []);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async () => {
    if (!name.trim()) return setError("Give it a name, like Black tailcoat.");
    const body = {
      name: name.trim(),
      category: category.trim() || null,
      size: size.trim() || null,
      location: location.trim() || null,
      notes: notes.trim() || null,
      photoIds: photos.map((p) => p.photoId),
    };
    setBusy(true);
    setError(undefined);
    try {
      if (it) await api.updateStock(props.theaterId, it.itemId, body);
      else await api.createStock(props.theaterId, { ...body, kind });
      await props.onSaved(it ? `Saved ${body.name}` : `Added ${body.name} to stock`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!it) return;
    setBusy(true);
    try {
      await api.deleteStock(props.theaterId, it.itemId);
      await props.onSaved(`Removed ${it.name} from stock`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog title={it ? "Edit stock item" : kind === "costume" ? "Add a costume to stock" : "Add a prop to stock"} onClose={props.onClose}>
      <label className="field">
        Name
        <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoFocus={!it} />
      </label>
      <div className="wr-two">
        <label className="field">
          Category <span className="hint">Like Coats or Hand props</span>
          <input value={category} maxLength={60} list="wr-cats" onChange={(e) => setCategory(e.target.value)} />
          <datalist id="wr-cats">
            {props.categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="field">
          Size
          <input value={size} maxLength={40} onChange={(e) => setSize(e.target.value)} />
        </label>
      </div>
      <label className="field">
        Where it's kept <span className="hint">Like Rack B or Bin 12</span>
        <input value={location} maxLength={120} onChange={(e) => setLocation(e.target.value)} />
      </label>
      <PhotoStrip label="Photos" photos={photos} onChange={setPhotos} upload={(blob) => api.uploadStockPhoto(props.theaterId, blob)} />
      <label className="field">
        Notes
        <textarea value={notes} maxLength={1000} rows={2} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {it?.inShowId && <p className="small muted">Out with {it.inShowName ?? "a show"} right now.</p>}
      <FormError error={error} />
      <div className="dialog-actions wr-dlg-actions">
        {it &&
          !it.inShowId &&
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
