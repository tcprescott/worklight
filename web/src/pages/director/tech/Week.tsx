import type { CSSProperties, ReactNode } from "react";
import { shortWeekday } from "../../../lib/dates";
import type { TechModel } from "../TechWeek";
import { CELL_LABEL, exportCsv, flagOf, monthDay, nextCell, weekOf, type Cell } from "./lib";
import { TechTabs } from "./Tonight";

export function Square(props: { cell: Cell; onClick?: () => void; label: string; tonight?: boolean }) {
  const text = props.cell === "late" ? "late" : props.cell === "absent" ? "out" : "";
  return (
    <button
      type="button"
      className={`tech-sq ${props.cell ?? "none"}`}
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
          <h1 className="title">Tech week attendance</h1>
          <p className="lede">
            Everyone is called every night. Tonight's column fills in from stage-door check-ins.
            {m.readOnly ? "" : " Click any square to fix it."}
          </p>
        </div>
        <button type="button" className="btn" onClick={() => exportCsv(att, m.map, m.showName)}>
          Export for the board
        </button>
      </div>
      <TechTabs showId={m.showId} current="week" />
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
                  const cell = cells[i] ?? null;
                  return (
                    <div key={n.date} className={n.date === att.tonight ? "tech-grid-cell tonight" : "tech-grid-cell"} role="cell">
                      <Square
                        cell={cell}
                        label={`${p.name ?? "Someone"}, ${monthDay(n.date)}: ${cell ? CELL_LABEL[cell] : "not yet"}`}
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
    </main>
  );
}
