import type { ShowPageProps } from "../../App";
import { api } from "../../api";
import { addDays, dateRange, dayOfMonth, monthName, shortWeekday, timeRange, todayIso, weekStart } from "../../lib/dates";
import { Link } from "../../router";
import { useSession } from "../../session";
import { AccountMenu, ActorShell } from "../../shell";
import type { ShowDay } from "../../types";
import { ErrorView, Icon, Loading } from "../../ui";
import { useAsync } from "../../useAsync";
import { KIND_LABEL, useDirector } from "./actorLib";
import "./actor.css";

function weekLabel(monday: string): string {
  const thisWeek = weekStart(todayIso());
  if (monday === thisWeek) return "This week";
  if (monday === addDays(thisWeek, 7)) return "Next week";
  return `Week of ${monthName(monday)} ${dayOfMonth(monday)}`;
}

export function MyCalls(props: ShowPageProps) {
  const show = props.view.show;
  const archived = show.status === "archived";
  const { me } = useSession();
  const director = useDirector(show.showId);
  const { data, error, reload } = useAsync(() => (archived ? Promise.resolve([] as ShowDay[]) : api.myDays()), [archived]);
  const days = (data ?? []).filter((d) => d.showId === show.showId);
  const archivedShows = me.shows.filter((s) => s.show.status === "archived");
  let lastWeek = "";

  return (
    <ActorShell showId={show.showId} current="calls" archived={archived}>
      <header className="actor-head" style={{ borderBottom: "none" }}>
        <div className="actor-topline">
          <span className="kicker">{show.name}</span>
          <AccountMenu showId={show.showId} isStaff={props.view.role === "staff"} />
        </div>
        <h1>My calls</h1>
      </header>

      <div className="actor-section" style={{ paddingBottom: 8 }}>
        <div className="actor-empty">
          <strong>No calls yet</strong>
          {archived
            ? "This show is archived, so there are no calls to show."
            : `${director.Name} hasn't published the schedule. When it's out, your call times show up here.`}
        </div>
      </div>

      {!archived && (
        <>
          <div className="actor-section-head">
            <h2>Rehearsal dates</h2>
          </div>
          {error ? (
            <ErrorView message={error} onRetry={() => void reload()} />
          ) : !data ? (
            <Loading />
          ) : days.length === 0 ? (
            <div className="actor-section">
              <p className="small muted">No dates on the calendar yet.</p>
            </div>
          ) : (
            <div className="actor-agenda">
              {days.map((d) => {
                const wk = weekStart(d.date);
                const label = wk !== lastWeek ? weekLabel(wk) : "";
                lastWeek = wk;
                const time = d.start && d.end ? timeRange(d.start, d.end) : "";
                return (
                  <div key={d.date} style={{ display: "contents" }}>
                    {label && <div className="actor-agenda-week">{label}</div>}
                    <div className="actor-agenda-row">
                      <span className="cond">
                        {shortWeekday(d.date)} {dayOfMonth(d.date)}
                      </span>
                      <span>
                        {d.kind === "rehearsal" ? "Not called yet" : KIND_LABEL[d.kind]}
                        {time ? ` · ${time}` : ""}
                      </span>
                    </div>
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
    </ActorShell>
  );
}
