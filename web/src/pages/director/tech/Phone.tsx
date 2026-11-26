import { useState, type ReactNode } from "react";
import { longDate, shortWeekday, time12 } from "../../../lib/dates";
import { Link } from "../../../router";
import type { AttendancePerson, CheckInStatus } from "../../../types";
import { Sheet } from "../../../ui";
import type { TechModel } from "../AttendancePage";
import { CELL_LABEL, flagOf, isHere, key, monthDay, nightName, nightShort, peopleOn, reportText, weekOf, type Cell } from "./lib";
import { ComingUp, SeenButton } from "./Tonight";

const OPTIONS: CheckInStatus[] = ["on_time", "late", "absent"];
// The phone shows the last few and next few days around today, not the whole run.
const DOTS = 7;

function Dots(props: { cells: (Cell | undefined)[]; tonightIndex: number }) {
  return (
    <span className="tech-dots" aria-hidden="true">
      {props.cells.map((c, i) => (
        <i key={i} className={`tech-sq-mini ${c === undefined ? "skip" : (c ?? "none")}${i === props.tonightIndex && !c ? " tonight" : ""}`} />
      ))}
    </span>
  );
}

export function PhoneTech(props: { m: TechModel; banner: ReactNode }) {
  const { m } = props;
  const { att, tonight } = m;
  const [open, setOpen] = useState<string>();
  // A window of nights around today for the dots and the per-person sheet.
  const todayIdx = Math.max(0, att.nights.findIndex((n) => n.date >= att.today));
  const from = Math.max(0, Math.min(todayIdx - 3, att.nights.length - DOTS));
  const nights = att.nights.slice(from, from + DOTS);
  const tonightIndex = nights.findIndex((n) => n.date === att.tonight);
  const near = (userId: string) => weekOf(att, m.map, userId).slice(from, from + DOTS);
  const entry = (userId: string) => (tonight ? m.map.get(key(tonight.date, userId)) : undefined);
  const called = tonight ? peopleOn(att, tonight) : [];
  const here = called.filter((p) => isHere(entry(p.userId)));
  const told = called.filter((p) => entry(p.userId)?.report && !isHere(entry(p.userId)));
  const waiting = called.filter((p) => !isHere(entry(p.userId)) && !entry(p.userId)?.report);
  const next = att.nights.find((n) => n.date > att.today);

  const card = (p: AttendancePerson) => {
    const cells = near(p.userId);
    const t = tonightIndex >= 0 ? cells[tonightIndex] : undefined;
    const tonightText = tonightIndex < 0 || t === undefined ? "" : t ? `${CELL_LABEL[t]} today` : "Not here yet";
    const sub = [tonightText, flagOf(weekOf(att, m.map, p.userId))].filter(Boolean).join(" · ");
    return (
      <button key={p.userId} type="button" className="tech-mrow" onClick={() => setOpen(p.userId)}>
        <span className="tech-person-text">
          <strong>{p.name ?? "Someone"}</strong>
          <span>{sub || p.label}</span>
        </span>
        <Dots cells={cells} tonightIndex={tonightIndex} />
      </button>
    );
  };

  const flagged = att.people.filter((p) => flagOf(weekOf(att, m.map, p.userId)));
  const rest = att.people.filter((p) => !flagOf(weekOf(att, m.map, p.userId)));
  const groups = [
    { id: "eye", label: `Keep an eye on · ${flagged.length}`, people: flagged },
    { id: "rest", label: `Everyone else · ${rest.length}`, people: rest },
  ].filter((g) => g.people.length);

  const person = att.people.find((p) => p.userId === open);

  return (
    <>
      <section className="tech-door" aria-label="Today">
        <span className="caps">{tonight ? `${nightName(tonight)} · ${nightShort(tonight.date)} · ${time12(tonight.start)}` : "Attendance"}</span>
        {tonight ? (
          <span className="tech-door-count">
            {here.length} <span>of {called.length} here</span>
          </span>
        ) : (
          <span className="tech-door-hint">
            {next ? `Nobody's called today. Next is ${longDate(next.date)}, ${time12(next.start)} call.` : "There are no more calls."}
          </span>
        )}
        {tonight && <span className="tech-door-hint">People tap "I'm here" on their phone as they arrive.</span>}
      </section>

      <div className="tech-mbody">
        {props.banner}
        {!att.venueSet && !m.readOnly && (
          <p className="tech-venue-note">
            "I'm here" can't check that people are at the venue yet.{" "}
            <Link to={`/shows/${m.showId}/settings`}>Save where the venue is</Link> while you're standing in it.
          </p>
        )}
        {tonight && told.length > 0 && (
          <div className="tech-group">
            <span className="caps tech-group-head told">Told us · {told.length}</span>
            {told.map((p) => {
              const c = entry(p.userId)!;
              return (
                <div key={p.userId} className="tech-person">
                  <span className="tech-person-text">
                    <strong>{p.name ?? "Someone"}</strong>
                    <span>
                      <span className={c.report === "absent" ? "tech-out-note" : "tech-late-note"}>{reportText(c)}</span>
                      {c.note ? ` · "${c.note}"` : ""}
                    </span>
                  </span>
                  <SeenButton m={m} date={tonight.date} userId={p.userId} />
                </div>
              );
            })}
          </div>
        )}
        {tonight && (
          <>
            <span className="caps tech-missing-head">Still missing{m.readOnly ? "" : " · tap to check in"}</span>
            {waiting.length ? (
              <div className="tech-chips">
                {waiting.map((p) => (
                  <button
                    key={p.userId}
                    type="button"
                    className="tech-chip"
                    disabled={m.readOnly}
                    onClick={() => m.checkIn(p, tonight)}
                    aria-label={`Check in ${p.name ?? "someone"}`}
                  >
                    {p.name ?? "Someone"}
                  </button>
                ))}
              </div>
            ) : (
              <div className="tech-allin">Everyone's accounted for. Places!</div>
            )}
          </>
        )}
        <ComingUp m={m} />
        {!m.readOnly && <span className="small tech-hint">Tap anyone below to fix a day.</span>}
        {groups.map((g) => (
          <div key={g.id} className="tech-group">
            <span className={`caps tech-group-head ${g.id}`}>{g.label}</span>
            {g.people.map(card)}
          </div>
        ))}
      </div>

      {person && (
        <Sheet title={person.name ?? "Someone"} onClose={() => setOpen(undefined)}>
          {person.label && <span className="small muted tech-sheet-sub">{person.label}</span>}
          <div className="tech-sheet-nights">
            {nights.map((n, i) => {
              const cell = near(person.userId)[i];
              if (cell === undefined) return null;
              const isTonight = n.date === att.tonight;
              const said = reportText(m.map.get(key(n.date, person.userId)));
              return (
                <div key={n.date} className="tech-sheet-night">
                  <span className={isTonight ? "tech-sheet-day tonight" : "tech-sheet-day"}>
                    <strong>{isTonight ? "Today" : shortWeekday(n.date)}</strong>
                    <span>{said || monthDay(n.date)}</span>
                  </span>
                  <span className="tech-sheet-opts">
                    {OPTIONS.map((o) => (
                      <button
                        key={o}
                        type="button"
                        className={`tech-opt ${o}`}
                        aria-pressed={cell === o}
                        disabled={m.readOnly}
                        onClick={() => m.setMark(n.date, person.userId, cell === o ? null : o)}
                      >
                        {CELL_LABEL[o]}
                      </button>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
          <button type="button" className="btn btn-lg btn-block" onClick={() => setOpen(undefined)}>
            Done
          </button>
        </Sheet>
      )}
    </>
  );
}
