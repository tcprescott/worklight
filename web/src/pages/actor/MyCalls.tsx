import { useState } from "react";
import type { ShowPageProps } from "../../App";
import { api } from "../../api";
import { addDays, dateRange, dayOfMonth, hhmm, longDate, minutesOf, monthName, shortWeekday, time12, todayIso, weekStart } from "../../lib/dates";
import { Link } from "../../router";
import { useSession } from "../../session";
import { AccountMenu, ActorShell } from "../../shell";
import type { MyAttendance, MyCall, MyCheckIn, ShowDay } from "../../types";
import { ErrorView, FormError, Icon, Loading, Sheet, useToast } from "../../ui";
import { checkInHere, checkInOpen, ReportSheet, SeenPill, stillAhead, toldText } from "./Absence";
import { useAsync } from "../../useAsync";
import { callWhat, directionsUrl, lowerFirst, useDirector, useStageManager } from "./actorLib";
import { CalendarLinks, downloadCallIcs } from "./CalendarLinks";
import "./actor.css";

function weekLabel(monday: string): string {
  const thisWeek = weekStart(todayIso());
  if (monday === thisWeek) return "This week";
  if (monday === addDays(thisWeek, 7)) return "Next week";
  return `Week of ${monthName(monday)} ${dayOfMonth(monday)}`;
}

/** "7:50 PM – 9:30 PM" */
const span = (a: string, b: string) => `${time12(a)} – ${time12(b)}`;

type Row = { kind: "call"; date: string; call: MyCall } | { kind: "free"; date: string };

/** Every show day from today, with my calls on it, or "Not called". Extra calls on other days too. */
function agenda(calls: MyCall[], days: ShowDay[], skip?: string): Row[] {
  const today = todayIso();
  const rows: Row[] = calls.filter((c) => c.callId !== skip).map((call) => ({ kind: "call" as const, date: call.date, call }));
  const called = new Set(calls.map((c) => c.date));
  for (const d of days) if (d.date >= today && !called.has(d.date)) rows.push({ kind: "free", date: d.date });
  return rows.sort(
    (a, b) => a.date.localeCompare(b.date) || (a.kind === "call" && b.kind === "call" ? a.call.start.localeCompare(b.call.start) : 0),
  );
}

export function MyCalls(props: ShowPageProps) {
  const show = props.view.show;
  const archived = show.status === "archived";
  const { me } = useSession();
  const director = useDirector(show.showId);
  const { data, error, reload } = useAsync(
    () =>
      archived
        ? Promise.resolve<[MyCall[], ShowDay[], MyAttendance | null]>([[], [], null])
        : Promise.all([
            api.myCalls(show.showId),
            api.myDays().catch(() => [] as ShowDay[]),
            api.myAttendance(show.showId).catch(() => null),
          ]),
    [show.showId, archived],
  );
  const [reporting, setReporting] = useState<MyCall>();
  const sm = useStageManager(show.showId);
  const archivedShows = me.shows.filter((s) => s.show.status === "archived");
  const [calOpen, setCalOpen] = useState(false);
  const [toast, showToast] = useToast();
  const addOne = (call: MyCall) =>
    downloadCallIcs(call.callId, `${show.name} ${call.date}`).catch((err: Error) => showToast(err.message));

  const calls = data?.[0] ?? [];
  const days = (data?.[1] ?? []).filter((d) => d.showId === show.showId);
  const att = data?.[2] ?? null;
  const mine = new Map((att?.checkins ?? []).map((c) => [c.date, c]));
  const live = calls.filter((c) => !c.cancelled);
  const reportable = live.filter(stillAhead);
  const report = archived ? undefined : (call: MyCall) => setReporting(call);
  const today = todayIso();
  const featured = live.find((c) => c.date === today) ?? live.find((c) => c.date > today);
  const rows = agenda(calls, days, featured?.callId);
  // A week with no calls at all hasn't been published yet: say so instead of "Not called" every night.
  const calledWeeks = new Set(calls.map((c) => weekStart(c.date)));
  let lastWeek = "";

  return (
    <ActorShell showId={show.showId} current="calls" archived={archived}>
      {featured ? (
        <TonightCard
          call={featured}
          tonight={featured.date === today}
          showId={show.showId}
          isStaff={props.view.role === "staff"}
          onAdd={addOne}
          att={att}
          mine={mine.get(featured.date)}
          onReport={report}
          onCheckedIn={() => void reload()}
        />
      ) : (
        <header className="actor-head" style={{ borderBottom: "none" }}>
          <div className="actor-topline">
            <span className="kicker">{show.name}</span>
            <AccountMenu showId={show.showId} isStaff={props.view.role === "staff"} />
          </div>
          <h1>My calls</h1>
        </header>
      )}

      {archived ? (
        <div className="actor-section" style={{ paddingBottom: 8 }}>
          <div className="actor-empty">
            <strong>No calls</strong>
            This show is archived, so there are no calls to show.
          </div>
        </div>
      ) : error ? (
        <ErrorView message={error} onRetry={() => void reload()} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          {!featured && (
            <div className="actor-section" style={{ paddingBottom: 8 }}>
              <div className="actor-empty">
                <strong>No calls yet</strong>
                {`${director.Name} hasn't published a schedule that calls you. When it's out, your call times show up here.`}
              </div>
            </div>
          )}
          <div className="actor-section-head actor-calls-head">
            <h2>All your calls</h2>
            <button type="button" className="btn btn-sm btn-outline actor-cal-btn" onClick={() => setCalOpen(true)}>
              Add all to calendar
            </button>
          </div>
          {rows.length === 0 ? (
            <div className="actor-section">
              <p className="small muted">Nothing else on the calendar yet.</p>
            </div>
          ) : (
            <div className="actor-agenda">
              {rows.map((r) => {
                const wk = weekStart(r.date);
                const label = wk !== lastWeek ? weekLabel(wk) : "";
                lastWeek = wk;
                return (
                  <div key={r.kind === "call" ? r.call.callId : r.date} style={{ display: "contents" }}>
                    {label && <div className="actor-agenda-week">{label}</div>}
                    {r.kind === "free" ? (
                      <div className="actor-agenda-row">
                        <span className="cond">
                          {shortWeekday(r.date)} {dayOfMonth(r.date)}
                        </span>
                        <span>{calledWeeks.has(wk) ? "Not called" : "Schedule not out yet"}</span>
                      </div>
                    ) : (
                      <CallRow call={r.call} onAdd={addOne} mine={mine.get(r.call.date)} onReport={report} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {archivedShows.length > 0 && (
        <>
          <div className="actor-section-head">
            <h2>Archived</h2>
          </div>
          <div className="actor-section">
            <div className="list">
              {archivedShows.map((s) => (
                <Link key={s.show.showId} to={`/shows/${s.show.showId}`} className="actor-archived-row">
                  <span>
                    <strong>{s.show.name}</strong>
                    <span>
                      {s.theaterName} · {dateRange(s.show.startDate, s.show.endDate)}
                    </span>
                  </span>
                  <Icon name="right" />
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
      {calOpen && (
        <Sheet title="Add your calls to a calendar" onClose={() => setCalOpen(false)}>
          <p className="small muted" style={{ marginTop: -6 }}>
            One private link with every call you're in, for every show. It keeps itself up to date.
          </p>
          <CalendarLinks />
          <button type="button" className="btn btn-block" onClick={() => setCalOpen(false)}>
            Done
          </button>
        </Sheet>
      )}
      {reporting && (
        <ReportSheet
          showId={show.showId}
          call={reporting}
          others={reportable.filter((c) => c.callId !== reporting.callId)}
          existing={mine.get(reporting.date)}
          smName={sm.first ?? "stage management"}
          onClose={() => setReporting(undefined)}
          onSent={(msg) => {
            setReporting(undefined);
            showToast(msg);
            void reload();
          }}
        />
      )}
      {toast}
    </ActorShell>
  );
}

/** An ISO timestamp as "6:22 PM" where the show is. */
function clock(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function placeLine(call: MyCall): string {
  return [call.location, call.bring ? `Bring ${lowerFirst(call.bring)}` : ""].filter(Boolean).join(" · ");
}

function CallRow(props: { call: MyCall; onAdd: (call: MyCall) => void; mine?: MyCheckIn; onReport?: (call: MyCall) => void }) {
  const c = props.call;
  const place = placeLine(c);
  const told = props.mine?.report ? props.mine : undefined;
  const canReport = !c.cancelled && props.onReport && stillAhead(c);
  return (
    <div className={c.cancelled ? "actor-call cancelled" : "actor-call"}>
      <span className="datemark">
        <span className="wd">{shortWeekday(c.date)}</span>
        <span className="n">{dayOfMonth(c.date)}</span>
      </span>
      <div className="actor-call-text">
        <span className="actor-call-time">{span(c.start, c.end)}</span>
        <span className="actor-call-what">{callWhat(c)}</span>
        {c.cancelled ? <span className="actor-call-cancel">Cancelled</span> : place && <span className="actor-call-place">{place}</span>}
        {!c.cancelled && c.note && <span className="actor-call-place">{c.note}</span>}
        {!c.cancelled && told && (
          <span className="actor-call-told">
            {toldText(told)} <SeenPill c={told} />
          </span>
        )}
        {canReport && (
          <button type="button" className="link-btn actor-call-report" onClick={() => props.onReport!(c)}>
            {told ? "Change this" : "Can't make it?"}
          </button>
        )}
      </div>
      {!c.cancelled && (
        <button type="button" className="actor-call-add" aria-label="Add to calendar" title="Add to calendar" onClick={() => props.onAdd(c)}>
          <Icon name="calendar" />
        </button>
      )}
    </div>
  );
}

function TonightCard(props: {
  call: MyCall;
  tonight: boolean;
  showId: string;
  isStaff: boolean;
  onAdd: (call: MyCall) => void;
  att: MyAttendance | null;
  mine?: MyCheckIn;
  onReport?: (call: MyCall) => void;
  onCheckedIn: () => void;
}) {
  const c = props.call;
  const sm = useStageManager(props.showId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const directions = directionsUrl(c);
  const place = placeLine(c);
  const arrived = props.mine?.arrivedAt && (props.mine.status === "on_time" || props.mine.status === "late");
  const told = props.mine?.report && !arrived ? props.mine : undefined;
  const canHere = props.tonight && !arrived && props.mine?.report !== "absent" && checkInOpen(c, props.att?.checkInEarlyMinutes ?? 30);

  async function here() {
    setBusy(true);
    setError(undefined);
    try {
      await checkInHere(props.showId, props.att?.venueSet ?? false);
      props.onCheckedIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const actions = [directions ? "dir" : "", canHere ? "here" : ""].filter(Boolean);
  const early = props.att?.checkInEarlyMinutes ?? 30;
  const opensLater = props.tonight && !arrived && !canHere && props.mine?.report !== "absent" && stillAhead(c);

  return (
    <header className="actor-tonight">
      <div className="actor-topline">
        <span className="caps">
          {props.tonight ? "Tonight" : "Next call"} · {longDate(c.date)}
        </span>
        <AccountMenu showId={props.showId} isStaff={props.isStaff} />
      </div>
      <span className="actor-tonight-time">{time12(c.start)}</span>
      <span className="actor-tonight-what">
        {callWhat(c)} · until {time12(c.end)}
      </span>
      {place && <span className="actor-tonight-place">{place}</span>}
      {c.note && <span className="actor-tonight-place">{c.note}</span>}
      {actions.length > 0 && (
        <div className={actions.length === 2 ? "actor-tonight-actions" : "actor-tonight-actions one"}>
          {canHere && (
            <button type="button" className="btn btn-lg actor-tonight-here" disabled={busy} onClick={() => void here()}>
              {busy ? "Checking you in..." : "I'm here"}
            </button>
          )}
          {directions && (
            <a className="btn btn-lg actor-tonight-dir" href={directions} target="_blank" rel="noreferrer">
              Directions
            </a>
          )}
        </div>
      )}
      {opensLater && <span className="actor-tonight-place">"I'm here" opens at {time12(hhmm(minutesOf(c.start) - early))}.</span>}
      {error && (
        <div className="actor-tonight-told warn" role="alert">
          {error}
        </div>
      )}
      {arrived && props.mine && (
        <div className="actor-tonight-told ok" role="status">
          ✓ Checked in at {clock(props.mine.arrivedAt!, c.timezone)}.{" "}
          {props.mine.location === "unknown"
            ? `We couldn't confirm where you are, so ${sm.first ?? "stage management"} will see that.`
            : `${sm.first ?? "Stage management"} can see you're here.`}
        </div>
      )}
      {told && (
        <div className="actor-tonight-told" role="status">
          {toldText(told)}. <SeenPill c={told} />
        </div>
      )}
      <div className="actor-tonight-links">
        {props.onReport && !arrived && stillAhead(c) && (
          <button type="button" className="actor-tonight-add" onClick={() => props.onReport!(c)}>
            {told ? "Change what you told them" : props.tonight ? "Running late or can't make it?" : "Can't make it?"}
          </button>
        )}
        <button type="button" className="actor-tonight-add" onClick={() => props.onAdd(c)}>
          Add to calendar
        </button>
      </div>
    </header>
  );
}
