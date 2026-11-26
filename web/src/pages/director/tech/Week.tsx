import type { CSSProperties, ReactNode } from "react";
import { shortWeekday } from "../../../lib/dates";
import type { TechModel } from "../AttendancePage";
import { CELL_LABEL, exportCsv, flagOf, key, monthDay, nextCell, reportText, weekOf, type Cell } from "./lib";
import { ComingUp, TechTabs } from "./Tonight";

export function Square(props: { cell: Cell; onClick?: () => void; label: string; told?: boolean }) {
  const text = props.cell === "late" ? "late" : props.cell === "absent" ? "out" : props.told ? "told" : "";
  return (
    <button
      type="button"
      className={`tech-sq ${props.cell ?? "none"}${props.told ? " told" : ""}`}
      onClick={props.onClick}
      disabled={!props.onClick}
      aria-label={props.label}
      title={props.label}
    >
      {text}
    </button>
  );
}

export function Legend() {
  return (
    <div className="tech-legend">
      <span>
        <i className="tech-sq-mini on_time" />
        On time
      </span>
      <span>
        <i className="tech-sq-mini late" />
        Late
      </span>
      <span>
        <i className="tech-sq-mini absent" />
        Absent
      </span>
      <span>
        <i className="tech-sq-mini none" />
        Not yet
      </span>
      <span>
        <i className="tech-sq-mini none told" />
        Told us ahead
      </span>
      <span>
        <i className="tech-sq-mini skip" />
        Not called
      </span>
    </div>
  );
}

export function WholeWeek(props: { m: TechModel; banner: ReactNode }) {
  const { m } = props;
  const { att } = m;
  const cols: CSSProperties = { gridTemplateColumns: `220px repeat(${att.nights.length}, minmax(60px, 1fr)) 110px` };
  const minWidth = 220 + 110 + att.nights.length * 76;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="title">Every call</h1>
          <p className="lede">
            One column per day with calls. Squares fill in as people tap "I'm here".
            {m.readOnly ? "" : " Click any square to fix it."}
          </p>
        </div>
        <button type="button" className="btn" onClick={() => exportCsv(att, m.map, m.showName)}>
          Export for the board
        </button>
      </div>
      <TechTabs showId={m.showId} current="all" />
      {props.banner}
      <Legend />
      <div className="tech-grid-wrap">
        <div className="tech-grid" style={{ minWidth }} role="table" aria-label="Attendance by night">
          <div className="tech-grid-row tech-grid-head" style={cols} role="row">
            <div className="caps tech-grid-person" role="columnheader">
              Person
            </div>
            {att.nights.map((n) => {
              const t = n.date === att.tonight;
              return (
                <div key={n.date} className={t ? "tech-grid-night tonight" : "tech-grid-night"} role="columnheader">
                  <span>{t ? "Tonight" : shortWeekday(n.date)}</span>
                  <strong>{monthDay(n.date)}</strong>
                </div>
              );
            })}
            <div className="caps tech-grid-flag" role="columnheader">
              Flags
            </div>
          </div>
          {att.people.map((p) => {
            const cells = weekOf(att, m.map, p.userId);
            return (
              <div key={p.userId} className="tech-grid-row" style={cols} role="row">
                <div className="tech-grid-person" role="rowheader">
                  <strong>{p.name ?? "Someone"}</strong>
                  {p.label && <span>{p.label}</span>}
                </div>
                {att.nights.map((n, i) => {
                  const cls = n.date === att.tonight ? "tech-grid-cell tonight" : "tech-grid-cell";
                  const raw = cells[i];
                  if (raw === undefined)
                    return (
                      <div key={n.date} className={cls} role="cell" aria-label="Not called">
                        <i className="tech-sq-mini skip" />
                      </div>
                    );
                  const cell = raw;
                  const told = m.map.get(key(n.date, p.userId));
                  const said = reportText(told);
                  return (
                    <div key={n.date} className={cls} role="cell">
                      <Square
                        cell={cell}
                        told={!cell && !!said}
                        label={`${p.name ?? "Someone"}, ${monthDay(n.date)}: ${cell ? CELL_LABEL[cell] : "not yet"}${said ? ` (told us: ${said})` : ""}`}
                        onClick={m.readOnly ? undefined : () => m.setMark(n.date, p.userId, nextCell(cell))}
                      />
                    </div>
                  );
                })}
                <div className="tech-grid-flag tech-flag" role="cell">
                  {flagOf(cells)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <ComingUp m={m} />
    </main>
  );
}
