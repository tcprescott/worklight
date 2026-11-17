import { useCallback, useEffect, useRef, useState } from "react";
import type { ShowPageProps } from "../../App";
import { api } from "../../api";
import { daysBetween, longDate, longWeekday, monthName, dayOfMonth, time12, todayIso, dateRange } from "../../lib/dates";
import { Link } from "../../router";
import { useSession } from "../../session";
import { AccountMenu, ActorShell } from "../../shell";
import type { Callboard, MyCall, MyConflicts, NoticeView, ShowDay } from "../../types";
import { DateMark, Icon } from "../../ui";
import { useAsync } from "../../useAsync";
import { callWhat, KIND_LABEL, useDirector } from "./actorLib";
import { AUDIENCE_LABEL, excerpt, postedWhen } from "../callboardLib";
import "./actor.css";

function opensLine(opening: string | null | undefined, start: string, end: string): string {
  const today = todayIso();
  if (!opening) return dateRange(start, end);
  const n = daysBetween(today, opening);
  const when = `${longWeekday(opening)}, ${monthName(opening)} ${dayOfMonth(opening)}`;
  if (n > 1) return `Opens ${when} · ${n} days`;
  if (n === 1) return `Opens tomorrow, ${when}`;
  if (n === 0) return `Opens tonight`;
  return today <= end ? `Running through ${monthName(end)} ${dayOfMonth(end)}` : `Closed ${monthName(end)} ${dayOfMonth(end)}`;
}

export function ShowHome(props: ShowPageProps) {
  const { view } = props;
  const show = view.show;
  const archived = show.status === "archived";
  const { me } = useSession();
  const director = useDirector(show.showId);
  const { data } = useAsync(
    () =>
      archived
        ? Promise.resolve<[ShowDay[], MyConflicts | undefined, MyCall[]]>([[], undefined, []])
        : Promise.all([
            api.myDays().catch(() => [] as ShowDay[]),
            api.myConflicts().catch(() => undefined),
            api.myCalls(show.showId).catch(() => [] as MyCall[]),
          ]),
    [show.showId, archived],
  );
  const next = data?.[0].find((d) => d.showId === show.showId);
  const today = todayIso();
  const call = data?.[2].find((c) => !c.cancelled && c.date >= today);
  const mine = me.shows.find((s) => s.show.showId === show.showId);
  const needsConflicts = !archived && mine && !mine.conflictsSubmittedAt;
  const hasAny = !!data?.[1] && (data[1].weekly.length > 0 || data[1].dates.length > 0);

  return (
    <ActorShell showId={show.showId} current="show" archived={archived}>
      <header className="actor-banner">
        <div className="actor-topline" style={{ alignItems: "flex-start" }}>
          <span className="caps">{view.theaterName}</span>
          <AccountMenu showId={show.showId} isStaff={view.role === "staff"} />
        </div>
        <h1>{show.name}</h1>
        <div className="sub">{archived ? dateRange(show.startDate, show.endDate) : opensLine(show.openingDate, show.startDate, show.endDate)}</div>
        {!archived && data && (
          <div className="actor-next">
            {call ? (
              <>
                <DateMark date={call.date} />
                <div className="actor-next-text">
                  <span className="caps">{call.date === today ? "You're called tonight" : "You're called"}</span>
                  <strong>
                    {time12(call.start)} · {callWhat(call)}
                  </strong>
                  <span>{call.location ?? show.venue ?? ""}</span>
                </div>
              </>
            ) : next ? (
              <>
                <DateMark date={next.date} />
                <div className="actor-next-text">
                  <span className="caps">Next {next.kind === "rehearsal" ? "rehearsal" : KIND_LABEL[next.kind].toLowerCase()}</span>
                  <strong>
                    {next.start ? time12(next.start) : longDate(next.date)}
                    {next.start && next.end ? ` · until ${time12(next.end)}` : ""}
                  </strong>
                  <span>{show.venue ?? "Your call times arrive with the schedule"}</span>
                </div>
              </>
            ) : (
              <div className="actor-next-text">
                <span className="caps">Next rehearsal</span>
                <strong>No rehearsals on the calendar yet</strong>
                <span>{director.Name} will set the dates.</span>
              </div>
            )}
          </div>
        )}
      </header>

      {archived && (
        <div className="actor-section" style={{ paddingTop: 18 }}>
          <div className="actor-empty">
            <strong>This show is archived</strong>
            {show.venue ? `${show.venue}, ` : ""}
            {dateRange(show.startDate, show.endDate)}. You can look back at it, but nothing here can be changed now.
          </div>
        </div>
      )}

      {needsConflicts && (
        <>
          <div className="actor-section-head">
            <h2>To do</h2>
          </div>
          <div className="actor-section" style={{ paddingBottom: 4 }}>
            <Link to={`/shows/${show.showId}/${hasAny ? "conflicts" : "setup"}`} className="actor-todo">
              <span className="actor-todo-text">
                <strong>Send your conflicts</strong>
                <span>
                  {show.conflictDeadline
                    ? `${director.Name} needs them by ${longDate(show.conflictDeadline)}.`
                    : `${director.Name} needs them to build the schedule.`}
                </span>
              </span>
              <Icon name="right" />
            </Link>
          </div>
        </>
      )}

      <Announcements showId={show.showId} archived={archived} directorName={director.name} />
    </ActorShell>
  );
}

/** Fully shown notices count as read once they've been on screen this long. */
const SEEN_MS = 2000;

function Announcements(props: { showId: string; archived: boolean; directorName: string }) {
  const { data: board } = useAsync<Callboard | undefined>(() => api.callboard(props.showId).catch(() => undefined), [props.showId]);
  const [open, setOpen] = useState<string>();
  // Tapped this visit: no longer marked new. Sent: already told the server.
  const [tapped, setTapped] = useState<Set<string>>(new Set());
  const sent = useRef(new Set<string>());

  const { showId } = props;
  const markRead = useCallback(
    (id: string) => {
      if (sent.current.has(id)) return;
      sent.current.add(id);
      void api.markNoticesRead(showId, [id]).catch(() => sent.current.delete(id));
    },
    [showId],
  );

  const notices = board?.notices ?? [];
  const isNew = (n: NoticeView) => !n.read && !tapped.has(n.noticeId);
  const unread = notices.filter(isNew).length;

  return (
    <>
      <div className="actor-section-head">
        <h2>Announcements</h2>
        {notices.length > 0 && <span className="actor-unread-count">{unread ? `${unread} new` : "All read"}</span>}
      </div>
      <div className="actor-section">
        {!board ? null : notices.length === 0 ? (
          <div className="actor-empty">
            <strong>No announcements yet</strong>
            {props.archived ? "Nothing was posted for this show." : `Notices from ${props.directorName} and the stage manager will show up here.`}
          </div>
        ) : (
          notices.map((n) => (
            <NoticeCard
              key={n.noticeId}
              n={n}
              unread={isNew(n)}
              expanded={open === n.noticeId}
              onSeen={markRead}
              onTap={() => {
                setOpen(open === n.noticeId ? undefined : n.noticeId);
                if (!n.read) {
                  setTapped(new Set(tapped).add(n.noticeId));
                  markRead(n.noticeId);
                }
              }}
            />
          ))
        )}
      </div>
    </>
  );
}

function NoticeCard(props: { n: NoticeView; unread: boolean; expanded: boolean; onTap: () => void; onSeen: (noticeId: string) => void }) {
  const { n, onSeen } = props;
  const short = excerpt(n.body);
  const whole = short === n.body.replace(/\s+/g, " ").trim();
  const ref = useRef<HTMLButtonElement>(null);
  // A short notice is read in full without a tap, so seeing it for a moment counts.
  useEffect(() => {
    if (!whole || n.read || !ref.current || typeof IntersectionObserver === "undefined") return;
    let timer: number | undefined;
    const io = new IntersectionObserver(([entry]) => {
      window.clearTimeout(timer);
      if (entry?.isIntersecting) timer = window.setTimeout(() => onSeen(n.noticeId), SEEN_MS);
    }, { threshold: 0.8 });
    io.observe(ref.current);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, [whole, n.read, n.noticeId, onSeen]);
  return (
    <button
      ref={ref}
      type="button"
      className={props.unread ? "actor-notice unread" : "actor-notice"}
      aria-expanded={whole ? undefined : props.expanded}
      onClick={props.onTap}
    >
      <span className="actor-notice-top">
        {props.unread && <span className="actor-notice-dot" aria-label="New" />}
        <strong>{n.title}</strong>
        <span className="actor-notice-when">{postedWhen(n.createdAt)}</span>
      </span>
      <span className="actor-notice-body">{props.expanded || whole ? n.body : short}</span>
      <span className="actor-notice-who">
        {n.authorName ?? "Stage management"} · to {AUDIENCE_LABEL[n.audience].toLowerCase()}
      </span>
    </button>
  );
}
