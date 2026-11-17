import { useState, type ReactNode } from "react";
import { longDate, shortWeekday, time12 } from "../../../lib/dates";
import type { AttendancePerson, CheckInStatus } from "../../../types";
import { Sheet } from "../../../ui";
import type { TechModel } from "../TechWeek";
import { NewCodeButton } from "./DoorSign";
import { CELL_LABEL, doorUrl, flagOf, isHere, key, lateNote, monthDay, nightName, nightShort, weekOf, type Cell } from "./lib";
import { QrCode } from "./QrCode";

const OPTIONS: CheckInStatus[] = ["on_time", "late", "absent"];

function Dots(props: { cells: Cell[]; tonightIndex: number }) {
  return (
    <span className="tech-dots" aria-hidden="true">
      {props.cells.map((c, i) => (
        <i key={i} className={`tech-sq-mini ${c ?? "none"}${i === props.tonightIndex && !c ? " tonight" : ""}`} />
      ))}
    </span>
  );
}

export function PhoneTech(props: { m: TechModel; banner: ReactNode }) {
  const { m } = props;
  const { att, tonight } = m;
  const [showQr, setShowQr] = useState(true);
  const [open, setOpen] = useState<string>();
  const tonightIndex = att.nights.findIndex((n) => n.date === att.tonight);
  const entry = (userId: string) => (tonight ? m.map.get(key(tonight.date, userId)) : undefined);
  const here = att.people.filter((p) => isHere(entry(p.userId)));
  const waiting = att.people.filter((p) => !isHere(entry(p.userId)));
  const next = att.nights.find((n) => !att.tonight || n.date > att.tonight);

  const card = (p: AttendancePerson) => {
    const cells = weekOf(att, m.map, p.userId);
    const t = tonightIndex >= 0 ? cells[tonightIndex] : undefined;
    const tonightText = tonightIndex < 0 ? "" : t ? `${CELL_LABEL[t]} tonight` : "Not here yet";
    const sub = [tonightText, flagOf(cells), tonightIndex >= 0 && !t ? lateNote(entry(p.userId)) : ""].filter(Boolean).join(" · ");
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
  const rest = att.people.filter((p) => !flagOf(weekOf(att, m.map, p.userId)) && (!tonight || isHere(entry(p.userId))));
  const groups = [
    { id: "eye", label: `Keep an eye on · ${flagged.length}`, people: flagged },
    { id: "rest", label: tonight ? `Checked in · ${rest.length}` : `Everyone · ${rest.length}`, people: rest },
  ].filter((g) => g.people.length);

  const person = att.people.find((p) => p.userId === open);

  return (
    <>
      <section className="tech-door" aria-label="Stage door">
        <span className="caps">Stage door{tonight ? ` · ${nightShort(tonight.date)}` : ""}</span>
        {showQr && (
          <>
            <div className="tech-door-qr">
              <QrCode value={doorUrl(m.showId, att.doorCode)} size={150} label="Stage door check-in code" />
            </div>
            <span className="tech-door-hint">Hold this up. Actors scan it to check in.</span>
          </>
        )}
        {tonight ? (
          <span className="tech-door-count">
            {here.length} <span>of {att.people.length} here</span>
          </span>
        ) : (
          <span className="tech-door-hint">
            {next
              ? `No tech call tonight. ${nightName(next, att.nights)} is ${longDate(next.date)}, ${time12(next.start)} call.`
              : "Tech week and the run are over."}
          </span>
        )}
        <div className="tech-door-actions">
          <button type="button" className="btn tech-door-btn" onClick={() => setShowQr(!showQr)}>
            {showQr ? "Hide the code" : "Show the check-in code"}
          </button>
          {showQr && <NewCodeButton m={m} className="btn tech-door-btn tech-door-btn-quiet" />}
        </div>
      </section>

      <div className="tech-mbody">
        {props.banner}
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
                    {entry(p.userId)?.runningLateMinutes ? <span> · {entry(p.userId)!.runningLateMinutes} min late</span> : null}
                  </button>
                ))}
              </div>
            ) : (
              <div className="tech-allin">Everyone's in. Places!</div>
            )}
          </>
        )}
        {!m.readOnly && <span className="small tech-hint">Tap anyone below to fix a night this week.</span>}
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
            {att.nights.map((n, i) => {
              const cell = weekOf(att, m.map, person.userId)[i] ?? null;
              const isTonight = n.date === att.tonight;
              return (
                <div key={n.date} className="tech-sheet-night">
                  <span className={isTonight ? "tech-sheet-day tonight" : "tech-sheet-day"}>
                    <strong>{isTonight ? "Tonight" : shortWeekday(n.date)}</strong>
                    <span>{monthDay(n.date)}</span>
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
