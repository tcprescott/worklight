import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShowPageProps } from "../App";
import { api } from "../api";
import { longDate, shortDate, todayIso } from "../lib/dates";
import { firstName } from "../lib/people";
import { Link, navigate } from "../router";
import { ActorShell, AccountMenu, StaffShell } from "../shell";
import type { CastOption, LineNoteKind, LineNoteSetDetail, LineNoteSetSummary, LineNotesHome, LineNoteView, Scene } from "../types";
import { ErrorView, FormError, Icon, Loading, useToast } from "../ui";
import "./linenotes.css";

const KINDS: { kind: LineNoteKind; label: string }[] = [
  { kind: "dropped", label: "Dropped" },
  { kind: "paraphrase", label: "Paraphrase" },
  { kind: "added", label: "Added" },
  { kind: "called", label: "Called line" },
  { kind: "jumped", label: "Jumped cue" },
  { kind: "late", label: "Late entrance" },
];
// What each kind asks for: the script's words, what the actor said instead, or just a note.
const WANTS: Record<LineNoteKind, { script: boolean; said: boolean }> = {
  dropped: { script: true, said: false },
  paraphrase: { script: true, said: true },
  added: { script: true, said: true },
  called: { script: true, said: false },
  jumped: { script: false, said: false },
  late: { script: false, said: false },
  other: { script: false, said: false },
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const whenOpened = (iso: string) => `${shortDate(iso.slice(0, 10))}, ${clock(iso)}`;
const chipName = (c: CastOption) => c.characters[0] ?? (firstName(c.name) || "Actor");
/** Part names, with first names added where two people share one (ensembles, double casting). */
function chipLabels(cast: CastOption[]): Map<string, string> {
  const seen = new Map<string, number>();
  for (const c of cast) seen.set(chipName(c), (seen.get(chipName(c)) ?? 0) + 1);
  return new Map(
    cast.map((c) => {
      const base = chipName(c);
      return [c.userId, (seen.get(base) ?? 0) > 1 && c.name ? `${base} · ${firstName(c.name)}` : base];
    }),
  );
}

/** /shows/:id/notes and /shows/:id/notes/:setId. Staff and note-takers take notes; cast read their own. */
export function LineNotesPage(props: ShowPageProps) {
  const showId = props.view.show.showId;
  const [home, setHome] = useState<LineNotesHome>();
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    try {
      setHome(await api.lineNotes(showId));
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [showId]);
  useEffect(() => void load(), [load]);

  const staff = props.view.role === "staff";
  const archived = props.view.show.status === "archived";
  const taker = Boolean(home && (home.canTake || staff));
  let body;
  if (error && !home) body = <ErrorView message={error} onRetry={() => void load()} />;
  else if (!home) body = <Loading />;
  else if (taker && props.sub) body = <TakeNotes {...props} home={home} setId={props.sub} onChanged={load} />;
  else if (taker) body = <SetList {...props} home={home} />;
  else if (props.sub) body = <MyNotes {...props} setId={props.sub} />;
  else body = <MySets {...props} home={home} />;

  if (staff) {
    return (
      <StaffShell view={props.view} current="notes">
        {body}
      </StaffShell>
    );
  }
  return (
    <ActorShell showId={showId} current="calls" archived={archived}>
      {body}
    </ActorShell>
  );
}

// ---- Staff and note-takers -------------------------------------------------------------------------

function SetList(props: ShowPageProps & { home: LineNotesHome }) {
  const show = props.view.show;
  const [date, setDate] = useState(todayIso());
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const { home } = props;

  const start = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const made = await api.createLineNoteSet(show.showId, { date, title: title.trim() || "Run" });
      navigate(`/shows/${show.showId}/notes/${made.setId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="page ln-page">
      <div className="ln-head">
        <span className="kicker">Line notes</span>
        <h1 className="title-md">{show.name}</h1>
        <p className="muted">
          Notes for each actor after a run. They stay drafts until {home.canRelease ? "you release" : "staff release"} them, then each actor gets
          only their own.
        </p>
      </div>

      {home.canTake && (
        <form
          className="ln-new"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <label className="field">
            Date
            <input id="ln-new-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label className="field ln-new-title">
            What's being run
            <input id="ln-new-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Run of Act III" maxLength={100} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <Icon name="plus" /> Start taking notes
          </button>
          <FormError error={error} />
        </form>
      )}

      {home.sets.length === 0 ? (
        <div className="empty">
          <strong>No line notes yet</strong>
          <span>Start a set at the top of a run, then tap an actor and what happened as it goes.</span>
        </div>
      ) : (
        <div className="ln-sets">
          {home.sets.map((s) => (
            <Link key={s.setId} to={`/shows/${show.showId}/notes/${s.setId}`} className="ln-set">
              <span className="ln-set-date cond">{shortDate(s.date)}</span>
              <span className="ln-set-main">
                <strong>{s.title}</strong>
                <span className="small muted">
                  {plural(s.noteCount, "note")} · {plural(s.actorCount, "actor")}
                  {s.takenByName ? ` · taken by ${firstName(s.takenByName)}` : ""}
                </span>
              </span>
              {s.releasedAt ? <span className="ln-tag ln-tag-sent">Released</span> : <span className="ln-tag ln-tag-draft">Draft</span>}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

function TakeNotes(props: ShowPageProps & { home: LineNotesHome; setId: string; onChanged: () => Promise<void> }) {
  const showId = props.view.show.showId;
  const cast = props.home.cast;
  const [detail, setDetail] = useState<LineNoteSetDetail>();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [error, setError] = useState<string>();
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    try {
      setDetail(await api.lineNoteSet(showId, props.setId));
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [showId, props.setId]);
  useEffect(() => {
    void load();
    api
      .breakdown(showId)
      .then((b) => setScenes(b.scenes))
      .catch(() => undefined);
  }, [load, showId]);

  if (error && !detail) return <ErrorView message={error} onRetry={() => void load()} />;
  if (!detail) return <Loading />;
  const set = detail.set;

  const remove = async (note: LineNoteView) => {
    setDetail((d) => (d ? { ...d, notes: d.notes.filter((n) => n.noteId !== note.noteId) } : d));
    try {
      await api.deleteLineNote(showId, props.setId, note.noteId);
    } catch (err) {
      showToast(`Couldn't remove that: ${(err as Error).message}`);
    }
    await load();
  };

  const counts = new Map<string, number>();
  for (const n of detail.notes) counts.set(n.actorId, (counts.get(n.actorId) ?? 0) + 1);

  return (
    <main className="page ln-page">
      <div className="ln-bar">
        <Link to={`/shows/${showId}/notes`} className="ln-back small">
          <Icon name="left" size={14} /> All line notes
        </Link>
        <span className="ln-bar-kicker">Line notes · {set.releasedAt ? "released" : "draft"}</span>
        <span className="ln-bar-title">{set.title}</span>
        <span className="ln-bar-when">{longDate(set.date)}</span>
      </div>

      {detail.canEdit && cast.length > 0 && (
        <NoteEntry
          showId={showId}
          setId={props.setId}
          cast={cast}
          scenes={scenes}
          counts={counts}
          released={Boolean(set.releasedAt)}
          onAdded={load}
        />
      )}
      {detail.canEdit && cast.length === 0 && (
        <div className="empty">
          <strong>Nobody to give notes to yet</strong>
          <span>Line notes go to the cast. Add cast members on the People page and cast them in the Breakdown.</span>
        </div>
      )}

      <section className="ln-list" aria-label="Notes so far">
        <div className="ln-list-head">
          <span>{plural(detail.notes.length, "note")}</span>
          <span>{plural(counts.size, "actor")}</span>
        </div>
        {detail.notes.length === 0 ? (
          <p className="small muted ln-list-empty">Notes you add show here in page order.</p>
        ) : (
          detail.notes.map((n) => <NoteRow key={n.noteId} note={n} showActor onRemove={detail.canEdit ? () => void remove(n) : undefined} />)
        )}
      </section>

      {props.view.role === "staff" && (
        <Release showId={showId} detail={detail} onReleased={async () => (await load(), await props.onChanged())} showToast={showToast} />
      )}
      {toast}
    </main>
  );
}

function NoteEntry(props: {
  showId: string;
  setId: string;
  cast: CastOption[];
  scenes: Scene[];
  counts: Map<string, number>;
  released: boolean;
  onAdded: () => Promise<void>;
}) {
  const [actorId, setActorId] = useState(props.cast[0]!.userId);
  const actor = props.cast.find((c) => c.userId === actorId) ?? props.cast[0]!;
  const [charId, setCharId] = useState<string | undefined>(actor.charIds[0]);
  const [kind, setKind] = useState<LineNoteKind>("dropped");
  const [page, setPage] = useState("");
  const [sceneId, setSceneId] = useState("");
  const [script, setScript] = useState("");
  const [said, setSaid] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pageRef = useRef<HTMLInputElement>(null);
  const wants = WANTS[kind];
  const labels = useMemo(() => chipLabels(props.cast), [props.cast]);

  const pick = (c: CastOption) => {
    setActorId(c.userId);
    setCharId(c.charIds[0]);
  };

  const add = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.addLineNotes(props.showId, props.setId, [
        {
          actorId,
          charId: charId ?? null,
          kind,
          page: page.trim() || null,
          sceneId: sceneId || null,
          scriptText: wants.script ? script.trim() || null : null,
          saidText: wants.said ? said.trim() || null : null,
          comment: comment.trim() || null,
        },
      ]);
      // Keep the actor, kind, page and scene: the next note is often close by. Clear the words.
      setScript("");
      setSaid("");
      setComment("");
      await props.onAdded();
      pageRef.current?.focus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="ln-entry"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <div className="ln-chips" role="group" aria-label="Who the note is for">
        {props.cast.map((c) => {
          const n = props.counts.get(c.userId) ?? 0;
          return (
            <button
              key={c.userId}
              type="button"
              className="chip"
              aria-pressed={c.userId === actorId}
              title={c.name ?? undefined}
              onClick={() => pick(c)}
            >
              {labels.get(c.userId)}
              {n > 0 && <span className="ln-chip-n">{n}</span>}
            </button>
          );
        })}
      </div>
      {actor.characters.length > 1 && (
        <div className="ln-parts" role="group" aria-label="Which part">
          <span className="small muted">{firstName(actor.name)} as</span>
          {actor.characters.map((name, i) => (
            <button
              key={actor.charIds[i]}
              type="button"
              className="chip ln-part"
              aria-pressed={charId === actor.charIds[i]}
              onClick={() => setCharId(actor.charIds[i])}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div className="ln-kinds" role="group" aria-label="What happened">
        {KINDS.map((k) => (
          <button key={k.kind} type="button" className="ln-kind" aria-pressed={kind === k.kind} onClick={() => setKind(k.kind)}>
            {k.label}
          </button>
        ))}
      </div>
      <div className="ln-where">
        <label className="field">
          Page
          <input id="ln-page" ref={pageRef} value={page} onChange={(e) => setPage(e.target.value)} inputMode="numeric" maxLength={10} />
        </label>
        <label className="field">
          Scene
          <select id="ln-scene" value={sceneId} onChange={(e) => setSceneId(e.target.value)}>
            <option value="">Not set</option>
            {props.scenes.map((s) => (
              <option key={s.sceneId} value={s.sceneId}>
                {s.number} {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {wants.script && (
        <label className="field">
          Script says
          <textarea id="ln-script" rows={2} value={script} onChange={(e) => setScript(e.target.value)} maxLength={1000} />
        </label>
      )}
      {wants.said && (
        <label className="field">
          Actor said
          <textarea id="ln-said" rows={2} value={said} onChange={(e) => setSaid(e.target.value)} maxLength={1000} />
        </label>
      )}
      <label className="field">
        <span>
          Note <span className="hint">(optional)</span>
        </span>
        <input
          id="ln-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={kind === "jumped" ? "Came in before the laugh" : kind === "late" ? "Missed the door" : ""}
          maxLength={1000}
        />
      </label>
      <FormError error={error} />
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Adding..." : `Add note for ${labels.get(actor.userId)}`}
        </button>
        {props.released && <span className="small muted">Released already: {firstName(actor.name)} will see it marked as new.</span>}
      </div>
    </form>
  );
}

function Release(props: {
  showId: string;
  detail: LineNoteSetDetail;
  onReleased: () => Promise<void>;
  showToast: (m: string) => void;
}) {
  const { detail } = props;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = detail.set;
  const actorCount = new Set(detail.notes.map((n) => n.actorId)).size;

  const release = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.releaseLineNotes(props.showId, set.setId);
      props.showToast(`Sent to ${plural(r.actorCount, "actor")}`);
      setConfirming(false);
      await props.onReleased();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      await api.deleteLineNoteSet(props.showId, set.setId);
      navigate(`/shows/${props.showId}/notes`);
    } catch (err) {
      props.showToast((err as Error).message);
    }
  };

  if (set.releasedAt) {
    return (
      <section className="ln-release" aria-label="Who has read their notes">
        <div className="ln-list-head">
          <span>Released {whenOpened(set.releasedAt)}</span>
          <span>{detail.actors.filter((a) => a.openedAt).length} opened</span>
        </div>
        {detail.actors.map((a) => (
          <div key={a.userId} className="ln-status">
            <span>
              <strong>{a.characters[0] ?? a.name}</strong>
              {a.characters.length > 0 && a.name ? <span className="muted"> · {a.name}</span> : null} · {plural(a.noteCount, "note")}
            </span>
            {a.openedAt ? <span className="ln-opened">Opened {whenOpened(a.openedAt)}</span> : <span className="muted small">Not opened</span>}
          </div>
        ))}
        <p className="small muted ln-release-foot">Changes you make now show up for the actor marked "updated". Nothing is sent again.</p>
      </section>
    );
  }

  return (
    <section className="ln-release" aria-label="Release">
      {!confirming ? (
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={!detail.canRelease || detail.notes.length === 0} onClick={() => setConfirming(true)}>
            Release to {plural(actorCount, "actor")}
          </button>
          <button type="button" className="btn" onClick={() => void remove()}>
            <Icon name="trash" /> Delete this set
          </button>
        </div>
      ) : (
        <div className="ln-confirm">
          <strong>Send these notes now?</strong>
          <span className="small">
            Each of the {plural(actorCount, "actor")} gets one email and push with a link to their own notes. You can still fix notes after, but
            the message only goes once.
          </span>
          <FormError error={error} />
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void release()}>
              {busy ? "Sending..." : "Release"}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              Not yet
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function NoteRow(props: { note: LineNoteView; showActor?: boolean; onRemove?: () => void }) {
  const n = props.note;
  const swap = n.saidText && n.scriptText;
  return (
    <div className="ln-note">
      <div className="ln-pg">
        {n.page ? `p.${n.page}` : "–"}
        {n.sceneLabel && <small>{n.sceneLabel.split(" ")[0]}</small>}
      </div>
      <div className="ln-note-body">
        <div className="ln-note-top">
          {props.showActor && <strong>{n.charName ?? n.actorName}</strong>}
          <span className="ln-code">{n.kindLabel}</span>
          {n.updatedAfterRelease && <span className="ln-tag ln-tag-new">Updated</span>}
        </div>
        {swap ? (
          <div className="ln-said">
            <div>
              <span className="caps small muted">Script</span> "{n.scriptText}"
            </div>
            <div>
              <span className="caps small muted">{props.showActor ? "Said" : "You said"}</span> "{n.saidText}"
            </div>
          </div>
        ) : (
          (n.scriptText || n.saidText) && <div className="ln-said">"{n.scriptText ?? n.saidText}"</div>
        )}
        {n.comment && <div className="ln-comment">{n.comment}</div>}
      </div>
      {props.onRemove && (
        <button type="button" className="btn-icon" aria-label="Remove note" onClick={props.onRemove}>
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  );
}

// ---- Actors -----------------------------------------------------------------------------------------

function ActorHead(props: ShowPageProps & { title: string; back?: boolean }) {
  const show = props.view.show;
  return (
    <header className="actor-head">
      <div className="actor-topline">
        <span className="kicker">{show.name}</span>
        <AccountMenu showId={show.showId} isStaff={false} />
      </div>
      {props.back && (
        <Link to={`/shows/${show.showId}/notes`} className="ln-back small">
          <Icon name="left" size={14} /> All my notes
        </Link>
      )}
      <h1>{props.title}</h1>
    </header>
  );
}

function MySets(props: ShowPageProps & { home: LineNotesHome }) {
  const showId = props.view.show.showId;
  return (
    <>
      <ActorHead {...props} title="Your line notes" />
      <div className="actor-section">
        {props.home.sets.length === 0 ? (
          <div className="actor-empty">
            <strong>No line notes yet</strong>
            After a run, stage management may send you notes on your lines. They show up here, and only you can see them.
          </div>
        ) : (
          <div className="ln-sets">
            {props.home.sets.map((s) => (
              <Link key={s.setId} to={`/shows/${showId}/notes/${s.setId}`} className="ln-set">
                <span className="ln-set-date cond">{shortDate(s.date)}</span>
                <span className="ln-set-main">
                  <strong>{s.title}</strong>
                  <span className="small muted">
                    {plural(s.noteCount, "note")}
                    {s.takenByName ? ` · from ${firstName(s.takenByName)}` : ""}
                  </span>
                </span>
                {!s.openedAt && <span className="ln-tag ln-tag-new">New</span>}
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function MyNotes(props: ShowPageProps & { setId: string }) {
  const showId = props.view.show.showId;
  const [detail, setDetail] = useState<LineNoteSetDetail>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api
      .lineNoteSet(showId, props.setId)
      .then(setDetail)
      .catch((err: Error) => setError(err.message));
  }, [showId, props.setId]);
  const parts = useMemo(() => [...new Set(detail?.notes.map((n) => n.charName).filter(Boolean))], [detail]);

  if (error) return <ErrorView message={error} />;
  if (!detail) return <Loading />;
  return (
    <>
      <ActorHead {...props} title={detail.set.title} back />
      <div className="actor-section">
        <p className="small muted">
          {longDate(detail.set.date)}
          {parts.length > 0 ? ` · ${parts.join(", ")}` : ""}
          {detail.set.takenByName ? ` · from ${detail.set.takenByName}` : ""}
        </p>
        <div className="ln-list">
          {detail.notes.map((n) => (
            <NoteRow key={n.noteId} note={n} />
          ))}
        </div>
        <p className="small muted">Only you and stage management can see these.</p>
      </div>
    </>
  );
}

/** On My calls: a link to new line notes (cast), or to taking notes (crew note-takers). */
export function LineNotesCard(props: { showId: string }) {
  const [home, setHome] = useState<LineNotesHome>();
  useEffect(() => {
    let live = true;
    api
      .lineNotes(props.showId)
      .then((h) => live && setHome(h))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [props.showId]);
  if (!home) return null;
  const to = `/shows/${props.showId}/notes`;
  if (home.canTake) {
    return (
      <Link to={to} className="ln-card">
        <Icon name="edit" />
        <span>
          <strong>Take line notes</strong>
          <span className="small muted">{home.sets.length ? `${plural(home.sets.length, "draft set")} waiting for release` : "Start a set for tonight's run"}</span>
        </span>
      </Link>
    );
  }
  const fresh: LineNoteSetSummary[] = home.sets.filter((s) => !s.openedAt);
  if (home.sets.length === 0) return null;
  return (
    <Link to={fresh.length === 1 ? `${to}/${fresh[0]!.setId}` : to} className="ln-card">
      <Icon name="edit" />
      <span>
        <strong>{fresh.length ? `New line notes from ${fresh[0]!.title}` : "Your line notes"}</strong>
        <span className="small muted">
          {fresh.length ? plural(fresh.reduce((t, s) => t + s.noteCount, 0), "note") : plural(home.sets.length, "set")}
        </span>
      </span>
      {fresh.length > 0 && <span className="ln-tag ln-tag-new">New</span>}
    </Link>
  );
}
