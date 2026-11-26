import { useCallback, useEffect, useMemo, useState } from "react";
import type { ShowPageProps } from "../../App";
import { api } from "../../api";
import { shortDate, time12 } from "../../lib/dates";
import { Link, navigate } from "../../router";
import { ActorShell, StaffShell } from "../../shell";
import type { CharacterRow, ItemKind, ItemView, SheetRow, Tracker as TrackerData } from "../../types";
import { ErrorView, Icon, Loading, useToast } from "../../ui";
import { ItemDialog } from "./ItemDialog";
import { Thumb } from "./PhotoStrip";
import { PullDialog } from "./PullDialog";
import { STATUS_LABEL, money, sceneList, sourceLine } from "./wardrobeLib";
import "./wardrobe.css";

type Tab = "costumes" | "props" | "measurements" | "money";
const TAB_PATH: Record<Tab, string> = { costumes: "", props: "/props", measurements: "/measurements", money: "/money" };

/** The costume and props tracker: one block per character with what they wear and carry, plus the cast's
 * measurement forms and the money. Staff see it in their show nav; crew with access see it in theirs. */
export function WardrobePage(props: ShowPageProps) {
  const view = props.view;
  const showId = view.show.showId;
  const staff = view.role === "staff";
  const tab: Tab = (["props", "measurements", "money"] as const).find((t) => t === props.sub) ?? "costumes";
  const [data, setData] = useState<TrackerData>();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<{ item?: ItemView; kind: ItemKind; charId?: string }>();
  const [pulling, setPulling] = useState<{ kind: ItemKind; charId?: string }>();
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    try {
      setData(await api.tracker(showId));
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [showId]);
  useEffect(() => void load(), [load]);

  const kind: ItemKind = tab === "props" ? "prop" : "costume";
  const tabs: { id: Tab; label: string }[] = [
    { id: "costumes", label: "Costumes" },
    { id: "props", label: "Props" },
    ...(data?.canSeeMeasurements ? [{ id: "measurements" as Tab, label: "Measurements" }] : []),
    { id: "money", label: "Money" },
  ];

  let body;
  if (error && !data) body = <ErrorView message={error} onRetry={() => void load()} />;
  else if (!data) body = <Loading />;
  else {
    const canEdit = kind === "costume" ? data.canEditCostumes : data.canEditProps;
    const counts = kind === "costume" ? data.costumes : data.props;
    body = (
      <main className="page wr-page">
        <div className="wr-head">
          <span className="kicker">Costumes and props</span>
          <h1 className="title-md">{view.show.name}</h1>
          {!data.canEditCostumes && !data.canEditProps && staff && (
            <p className="small muted">
              You can look but not change anything. Tick Costume access or Props access on someone in{" "}
              <Link to={`/shows/${showId}/people`}>People</Link> (yourself included) to let them manage it.
            </p>
          )}
        </div>
        <nav className="segmented wr-tabs" aria-label="Tracker">
          {tabs.map((t) => (
            <Link key={t.id} to={`/shows/${showId}/costumes${TAB_PATH[t.id]}`} current={t.id === tab}>
              {t.label}
            </Link>
          ))}
        </nav>

        {(tab === "costumes" || tab === "props") && (
          <>
            <div className="wr-bar">
              <span className="wr-counts">
                <b>{counts.total}</b> {kind === "costume" ? "costume pieces" : "props"}
                {counts.needed > 0 && <span className="wr-st needed">{counts.needed} needed</span>}
                {counts.building > 0 && <span className="wr-st building">{counts.building} building</span>}
                {counts.pulled > 0 && <span className="wr-st pulled">{counts.pulled} pulled</span>}
                {counts.ready > 0 && <span className="wr-st ready">{counts.ready} ready</span>}
              </span>
              {canEdit && (
                <span className="row">
                  <button type="button" className="btn btn-sm" onClick={() => setPulling({ kind })}>
                    Pull from stock
                  </button>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditing({ kind })}>
                    <Icon name="plus" size={16} /> Add {kind === "costume" ? "a costume piece" : "a prop"}
                  </button>
                </span>
              )}
            </div>
            <ByCharacter
              data={data}
              kind={kind}
              canEdit={canEdit}
              showId={showId}
              onOpen={(item) => setEditing({ item, kind })}
              onAdd={(charId) => setEditing({ kind, charId })}
            />
          </>
        )}
        {tab === "measurements" && <MeasurementList showId={showId} />}
        {tab === "money" && <MoneyTab data={data} />}
      </main>
    );
  }

  const dialogs = (
    <>
      {editing && data && (
        <ItemDialog
          showId={showId}
          data={data}
          item={editing.item}
          kind={editing.kind}
          charId={editing.charId}
          onClose={() => setEditing(undefined)}
          onSaved={async (message) => {
            setEditing(undefined);
            await load();
            showToast(message);
          }}
        />
      )}
      {pulling && data && (
        <PullDialog
          showId={showId}
          theaterId={view.show.theaterId}
          data={data}
          kind={pulling.kind}
          onClose={() => setPulling(undefined)}
          onPulled={async (name) => {
            setPulling(undefined);
            await load();
            showToast(`Pulled ${name} from stock`);
          }}
        />
      )}
      {toast}
    </>
  );

  if (staff)
    return (
      <StaffShell view={view} current="costumes">
        {body}
        {dialogs}
      </StaffShell>
    );
  return (
    <ActorShell showId={showId} current="show" archived={view.show.status === "archived"}>
      {body}
      {dialogs}
    </ActorShell>
  );
}

function castLine(c: CharacterRow): string {
  if (c.cast.length === 0) return "Not cast yet";
  if (c.ensemble && c.cast.length > 2) return `${c.cast.length} people`;
  return c.cast.map((p) => p.name ?? "Someone").join(", ");
}

function ByCharacter(props: {
  data: TrackerData;
  kind: ItemKind;
  canEdit: boolean;
  showId: string;
  onOpen: (item: ItemView) => void;
  onAdd: (charId?: string) => void;
}) {
  const { data, kind } = props;
  const items = useMemo(() => data.items.filter((i) => i.kind === kind), [data.items, kind]);
  const fittingFor = useMemo(() => new Map(data.fittings.map((f) => [f.userId, f])), [data.fittings]);
  const loose = items.filter((i) => i.charIds.length === 0);
  // Characters with something first, in script order; the rest after, so new items are easy to add.
  const rows = data.characters.map((c) => ({ c, items: items.filter((i) => i.charIds.includes(c.charId)) }));
  const withItems = rows.filter((r) => r.items.length > 0);
  const without = rows.filter((r) => r.items.length === 0);

  if (items.length === 0 && !props.canEdit)
    return (
      <div className="empty">
        <strong>No {kind === "costume" ? "costumes" : "props"} on the list yet</strong>
        <span>People with {kind === "costume" ? "costume" : "props"} access add them here, character by character.</span>
      </div>
    );

  return (
    <div className="wr-groups">
      {withItems.map(({ c, items: mine }) => {
        const fitting = c.cast.map((p) => fittingFor.get(p.userId)).find(Boolean);
        return (
          <section key={c.charId} className="wr-group" aria-label={c.name}>
            <h2 className="wr-group-head">
              <span className="wr-group-name">{c.name}</span>
              <span className="wr-group-who">{castLine(c)}</span>
              {kind === "costume" && fitting && (
                <span className="wr-group-fit">
                  Fitting {shortDate(fitting.date)}, {time12(fitting.start)}
                </span>
              )}
              {kind === "costume" && data.canSeeMeasurements && c.cast.length === 1 && (
                <Link className="wr-group-link" to={`/shows/${props.showId}/measurements/${c.cast[0]!.userId}`}>
                  <Icon name="ruler" size={16} /> Measurements
                </Link>
              )}
            </h2>
            {mine.map((i) => (
              <ItemRow key={i.itemId} item={i} data={data} onOpen={props.canEdit ? () => props.onOpen(i) : undefined} />
            ))}
            {props.canEdit && (
              <button type="button" className="wr-add-here" onClick={() => props.onAdd(c.charId)}>
                <Icon name="plus" size={16} /> Add for {c.name}
              </button>
            )}
          </section>
        );
      })}
      {loose.length > 0 && (
        <section className="wr-group" aria-label="Not for one character">
          <h2 className="wr-group-head">
            <span className="wr-group-name">Not for one character</span>
            <span className="wr-group-who">Set dressing, shared pieces</span>
          </h2>
          {loose.map((i) => (
            <ItemRow key={i.itemId} item={i} data={data} onOpen={props.canEdit ? () => props.onOpen(i) : undefined} />
          ))}
        </section>
      )}
      {props.canEdit && without.length > 0 && (
        <section className="wr-group wr-group-empty" aria-label="Nothing yet">
          <h2 className="wr-group-head">
            <span className="wr-group-name">Nothing yet</span>
          </h2>
          <div className="chips wr-empty-chars">
            {without.map(({ c }) => (
              <button key={c.charId} type="button" className="chip chip-dashed" onClick={() => props.onAdd(c.charId)}>
                <Icon name="plus" size={14} /> {c.name}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ItemRow(props: { item: ItemView; data: TrackerData; onOpen?: () => void }) {
  const i = props.item;
  const source = sourceLine(i);
  const scenes = sceneList(i.sceneIds, props.data.scenes);
  return (
    <button
      type="button"
      className={`wr-item${i.returnedAt ? " returned" : ""}${props.onOpen ? "" : " readonly"}`}
      onClick={props.onOpen}
      disabled={!props.onOpen}
    >
      <Thumb photos={i.photos ?? []} kind={i.kind} />
      <span className="wr-item-body">
        <span className="wr-item-name">{i.name}</span>
        <span className="wr-item-meta">
          {scenes && <span className="wr-scenes">{scenes}</span>}
          {source && <span className={i.source === "rented" || i.source === "borrowed" ? "wr-src loan" : "wr-src"}>{source}</span>}
          {i.dueBack && !i.returnedAt && <span className="wr-due">Back by {shortDate(i.dueBack)}</span>}
        </span>
      </span>
      {i.returnedAt ? <span className="wr-st returned">Returned</span> : <span className={`wr-st ${i.status}`}>{STATUS_LABEL[i.status]}</span>}
    </button>
  );
}

function MeasurementList(props: { showId: string }) {
  const [rows, setRows] = useState<SheetRow[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api
      .measurementSheets(props.showId)
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, [props.showId]);
  if (error) return <ErrorView message={error} />;
  if (!rows) return <Loading />;
  const done = rows.filter((r) => r.measured === 16).length;
  return (
    <div className="stack">
      <p className="small muted">
        {done} of {rows.length} cast have all 16 measurements in. Actors can fill in their own form from the Show page; you can fill
        in or fix anyone's. Only people with costume access and the actor see these.
      </p>
      <div className="wr-sheets">
        {rows.map((r) => (
          <button key={r.userId} type="button" className="wr-sheet" onClick={() => navigate(`/shows/${props.showId}/measurements/${r.userId}`)}>
            <span className="wr-sheet-who">
              <span className="wr-item-name">{r.name ?? "Someone"}</span>
              <span className="wr-item-meta">{r.parts.join(", ") || "No part yet"}</span>
            </span>
            <span className="wr-sheet-tags">
              {r.hasNotes && <span className="tag tag-plum">Notes</span>}
              {r.hasNeeds && <span className="tag">Ideas</span>}
            </span>
            <span className={r.measured === 16 ? "wr-st ready" : r.measured === 0 ? "wr-st needed" : "wr-st pulled"}>
              {r.measured === 16 ? "All 16" : `${r.measured} of 16`}
            </span>
            <span className="wr-sheet-date small muted">{r.updatedAt ? `Updated ${shortDate(r.updatedAt.slice(0, 10))}` : "Not started"}</span>
          </button>
        ))}
      </div>
      {rows.length === 0 && <div className="empty">Nobody is in the cast yet.</div>}
    </div>
  );
}

function MoneyTab(props: { data: TrackerData }) {
  const m = props.data.money;
  const costed = props.data.items.filter((i) => i.costCents || i.rentalFeeCents || i.depositCents);
  return (
    <div className="stack wr-money">
      <div className="wr-tiles">
        <div className="wr-tile">
          <span className="caps">Spent so far</span>
          <span className="wr-tile-num">{money(m.spentCents)}</span>
          <span className="small muted">
            {money(m.boughtCents)} bought or built · {money(m.rentalCents)} rentals
          </span>
        </div>
        <div className="wr-tile">
          <span className="caps">Deposits to get back</span>
          <span className="wr-tile-num">{money(m.depositsOutCents)}</span>
          <span className="small muted">{m.deposits.length === 1 ? "1 deposit" : `${m.deposits.length} deposits`}</span>
        </div>
      </div>
      {m.deposits.length > 0 && (
        <section className="stack-sm">
          <h2 className="caps">Deposits out</h2>
          <div className="wr-table-wrap">
            <table className="wr-table">
              <tbody>
                {m.deposits.map((d) => (
                  <tr key={d.itemId}>
                    <td>{d.name}</td>
                    <td className="muted">{d.lender}</td>
                    <td className="muted">{d.dueBack ? `Back by ${shortDate(d.dueBack)}` : ""}</td>
                    <td className="num">{money(d.depositCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="stack-sm">
        <h2 className="caps">Everything with a cost</h2>
        {costed.length === 0 ? (
          <p className="small muted">Add a cost, rental fee or deposit to an item and it shows up here.</p>
        ) : (
          <div className="wr-table-wrap">
            <table className="wr-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>From</th>
                  <th className="num">Cost</th>
                  <th className="num">Rental</th>
                  <th className="num">Deposit</th>
                </tr>
              </thead>
              <tbody>
                {costed.map((i) => (
                  <tr key={i.itemId}>
                    <td>
                      {i.name}
                      <span className="muted small"> · {i.kind === "costume" ? "Costume" : "Prop"}</span>
                    </td>
                    <td className="muted">{sourceLine(i)}</td>
                    <td className="num">{money(i.costCents)}</td>
                    <td className="num">{money(i.rentalFeeCents)}</td>
                    <td className="num">
                      {money(i.depositCents)}
                      {i.depositCents && i.depositBackAt ? <span className="muted small"> back</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
