import type { ReactNode } from "react";
import { longDate, time12 } from "../../../lib/dates";
import { Link } from "../../../router";
import { Progress } from "../../../ui";
import type { TechModel } from "../AttendancePage";
import { calledOn, clockTime, isHere, key, nightName, nightShort, peopleOn, reportText } from "./lib";

export function TechTabs(props: { showId: string; current: "tonight" | "all" }) {
  const base = `/shows/${props.showId}/attendance`;
  return (
    <nav className="segmented" aria-label="Attendance views">
      <Link to={base} current={props.current === "tonight"}>
        Today
      </Link>
      <Link to={`${base}/all`} current={props.current === "all"}>
        Every call
      </Link>
    </nav>
  );
}

export function Tonight(props: { m: TechModel; banner: ReactNode }) {
  const { m } = props;
  const { att, tonight } = m;
  const next = att.nights.find((n) => n.date > att.today);

  let kicker = "Attendance";
  let lede: string;
  if (tonight) {
    kicker = `${nightName(tonight)} · ${longDate(tonight.date)} · ${time12(tonight.start)} call`;
    lede = "People tap \"I'm here\" on their phone when they arrive. This page updates as they do.";
  } else if (next) {
    lede = `Nobody's called today. Next is ${nightName(next).toLowerCase()} on ${longDate(next.date)}, ${time12(next.start)} call.`;
  } else {
    lede = "There are no more calls. Every call's attendance is kept under Every call.";
  }

  return (
    <main className="page">
      <div className="tech-head">
        <span className="kicker">{kicker}</span>
        <h1 className="title">Who's here</h1>
        <p className="lede">{lede}</p>
      </div>
      <TechTabs showId={m.showId} current="tonight" />
      {props.banner}
      {!att.venueSet && !m.readOnly && (
        <p className="tech-venue-note">
          "I'm here" can't check that people are at the venue yet.{" "}
          <Link to={`/shows/${m.showId}/settings`}>Save where the venue is</Link> while you're standing in it.
        </p>
      )}
      {tonight && <TonightLists m={m} />}
      <ComingUp m={m} />
    </main>
  );
}

function TonightLists(props: { m: TechModel }) {
  const { m } = props;
  const night = m.tonight!;
  const people = peopleOn(m.att, night);
  const entry = (userId: string) => m.map.get(key(night.date, userId));
  const told = people.filter((p) => entry(p.userId)?.report && !isHere(entry(p.userId)));
  const waiting = people.filter((p) => !isHere(entry(p.userId)) && !entry(p.userId)?.report);
  const arrived = people
    .filter((p) => isHere(entry(p.userId)))
    .sort((a, b) => (entry(b.userId)?.arrivedAt ?? "").localeCompare(entry(a.userId)?.arrivedAt ?? ""));
  const out = people.filter((p) => entry(p.userId)?.status === "absent" || entry(p.userId)?.report === "absent").length;
  const total = people.length;

  return (
    <>
      <div className="tech-count">
        <Progress parts={[{ value: arrived.length }]} total={total} label="Checked in" />
        <strong>
          {arrived.length} of {total} here{out ? ` · ${out} out` : ""}
        </strong>
      </div>
      <div className="tech-cols">
        <section className="tech-col tech-col-told" aria-label="Told us">
          <h2>
            Told us <span>{told.length}</span>
          </h2>
          {told.length === 0 && <p className="tech-col-empty">Nobody has said they'll be out or late.</p>}
          {told.map((p) => {
            const c = entry(p.userId)!;
            return (
              <div key={p.userId} className="tech-person">
                <span className="tech-person-text">
                  <strong>{p.name ?? "Someone"}</strong>
                  <span>
                    <span className={c.report === "absent" ? "tech-out-note" : "tech-late-note"}>{reportText(c)}</span>
                    {p.label ? ` · ${p.label}` : ""}
                    {c.note ? ` · "${c.note}"` : ""}
                    {c.status === "absent" ? " · marked absent" : ""}
                  </span>
                </span>
                <SeenButton m={m} date={night.date} userId={p.userId} />
                {!m.readOnly && c.report !== "absent" && (
                  <button type="button" className="btn btn-sm tech-checkin" onClick={() => m.checkIn(p, night)}>
                    Check in
                  </button>
                )}
              </div>
            );
          })}
        </section>
        <section className="tech-col tech-col-waiting" aria-label="Not here yet">
          <h2>
            Not here yet <span>{waiting.length}</span>
          </h2>
          {waiting.length === 0 && <p className="tech-col-empty">Everyone's accounted for. Places!</p>}
          {waiting.map((p) => {
            const c = entry(p.userId);
            const own = calledOn(night, p.userId);
            const sub = [p.label, own && own.start !== night.start ? `called ${time12(own.start)}` : "", c?.status === "absent" ? "marked absent" : ""]
              .filter(Boolean)
              .join(" · ");
            return (
              <div key={p.userId} className="tech-person">
                <span className="tech-person-text">
                  <strong>{p.name ?? "Someone"}</strong>
                  {sub && <span>{sub}</span>}
                </span>
                {!m.readOnly && (
                  <button type="button" className="btn btn-sm tech-checkin" onClick={() => m.checkIn(p, night)}>
                    Check in
                  </button>
                )}
              </div>
            );
          })}
        </section>
        <section className="tech-col tech-col-arrived" aria-label="Arrived">
          <h2>
            Arrived <span>{arrived.length}</span>
          </h2>
          {arrived.length === 0 && <p className="tech-col-empty">Nobody has checked in yet.</p>}
          {arrived.map((p) => {
            const c = entry(p.userId)!;
            const sub = p.label ?? "";
            return (
              <div key={p.userId} className="tech-person">
                <span className="tech-person-text">
                  <strong>{p.name ?? "Someone"}</strong>
                  {(sub || c.location === "unknown") && (
                    <span>
                      {sub}
                      {sub && c.location === "unknown" ? " · " : ""}
                      {c.location === "unknown" && <span className="tech-late-note">location not confirmed</span>}
                    </span>
                  )}
                </span>
                <span className={c.status === "late" ? "tech-time late" : "tech-time"}>
                  {c.status === "late" && <span className="tech-time-tag">late</span>}
                  {clockTime(c.arrivedAt, m.timezone)}
                </span>
              </div>
            );
          })}
        </section>
      </div>
    </>
  );
}

/** "Got it" for staff, or who already said it. */
export function SeenButton(props: { m: TechModel; date: string; userId: string }) {
  const c = props.m.map.get(key(props.date, props.userId));
  if (!c?.report) return null;
  if (c.seenBy) {
    const who = props.m.att.seenNames[c.seenBy];
    return <span className="tech-seen">✓ {who && who !== "You" ? `Seen by ${who.split(" ")[0]}` : "Seen"}</span>;
  }
  if (props.m.readOnly) return null;
  return (
    <button type="button" className="btn btn-sm btn-primary tech-gotit" onClick={() => props.m.markSeen(props.date, props.userId)}>
      Got it
    </button>
  );
}

/** Reports for later calls, so stage management can say "Got it" well ahead. */
export function ComingUp(props: { m: TechModel }) {
  const { m } = props;
  const names = new Map(m.att.people.map((p) => [p.userId, p.name ?? "Someone"]));
  const later = m.att.checkins
    .filter((c) => c.report && c.date > m.att.today)
    .sort((a, b) => a.date.localeCompare(b.date) || (names.get(a.userId) ?? "").localeCompare(names.get(b.userId) ?? ""));
  if (!later.length) return null;
  return (
    <section className="tech-upcoming" aria-label="Coming up">
      <h2 className="caps">Coming up · {later.length}</h2>
      {later.map((c) => (
        <div key={key(c.date, c.userId)} className="tech-person">
          <span className="tech-person-text">
            <strong>{names.get(c.userId) ?? "Someone"}</strong>
            <span>
              <span className={c.report === "absent" ? "tech-out-note" : "tech-late-note"}>{reportText(c)}</span>
              {` · ${nightShort(c.date)}`}
              {c.note ? ` · "${c.note}"` : ""}
            </span>
          </span>
          <SeenButton m={m} date={c.date} userId={c.userId} />
        </div>
      ))}
    </section>
  );
}
