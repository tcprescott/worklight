import type { ReactNode } from "react";
import { longDate, time12 } from "../../../lib/dates";
import { Link } from "../../../router";
import { Progress } from "../../../ui";
import type { TechModel } from "../TechWeek";
import { SignCard } from "./DoorSign";
import { clockTime, isHere, key, lateNote, nightName } from "./lib";

export function TechTabs(props: { showId: string; current: "tonight" | "week" }) {
  const base = `/shows/${props.showId}/tech`;
  return (
    <nav className="segmented" aria-label="Tech week views">
      <Link to={base} current={props.current === "tonight"}>
        Tonight
      </Link>
      <Link to={`${base}/week`} current={props.current === "week"}>
        Whole week
      </Link>
    </nav>
  );
}

export function Tonight(props: { m: TechModel; banner: ReactNode }) {
  const { m } = props;
  const { att, tonight } = m;
  const today = att.tonight ?? null;
  const next = att.nights.find((n) => !today || n.date > today);

  let kicker = "Tech week";
  let lede: string;
  if (tonight) {
    kicker = `Tech week · ${nightName(tonight, att.nights)} · ${time12(tonight.start)} call`;
    lede = "People check themselves in by scanning the code at the stage door. This page updates as they arrive.";
  } else if (next) {
    lede = `There's no tech call tonight. Next is ${nightName(next, att.nights)}, ${longDate(next.date)}, ${time12(next.start)} call.`;
  } else {
    lede = "Tech week and the run are over. The whole week's attendance is kept under Whole week.";
  }

  return (
    <main className="page tech-tonight">
      <div className="tech-main">
        <div className="tech-head">
          <span className="kicker">{kicker}</span>
          <h1 className="title">Who's in the building</h1>
          <p className="lede">{lede}</p>
        </div>
        <TechTabs showId={m.showId} current="tonight" />
        {props.banner}
        {tonight && <TonightLists m={m} />}
      </div>
      <SignCard m={m} />
    </main>
  );
}

function TonightLists(props: { m: TechModel }) {
  const { m } = props;
  const night = m.tonight!;
  const people = m.att.people;
  const entry = (userId: string) => m.map.get(key(night.date, userId));
  const waiting = people.filter((p) => !isHere(entry(p.userId)));
  const arrived = people
    .filter((p) => isHere(entry(p.userId)))
    .sort((a, b) => (entry(b.userId)?.arrivedAt ?? "").localeCompare(entry(a.userId)?.arrivedAt ?? ""));
  const total = people.length;

  return (
    <>
      <div className="tech-count">
        <Progress parts={[{ value: arrived.length }]} total={total} label="Checked in" />
        <strong>
          {arrived.length} of {total} here
        </strong>
      </div>
      <div className="tech-cols">
        <section className="tech-col tech-col-waiting" aria-label="Not here yet">
          <h2>
            Not here yet <span>{waiting.length}</span>
          </h2>
          {waiting.length === 0 && <p className="tech-col-empty">Everyone's in. Places!</p>}
          {waiting.map((p) => {
            const c = entry(p.userId);
            const sub = [p.label, c?.status === "absent" ? "marked absent" : ""].filter(Boolean).join(" · ");
            const note = lateNote(c);
            return (
              <div key={p.userId} className="tech-person">
                <span className="tech-person-text">
                  <strong>{p.name ?? "Someone"}</strong>
                  {(sub || note) && (
                    <span>
                      {sub}
                      {sub && note ? " · " : ""}
                      {note && <span className="tech-late-note">{note}</span>}
                    </span>
                  )}
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
            return (
              <div key={p.userId} className="tech-person">
                <span className="tech-person-text">
                  <strong>{p.name ?? "Someone"}</strong>
                  {p.label && <span>{p.label}</span>}
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
