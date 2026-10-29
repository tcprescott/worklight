import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ShowPageProps } from "../../App";
import { api } from "../../api";
import { addDays, daysBetween, dayOfMonth, monthName, shortDate, time12, todayIso } from "../../lib/dates";
import { useIsPhone } from "../../lib/useMedia";
import { useSession } from "../../session";
import { StaffShell } from "../../shell";
import type { Callboard, CallView, Member, NoticeAudience, NoticeView, Show } from "../../types";
import { Dialog, ErrorView, FormError, Icon, Loading, useToast } from "../../ui";
import { AUDIENCE_LABEL, postedWhen, readLine } from "../callboardLib";
import "./callboard.css";

type Filter = "all" | NoticeAudience;
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All notices" },
  { id: "everyone", label: "Everyone" },
  { id: "cast", label: "Cast" },
  { id: "crew", label: "Crew" },
];
const AUDIENCES: NoticeAudience[] = ["everyone", "cast", "crew"];

const STARTERS = [
  { label: "Running late", title: "Running late tonight", body: "We will start 15 minutes late. Doors open at 6:15." },
  { label: "Cancelled", title: "Rehearsal cancelled", body: "Tonight is cancelled. Your next call is on the schedule." },
  { label: "Bring something", title: "Bring for tonight", body: "Please bring your rehearsal shoes and a pencil." },
];

/** Matches the server: staff get everything, cast and crew get everyone's and their own group's. */
const reaches = (audience: NoticeAudience, m: Member) => audience === "everyone" || m.role === "staff" || m.role === audience;

interface Data {
  board: Callboard;
  members: Member[];
  next?: CallView;
}

export function CallboardPage(props: ShowPageProps) {
  const show = props.view.show;
  const showId = show.showId;
  const archived = show.status === "archived";
  const phone = useIsPhone();
  const { me } = useSession();
  const [data, setData] = useState<Data>();
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<NoticeView | "new">();
  const [deleting, setDeleting] = useState<NoticeView>();
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    try {
      const today = todayIso();
      const [board, members, sched] = await Promise.all([
        api.callboard(showId),
        api.members(showId).catch(() => [] as Member[]),
        archived ? Promise.resolve(undefined) : api.schedule(showId, today, addDays(today, 62)).catch(() => undefined),
      ]);
      const calls = (sched?.days ?? []).flatMap((d) => d.calls).filter((c) => !c.cancelled && c.date >= today);
      const next = calls.find((c) => c.status === "published") ?? calls[0];
      setData({ board, members, next });
      setError(undefined);
      // Staff read every notice in full here, so opening the callboard counts as reading it.
      const unread = board.notices.filter((n) => !n.read).map((n) => n.noticeId);
      if (unread.length) void api.markNoticesRead(showId, unread).catch(() => undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [showId, archived]);

  useEffect(() => {
    void load();
  }, [load]);

  const others = useMemo(() => (data?.members ?? []).filter((m) => m.userId !== me.user.userId), [data, me.user.userId]);
  const countFor = (a: NoticeAudience) => others.filter((m) => reaches(a, m)).length;

  const patchLocal = (fn: (list: NoticeView[]) => NoticeView[]) =>
    setData((d) => {
      if (!d) return d;
      const list = fn(d.board.notices);
      const newest = (a: NoticeView, b: NoticeView) => b.createdAt.localeCompare(a.createdAt);
      const pinned = list.filter((x) => x.pinned).sort(newest);
      const rest = list.filter((x) => !x.pinned).sort(newest);
      return { ...d, board: { ...d.board, notices: [...pinned, ...rest] } };
    });

  async function togglePin(n: NoticeView) {
    patchLocal((list) => list.map((x) => (x.noticeId === n.noticeId ? { ...x, pinned: !n.pinned } : x)));
    try {
      await api.updateNotice(showId, n.noticeId, { pinned: !n.pinned });
      showToast(n.pinned ? "Unpinned" : "Pinned to the top");
      await load();
    } catch (err) {
      showToast((err as Error).message);
      await load();
    }
  }

  if (error && !data)
    return (
      <StaffShell view={props.view} current="callboard">
        <ErrorView message={error} onRetry={() => void load()} />
      </StaffShell>
    );
  if (!data)
    return (
      <StaffShell view={props.view} current="callboard">
        <Loading />
      </StaffShell>
    );

  const { board } = data;
  const canPost = board.canPost;
  const notices = board.notices.filter((n) => filter === "all" || n.audience === filter);
  const actions = canPost ? { onPin: togglePin, onEdit: setEditing, onDelete: setDeleting } : undefined;

  const empty = (
    <div className="empty cb-empty">
      <strong>{board.notices.length === 0 ? "No notices yet" : `No notices for ${filter === "all" ? "anyone" : AUDIENCE_LABEL[filter].toLowerCase()}`}</strong>
      <span>
        {board.notices.length === 0
          ? canPost
            ? "Post off-book dates, a set build, or anything the company needs to know. It's emailed to the people it's for."
            : "Nothing was posted for this show."
          : "Try another filter."}
      </span>
    </div>
  );

  return (
    <StaffShell view={props.view} current="callboard">
      {phone ? (
        <main className="cb-phone">
          <h1 className="cb-phone-title">Callboard</h1>
          <DateCards show={show} next={data.next} phone />
          {notices.length === 0 ? empty : notices.map((n) => <PhoneNotice key={n.noticeId} n={n} actions={actions} />)}
          {canPost && (
            <button type="button" className="btn btn-primary cb-fab" onClick={() => setEditing("new")}>
              <Icon name="plus" /> Post a notice
            </button>
          )}
        </main>
      ) : (
        <main className="cb-page">
          <div className="cb-head">
            <span className="cb-kicker">The Callboard</span>
            <h1>{show.name}</h1>
            <span className="cb-sub">{[props.view.theaterName, show.venue].filter(Boolean).join(" · ")}</span>
          </div>
          <DateCards show={show} next={data.next} />
          <div className="cb-bar">
            <div className="cb-filters" role="group" aria-label="Show notices for">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" className="cb-pill" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
            {canPost && (
              <button type="button" className="btn btn-primary cb-post" onClick={() => setEditing("new")}>
                <Icon name="plus" /> Post a notice
              </button>
            )}
          </div>
          {notices.length === 0 ? empty : notices.map((n) => <DeskNotice key={n.noticeId} n={n} actions={actions} />)}
        </main>
      )}

      {editing && (
        <Compose
          phone={phone}
          showId={showId}
          notice={editing === "new" ? undefined : editing}
          author={me.user.name ?? me.user.email}
          countFor={countFor}
          onClose={() => setEditing(undefined)}
          onDone={async (message) => {
            if (editing === "new") setFilter("all");
            setEditing(undefined);
            showToast(message);
            await load();
          }}
        />
      )}
      {deleting && (
        <DeleteNotice
          showId={showId}
          notice={deleting}
          onClose={() => setDeleting(undefined)}
          onDone={async () => {
            const gone = deleting.noticeId;
            patchLocal((list) => list.filter((x) => x.noticeId !== gone));
            setDeleting(undefined);
            showToast("Notice deleted");
            await load();
          }}
        />
      )}
      {toast}
    </StaffShell>
  );
}

// ---- Date cards -------------------------------------------------------------------------------------

const monDay = (iso: string) => `${monthName(iso).slice(0, 3)} ${dayOfMonth(iso)}`;

function toGo(iso: string, today: string, past: string): string {
  const n = daysBetween(today, iso);
  if (n > 1) return `${n} days to go`;
  if (n === 1) return "Tomorrow";
  if (n === 0) return "Today";
  return past;
}

function callLabel(c: CallView): string {
  const what = c.title?.trim() || c.type;
  return `${time12(c.start)} ${/^[A-Z][a-z]/.test(what) ? what[0]!.toLowerCase() + what.slice(1) : what}`;
}

function DateCards(props: { show: Show; next?: CallView; phone?: boolean }) {
  const { show, next } = props;
  const today = todayIso();
  const archived = show.status === "archived";
  const techEnd = show.openingDate ? addDays(show.openingDate, -1) : show.endDate;
  const unset = archived ? "Not set" : "Set it in show settings";
  const cards = [
    {
      label: "Next call",
      main: next ? shortDate(next.date) : "None yet",
      sub: next ? callLabel(next) + (next.status === "draft" ? " (draft)" : "") : archived ? "Show is archived" : "Nothing on the schedule",
    },
    {
      label: "Off book",
      main: show.offBookDate ? shortDate(show.offBookDate) : "Not set",
      sub: show.offBookDate ? toGo(show.offBookDate, today, "Scripts down") : unset,
    },
    {
      label: "Tech week",
      main: show.techStart ? `${monDay(show.techStart)} to ${monDay(techEnd)}` : "Not set",
      sub: show.techStart ? "Everyone, every night" : unset,
    },
    {
      label: "Opening",
      main: show.openingDate ? shortDate(show.openingDate) : "Not set",
      sub: show.openingDate ? toGo(show.openingDate, today, today <= show.endDate ? "Running now" : "Closed") : unset,
      lit: true,
    },
  ];
  return (
    <div className={props.phone ? "cb-dates cb-dates-phone" : "cb-dates"}>
      {cards.map((c) => (
        <div key={c.label} className={c.lit && show.openingDate ? "cb-date lit" : "cb-date"}>
          <span className="cb-date-label">{c.label}</span>
          <span className="cb-date-main">{c.main}</span>
          <span className="cb-date-sub">{c.sub}</span>
        </div>
      ))}
    </div>
  );
}

// ---- Notices ----------------------------------------------------------------------------------------

interface Actions {
  onPin: (n: NoticeView) => void;
  onEdit: (n: NoticeView) => void;
  onDelete: (n: NoticeView) => void;
}

function PinMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 4h6l-1 6 4 3v2H6v-2l4-3-1-6zM12 15v5" />
    </svg>
  );
}

function NoticeActions(props: { n: NoticeView; actions?: Actions }) {
  const { n, actions } = props;
  if (!actions) return null;
  return (
    <>
      <button type="button" className="link-btn" onClick={() => actions.onPin(n)}>
        {n.pinned ? "Unpin" : "Pin"}
      </button>
      <button type="button" className="link-btn" onClick={() => actions.onEdit(n)}>
        Edit
      </button>
      <button type="button" className="link-btn cb-delete" onClick={() => actions.onDelete(n)}>
        Delete
      </button>
    </>
  );
}

function DeskNotice(props: { n: NoticeView; actions?: Actions }) {
  const { n } = props;
  const reads = readLine(n);
  return (
    <article className={n.pinned ? "cb-notice pinned" : "cb-notice"}>
      <div className="cb-notice-top">
        {n.pinned && (
          <span className="cb-pinned">
            <PinMark /> Pinned
          </span>
        )}
        <h2>{n.title}</h2>
        <span className="tag tag-plum cb-aud">{AUDIENCE_LABEL[n.audience]}</span>
      </div>
      <p className="cb-body">{n.body}</p>
      <div className="cb-meta">
        <span>
          {n.authorName ?? "Staff"} · {postedWhen(n.createdAt)}
        </span>
        {reads && <span>{reads}</span>}
        <NoticeActions n={n} actions={props.actions} />
      </div>
    </article>
  );
}

function PhoneNotice(props: { n: NoticeView; actions?: Actions }) {
  const { n } = props;
  const reads = readLine(n);
  return (
    <article className={n.pinned ? "cb-pnotice pinned" : "cb-pnotice"}>
      <span className="cb-ptag">{[n.pinned ? "Pinned" : "", AUDIENCE_LABEL[n.audience], postedWhen(n.createdAt)].filter(Boolean).join(" · ")}</span>
      <strong>{n.title}</strong>
      <p>{n.body}</p>
      <span className="cb-pmeta">
        {n.authorName ?? "Staff"}
        {reads ? ` · ${reads}` : ""}
      </span>
      {props.actions && (
        <div className="cb-pactions">
          <NoticeActions n={n} actions={props.actions} />
        </div>
      )}
    </article>
  );
}

// ---- Post and edit ----------------------------------------------------------------------------------

function Compose(props: {
  phone: boolean;
  showId: string;
  notice?: NoticeView;
  author: string;
  countFor: (a: NoticeAudience) => number;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const editing = props.notice;
  const [title, setTitle] = useState(editing?.title ?? "");
  const [body, setBody] = useState(editing?.body ?? "");
  const [audience, setAudience] = useState<NoticeAudience>(editing?.audience ?? "everyone");
  const [pinned, setPinned] = useState(editing?.pinned ?? false);
  const [email, setEmail] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const n = props.countFor(audience);
  const people = `${n} ${n === 1 ? "person" : "people"}`;
  const ready = title.trim().length > 0 && body.trim().length > 0;

  async function save() {
    if (!title.trim()) return setError("Add a headline.");
    if (!body.trim()) return setError("Add a message.");
    setSaving(true);
    setError(undefined);
    try {
      if (editing) {
        await api.updateNotice(props.showId, editing.noticeId, { title: title.trim(), body: body.trim(), audience, pinned });
        props.onDone("Notice updated");
      } else {
        await api.postNotice(props.showId, { title: title.trim(), body: body.trim(), audience, pinned, email });
        props.onDone(email && n > 0 ? `Posted and emailed to ${people}` : "Posted");
      }
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  const reach = editing
    ? "Changes show on the callboard right away. Nobody is emailed again."
    : email
      ? `Goes to ${people} by email, unless they've turned callboard emails off.`
      : `Shows on the callboard for ${people}. No email.`;

  const audiencePicker = (
    <div className="cb-field">
      <span className="cb-label">{props.phone ? "Send to" : "Who gets it"}</span>
      <div className="cb-filters" role="group" aria-label="Who gets it">
        {AUDIENCES.map((a) => (
          <button
            key={a}
            type="button"
            className={props.phone ? "cb-pill cb-pill-lg" : "cb-pill"}
            aria-pressed={audience === a}
            onClick={() => setAudience(a)}
          >
            {AUDIENCE_LABEL[a]}
          </button>
        ))}
      </div>
    </div>
  );

  if (props.phone) {
    return (
      <PhoneCompose
        title={editing ? "Edit notice" : "New notice"}
        onClose={props.onClose}
        onPost={() => void save()}
        postLabel={saving ? "..." : editing ? "Save" : "Post"}
        ready={ready && !saving}
      >
        {audiencePicker}
        {!editing && (
          <div className="cb-filters">
            {STARTERS.map((s) => (
              <button
                key={s.label}
                type="button"
                className="cb-starter"
                onClick={() => {
                  setTitle(s.title);
                  setBody(s.body);
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        <input
          className="cb-ptitle"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Headline"
          maxLength={120}
          aria-label="Headline"
        />
        <textarea
          className="cb-pbody"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What does everyone need to know?"
          maxLength={4000}
          aria-label="Message"
        />
        <span className="cb-label">What {audience === "everyone" ? `all ${n}` : `the ${n} in the ${audience}`} will see</span>
        <div className="cb-preview">
          <span className="cb-preview-tag">New from {props.author}</span>
          <strong>{title.trim() || "Notice"}</strong>
          <span>{body.trim() || "Your message shows here."}</span>
        </div>
        <label className="cb-toggle">
          <span>
            <strong>Pin to the top</strong>
            <span>Stays above newer notices</span>
          </span>
          <input type="checkbox" checked={pinned} onChange={() => setPinned(!pinned)} />
        </label>
        {!editing && (
          <label className="cb-toggle">
            <span>
              <strong>Email it</strong>
              <span>To the {people} it's for</span>
            </span>
            <input type="checkbox" checked={email} onChange={() => setEmail(!email)} />
          </label>
        )}
        {!editing && (
          <label className="cb-toggle off">
            <span>
              <strong>
                Urgent: also text people <span className="tag tag-paid">PAID PLAN</span>
              </strong>
              <span>For changes today</span>
            </span>
            <input type="checkbox" checked={false} disabled />
          </label>
        )}
        <span className="cb-reach">{reach}</span>
        <FormError error={error} />
      </PhoneCompose>
    );
  }

  return (
    <Dialog title={editing ? "Edit notice" : "Post a notice"} onClose={props.onClose}>
      <label className="field">
        Headline
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Costume fittings this Saturday" maxLength={120} autoFocus />
      </label>
      <label className="field">
        Message
        <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} />
      </label>
      {audiencePicker}
      <label className="check cb-check">
        <input type="checkbox" checked={pinned} onChange={() => setPinned(!pinned)} />
        <span>Pin to the top of the callboard</span>
      </label>
      {!editing && (
        <label className="check cb-check">
          <input type="checkbox" checked={email} onChange={() => setEmail(!email)} />
          <span>Email it to the {people} it's for</span>
        </label>
      )}
      <span className="cb-reach">{reach}</span>
      <FormError error={error} />
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={props.onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving..." : editing ? "Save changes" : email ? "Post and email it" : "Post it"}
        </button>
      </div>
    </Dialog>
  );
}

/** The phone composer is a full screen with Cancel and Post in its own top bar. */
function PhoneCompose(props: {
  title: string;
  postLabel: string;
  ready: boolean;
  onClose: () => void;
  onPost: () => void;
  children: ReactNode;
}) {
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  return (
    <div className="cb-compose" role="dialog" aria-modal="true" aria-label={props.title}>
      <div className="cb-compose-bar">
        <button type="button" className="cb-cancel" onClick={props.onClose}>
          Cancel
        </button>
        <span>{props.title}</span>
        <button type="button" className="btn btn-primary" disabled={!props.ready} onClick={props.onPost}>
          {props.postLabel}
        </button>
      </div>
      <div className="cb-compose-body">{props.children}</div>
    </div>
  );
}

function DeleteNotice(props: { showId: string; notice: NoticeView; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function go() {
    setBusy(true);
    try {
      await api.deleteNotice(props.showId, props.notice.noticeId);
      props.onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <Dialog title="Delete this notice?" onClose={props.onClose}>
      <p className="cb-confirm">
        "{props.notice.title}" comes off the callboard for everyone. Emails that already went out can't be taken back.
      </p>
      <FormError error={error} />
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={props.onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void go()}>
          {busy ? "Deleting..." : "Delete notice"}
        </button>
      </div>
    </Dialog>
  );
}
