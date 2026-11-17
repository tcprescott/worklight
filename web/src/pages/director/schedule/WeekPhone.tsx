import { useState } from "react";
import { dayOfMonth, longWeekday, monthName, shortWeekday, timeRange } from "../../../lib/dates";
import { Link } from "../../../router";
import type { CallView, ScheduleDay } from "../../../types";
import { Icon, Sheet } from "../../../ui";
import type { WeekProps } from "../Schedule";
import { blockTitle, hours, fillOf, fillText, isDark, mainCall, publishTag, sceneBlockCount, sortedWarnings, toneOf, topWarning, warningText, worstTone } from "./model";

export function WeekPhone(props: WeekProps) {
  const { data, actions } = props;
  const view = data.view!;
  const canEdit = !actions.readOnly;
  const [adding, setAdding] = useState(false);
  const day = view.days.find((d) => d.date === data.focus) ?? view.days[0];
  const shortTitle = `${monthName(data.week!).slice(0, 3)} ${dayOfMonth(data.week!)}`;

  return (
    <main className="sch-phone">
      <div className="sch-phone-head">
        <h1 className="sch-phone-title">Week of {shortTitle}</h1>
        {canEdit && (
          <button className="btn btn-primary sch-phone-publish" disabled={data.busy || props.stale || !actions.unpublished} onClick={actions.publish}>
            {actions.unpublished ? "Publish week" : actions.hasCalls ? "Published" : "Publish week"}
          </button>
        )}
      </div>

      <div className="sch-strip">
        <button className="sch-strip-arrow" aria-label="Previous week" disabled={!actions.prevWeek} onClick={actions.prevWeek}>
          <Icon name="left" size={18} />
        </button>
        <div className="sch-chips" style={{ gridTemplateColumns: `repeat(${Math.max(view.days.length, 5)}, minmax(0, 1fr))` }}>
          {view.days.map((d) => {
            const n = sceneBlockCount(d);
            const unpub = canEdit && d.calls.some((c) => c.unpublishedChanges);
            return (
              <button
                key={d.date}
                className={`sch-chip${isDark(d) ? " sch-chip-dark" : ""}`}
                aria-pressed={d.date === day?.date}
                aria-label={`${longWeekday(d.date)} ${dayOfMonth(d.date)}${unpub ? ", not published" : ""}`}
                onClick={() => data.setFocus(d.date)}
              >
                <span className="sch-chip-wd">{shortWeekday(d.date)}</span>
                <span className="sch-chip-n">{dayOfMonth(d.date)}</span>
                <span className="sch-chip-c">{isDark(d) ? (d.kind === "performance" ? "show" : "tech") : n ? `${n} sc` : "–"}</span>
                {unpub && <span className="sch-chip-dot" aria-hidden="true" />}
              </button>
            );
          })}
          {!view.days.length && <span className="sch-chips-none">No rehearsal nights</span>}
        </div>
        <button className="sch-strip-arrow" aria-label="Next week" disabled={!actions.nextWeek} onClick={actions.nextWeek}>
          <Icon name="right" size={18} />
        </button>
      </div>

      <div className="sch-phone-body">
        {day ? <DayPanel {...props} day={day} onAdd={() => setAdding(true)} /> : (
          <div className="empty">
            <strong>No rehearsal nights this week.</strong>
            <span>Use the arrows to move to another week.</span>
          </div>
        )}

        {canEdit && props.extraDays.length > 0 && (
          <div className="sch-other">
            <span className="caps">Add a call on another day</span>
            <div className="row">
              {props.extraDays.map((date) => (
                <button key={date} className="btn btn-dashed btn-sm" onClick={() => actions.addCall(date)} aria-label={`Add a call on ${longWeekday(date)} ${dayOfMonth(date)}`}>
                  {longWeekday(date).slice(0, 3)} {dayOfMonth(date)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {adding && day && <AddSheet {...props} day={day} onClose={() => setAdding(false)} />}
    </main>
  );
}

function DayPanel(props: WeekProps & { day: ScheduleDay; onAdd: () => void }) {
  const { day, actions, data } = props;
  const call = mainCall(day);
  const canEdit = !actions.readOnly;
  const head = `${longWeekday(day.date)}, ${monthName(day.date).slice(0, 3)} ${dayOfMonth(day.date)}`;
  const range = call ? hours(call.start, call.end) : hours(day.start, day.end);

  if (isDark(day)) {
    return (
      <div className="sch-phone-dark">
        <span className="sch-dark-kind">{day.kind === "performance" ? "Performance" : "Tech week"}</span>
        <strong>
          {head}
          {range && ` · ${range}`}
        </strong>
        {actions.techPath && (
          <>
            <span>Calls for {day.kind === "performance" ? "performances" : "tech"} live on the Tech page.</span>
            <Link to={actions.techPath} className="btn sch-dark-btn">
              Open Tech
            </Link>
          </>
        )}
      </div>
    );
  }

  const fill = fillOf(call, day);
  const cancelled = call?.cancelled && day.calls.every((c) => c.cancelled);
  const tag = call && canEdit && publishTag(call);
  const noScenes = !data.scenes?.length;

  return (
    <>
      <div className="sch-phone-night">
        <div className="sch-phone-night-row">
          <span className="sch-phone-night-title">
            {head}
            {range && ` · ${range}`}
          </span>
          {fill && !cancelled && <span className={fill.over ? "sch-phone-free sch-t-hard" : "sch-phone-free"}>{fillText(fill)}</span>}
        </div>
        {call?.title && day.calls.length === 1 && <span className="sch-call-title">{call.title}</span>}
        {fill && !cancelled && (
          <div className="sch-bar">
            <span className={fill.over ? "sch-bar-over" : undefined} style={{ width: `${fill.pct}%` }} />
          </div>
        )}
        {(tag || (canEdit && call)) && (
          <div className="sch-phone-night-tools">
            {tag ? <span className="sch-unpub">{tag}</span> : <span />}
            {canEdit && call && !cancelled && (
              <button className="link-btn sch-touch" onClick={() => actions.openCall(call)}>
                Edit the call
              </button>
            )}
          </div>
        )}
      </div>

      {cancelled ? (
        <div className="sch-cancelled">
          <strong>This night is cancelled.</strong>
          {canEdit && (
            <button className="btn btn-sm" onClick={() => actions.restore(call!)}>
              Put the night back
            </button>
          )}
        </div>
      ) : (
        <>
          {day.calls
            .filter((c) => !c.cancelled)
            .map((c) => (
              <PhoneBlocks key={c.callId} {...props} call={c} multi={day.calls.length > 1} />
            ))}
          {canEdit &&
            (noScenes ? (
              <div className="empty">
                <strong>No scenes yet</strong>
                <span>Add scenes on the Breakdown page and they'll show up here to schedule.</span>
                <Link to={actions.breakdownPath} className="btn btn-outline btn-sm">
                  Go to Breakdown
                </Link>
              </div>
            ) : (
              <button className="sch-phone-add" onClick={props.onAdd} disabled={data.busy}>
                Add a scene
              </button>
            ))}
        </>
      )}
    </>
  );
}

function PhoneBlocks(props: WeekProps & { call: CallView; multi: boolean }) {
  const { call, actions, data } = props;
  const canEdit = !actions.readOnly;
  return (
    <>
      {props.multi && <span className="caps">{call.title || `Call ${timeRange(call.start, call.end)}`}</span>}
      {call.warnings.length > 0 && (
        <div className="sch-callwarn">
          {sortedWarnings(call.warnings).map((w) => (
            <span key={w.userId} className={`sch-t-${toneOf(w)}`}>
              {warningText(w)}
            </span>
          ))}
        </div>
      )}
      {call.blocks.map((b, i) => {
        const t = blockTitle(b, data.sceneMap);
        const label = `${t.number ? t.number + " " : ""}${t.name}`;
        const warnings = sortedWarnings(b.warnings);
        return (
          <div key={b.blockId} className={`sch-pblock sch-e-${worstTone(b.warnings)}`}>
            <button className="sch-pblock-main" disabled={!canEdit} onClick={() => actions.openCall(call, b.blockId)} aria-label={`Edit ${label}`}>
              <span className="sch-pblock-time">{hours(b.start, b.end)}</span>
              <span className="sch-pblock-name">{label}</span>
              <span className="sch-pblock-tags">
                {warnings.length ? (
                  warnings.map((w) => (
                    <span key={w.userId} className={`sch-ptag sch-ptag-${toneOf(w)}`}>
                      {warningText(w)}
                    </span>
                  ))
                ) : b.sceneIds.length ? (
                  <span className="sch-ptag sch-ptag-free">Everyone's free</span>
                ) : null}
              </span>
            </button>
            {canEdit && (
              <>
                <button className="sch-picon" aria-label={`Move ${label} earlier`} disabled={i === 0 || data.busy} onClick={() => actions.moveBlock(call, i, -1)}>
                  <Icon name="up" size={18} />
                </button>
                <button className="sch-picon" aria-label={`Remove ${label}`} disabled={data.busy} onClick={() => actions.removeBlock(call, b.blockId)}>
                  <Icon name="x" size={16} strokeWidth={2.5} />
                </button>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

function AddSheet(props: WeekProps & { day: ScheduleDay; onClose: () => void }) {
  const { data, actions, day } = props;
  const s = data.suggestions;
  const onNight = new Set(day.calls.filter((c) => !c.cancelled).flatMap((c) => c.blocks.flatMap((b) => b.sceneIds)));
  const list = s?.scenes.filter((x) => !onNight.has(x.sceneId)) ?? [];
  return (
    <Sheet title={`Best scenes for ${longWeekday(day.date)}`} onClose={props.onClose}>
      {!s && <p className="small muted">Ranking...</p>}
      {s && !list.length && <p className="small muted">Every scene is already on this night.</p>}
      <div className="sch-sheet-list">
        {list.map((sug) => {
          const sc = data.sceneMap.get(sug.sceneId);
          if (!sc) return null;
          const top = topWarning(sug.warnings);
          return (
            <button
              key={sug.sceneId}
              className="sch-option"
              disabled={data.busy}
              onClick={async () => {
                if (await actions.place(day.date, sug.sceneId)) props.onClose();
              }}
            >
              <span className="sch-option-n">{sc.number}</span>
              <span className="sch-option-body">
                <span className="sch-option-name">
                  {sc.name} · {sug.minutes} min
                </span>
                <span className="sch-option-meta">
                  {sug.nightsInRange ? `On ${sug.nightsInRange} night${sug.nightsInRange > 1 ? "s" : ""} this week` : "Not this week"}
                  {!sug.fits && " · won't fit"}
                </span>
                <span className={`sch-option-status sch-t-${top.tone}`}>{top.text}</span>
              </span>
            </button>
          );
        })}
      </div>
      <button className="btn btn-block" onClick={props.onClose}>
        Done
      </button>
    </Sheet>
  );
}
