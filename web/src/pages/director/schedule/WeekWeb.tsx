import { useState, type DragEvent } from "react";
import { dayOfMonth, longWeekday, monthName, timeRange, time12 } from "../../../lib/dates";
import { Link } from "../../../router";
import type { CallView, ScheduleDay, TimedBlock } from "../../../types";
import { Icon } from "../../../ui";
import type { WeekProps } from "../Schedule";
import { blockTitle, hours, fillOf, fillText, isDark, mainCall, nightsText, publishTag, sortedWarnings, toneOf, topWarning, warningText, worstTone } from "./model";

const DRAG_TYPE = "text/plain";

export function WeekWeb(props: WeekProps) {
  const { data, actions } = props;
  const view = data.view!;
  const nights = view.days;
  const extra = props.extraDays;
  const canEdit = !actions.readOnly;
  const focusDay = nights.find((d) => d.date === data.focus);
  const allDark = nights.length > 0 && nights.every(isDark);

  return (
    <main className="page sch-page">
      <div className="page-head">
        <div>
          <h1 className="title">Week of {props.weekTitle}</h1>
          <p className="lede">
            {allDark
              ? actions.techPath
                ? "Tech and performances this week. Their calls live on the Tech week page."
                : "Performances this week."
              : canEdit
              ? 'Drag a scene onto a night, or pick one and press "Put it here". Times fill in as you go.'
              : "Read-only."}
          </p>
          {canEdit && actions.unpublished > 0 && (
            <p className="small sch-unpub-note">
              {actions.unpublished === 1 ? "1 night has" : `${actions.unpublished} nights have`} changes the company can't see yet.
            </p>
          )}
        </div>
        <div className="row">
          <button className="btn sch-arrow" aria-label="Previous week" disabled={!actions.prevWeek} onClick={actions.prevWeek}>
            <Icon name="left" size={18} />
          </button>
          <button className="btn sch-arrow" aria-label="Next week" disabled={!actions.nextWeek} onClick={actions.nextWeek}>
            <Icon name="right" size={18} />
          </button>
          {canEdit && (
            <button className="btn btn-primary" disabled={data.busy || props.stale || !actions.unpublished} onClick={actions.publish}>
              {actions.unpublished ? "Publish this week" : actions.hasCalls ? "Week is published" : "Nothing to publish"}
            </button>
          )}
        </div>
      </div>

      <div className={canEdit && !allDark ? "sch-layout" : "sch-layout sch-layout-full"}>
        {canEdit && !allDark && <Sidebar {...props} focusDay={focusDay} />}
        {nights.length ? (
          <div className="sch-grid">
            {nights.map((day) => (
              <Night key={day.date} {...props} day={day} />
            ))}
          </div>
        ) : (
          <div className="empty sch-empty-week">
            <strong>No rehearsal nights this week.</strong>
            <span>
              {extra.length && canEdit ? "Add a call on one of the days below if you need one." : "Use the arrows to move to another week."}
            </span>
          </div>
        )}
      </div>

      {canEdit && extra.length > 0 && (
        <div className="sch-other">
          <span className="caps">Other days</span>
          <div className="row">
            {extra.map((date) => (
              <button key={date} className="btn btn-dashed btn-sm" onClick={() => actions.addCall(date)}>
                Add a call · {longWeekday(date).slice(0, 3)}, {monthName(date).slice(0, 3)} {dayOfMonth(date)}
              </button>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

function Sidebar(props: WeekProps & { focusDay?: ScheduleDay }) {
  const { data, actions } = props;
  const scenes = data.scenes ?? [];
  if (!scenes.length) {
    return (
      <aside className="sch-side" aria-label="Scenes">
        <div className="sch-side-empty">
          <strong>No scenes yet</strong>
          <span>Add your scenes and who's in them on the Breakdown page. They'll show up here, ranked for each night.</span>
          <Link to={actions.breakdownPath} className="btn btn-outline btn-sm">
            Go to Breakdown
          </Link>
        </div>
      </aside>
    );
  }
  const s = data.suggestions;
  return (
    <aside className="sch-side" aria-label="Scenes">
      <div className="sch-side-head">
        <span className="caps">{props.focusDay ? `Best scenes for ${longWeekday(props.focusDay.date)}` : "Scenes"}</span>
        <span className="sch-side-hint">Click a night's name to rank for it.</span>
      </div>
      {!props.focusDay && <p className="small muted">No rehearsal nights to rank for this week.</p>}
      {props.focusDay && !s && <p className="small muted">Ranking...</p>}
      {s?.scenes.map((sug) => {
        const sc = data.sceneMap.get(sug.sceneId);
        if (!sc) return null;
        const top = topWarning(sug.warnings);
        const on = actions.selected === sug.sceneId;
        return (
          <button
            key={sug.sceneId}
            type="button"
            className="sch-pick"
            aria-pressed={on}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_TYPE, sug.sceneId);
              e.dataTransfer.effectAllowed = "copy";
              actions.select(sug.sceneId);
            }}
            onClick={() => actions.select(on ? undefined : sug.sceneId)}
          >
            <span className="sch-pick-n">{sc.number}</span>
            <span className="sch-pick-body">
              <span className="sch-pick-name">{sc.name}</span>
              <span className="sch-pick-meta">
                {sug.minutes} min · {nightsText(sug)}
                {!sug.fits && " · won't fit"}
              </span>
              <span className={`sch-pick-status sch-t-${top.tone}`}>{top.text}</span>
            </span>
          </button>
        );
      })}
    </aside>
  );
}

function Night(props: WeekProps & { day: ScheduleDay }) {
  const { day, data, actions, scene } = props;
  const [over, setOver] = useState(false);
  const call = mainCall(day);
  const wd = longWeekday(day.date).toUpperCase();
  const date = `${monthName(day.date).slice(0, 3)} ${dayOfMonth(day.date)}`;

  if (isDark(day)) {
    return (
      <section className="sch-col sch-col-dark" aria-label={`${longWeekday(day.date)} ${monthName(day.date)} ${dayOfMonth(day.date)}`}>
        <div className="sch-col-top">
          <div className="sch-col-head">
            <span className="sch-wd">{wd}</span>
            <span className="sch-date">{date}</span>
            <span className="sch-range">{call ? hours(call.start, call.end) : "No call yet"}</span>
          </div>
        </div>
        <span className="sch-dark-kind">{day.kind === "performance" ? "Performance" : "Tech week"}</span>
        {actions.techPath && (
          <>
            <p className="sch-dark-text">Calls for {day.kind === "performance" ? "performances" : "tech"} live on the Tech week page.</p>
            <Link to={actions.techPath} className="sch-dark-link">
              Open Tech week
            </Link>
          </>
        )}
      </section>
    );
  }

  const fill = fillOf(call, day);
  const canEdit = !actions.readOnly;
  const cancelled = call?.cancelled && day.calls.every((c) => c.cancelled);
  const focused = data.focus === day.date;
  const tag = call && publishTag(call);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const id = e.dataTransfer.getData(DRAG_TYPE) || actions.selected;
    if (id) {
      void actions.place(day.date, id);
      data.setFocus(day.date);
    }
  };
  const dropProps =
    canEdit && !cancelled
      ? {
          onDragOver: (e: DragEvent) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            if (!over) setOver(true);
          },
          onDragLeave: (e: DragEvent) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
          },
          onDrop,
        }
      : {};

  return (
    <section
      className={`sch-col${focused && canEdit ? " sch-col-focus" : ""}${over ? " sch-col-over" : ""}`}
      aria-label={`${longWeekday(day.date)} ${monthName(day.date)} ${dayOfMonth(day.date)}`}
      {...dropProps}
    >
      <div className="sch-col-top">
        <button
          type="button"
          className="sch-col-head"
          aria-pressed={focused}
          disabled={!canEdit}
          onClick={() => data.setFocus(day.date)}
          title="Rank scenes for this night"
        >
          <span className="sch-wd">{day.kind === "extra" ? `${wd} · EXTRA` : wd}</span>
          <span className="sch-date">{date}</span>
          <span className="sch-range">{call ? hours(call.start, call.end) : hours(day.start, day.end)}</span>
          {call?.title && day.calls.length === 1 && <span className="sch-call-title">{call.title}</span>}
        </button>
        {canEdit && call && (
          <button type="button" className="sch-edit" aria-label={`Edit the call for ${date}`} onClick={() => actions.openCall(call)}>
            <Icon name="edit" size={16} />
          </button>
        )}
      </div>

      {cancelled ? (
        <div className="sch-cancelled">
          <strong>Cancelled</strong>
          {canEdit && (
            <button className="link-btn" onClick={() => actions.restore(call!)}>
              Put the night back
            </button>
          )}
        </div>
      ) : (
        <>
          {fill && (
            <div className="sch-fill">
              <div className="sch-bar">
                <span className={fill.over ? "sch-bar-over" : undefined} style={{ width: `${fill.pct}%` }} />
              </div>
              <span className="sch-fill-row">
                <span className={fill.over ? "sch-fill-text sch-t-hard" : "sch-fill-text"}>{fillText(fill)}</span>
                {tag && canEdit && <span className="sch-unpub">{tag}</span>}
              </span>
            </div>
          )}
          {day.calls
            .filter((c) => !c.cancelled)
            .map((c) => (
              <CallBlocks key={c.callId} call={c} multi={day.calls.length > 1} {...props} />
            ))}
          {canEdit && !!data.scenes?.length && (
            <button
              type="button"
              className={actions.selected ? "sch-target sch-target-on" : "sch-target"}
              onClick={() => {
                data.setFocus(day.date);
                if (actions.selected) void actions.place(day.date, actions.selected);
              }}
              disabled={data.busy}
            >
              {actions.selected ? `Put ${scene(actions.selected)} here` : "Drop a scene here"}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function CallBlocks(props: WeekProps & { call: CallView; multi: boolean }) {
  const { call, actions, data } = props;
  const canEdit = !actions.readOnly;
  return (
    <>
      {props.multi && <span className="caps sch-subcall">{call.title || `Call ${timeRange(call.start, call.end)}`}</span>}
      {call.warnings.length > 0 && (
        <div className="sch-callwarn">
          {sortedWarnings(call.warnings).map((w) => (
            <span key={w.userId} className={`sch-t-${toneOf(w)}`}>
              {warningText(w)}
            </span>
          ))}
        </div>
      )}
      {call.blocks.map((b) => (
        <Block key={b.blockId} block={b} call={call} canEdit={canEdit} sceneMap={data.sceneMap} actions={actions} />
      ))}
    </>
  );
}

function Block(props: {
  block: TimedBlock;
  call: CallView;
  canEdit: boolean;
  sceneMap: WeekProps["data"]["sceneMap"];
  actions: WeekProps["actions"];
}) {
  const { block: b, call } = props;
  const t = blockTitle(b, props.sceneMap);
  const label = `${t.number ? t.number + " " : ""}${t.name}`;
  const open = () => props.canEdit && props.actions.openCall(call, b.blockId);
  return (
    <div
      className={`sch-block sch-e-${worstTone(b.warnings)}${props.canEdit ? " sch-block-click" : ""}`}
      role={props.canEdit ? "button" : undefined}
      tabIndex={props.canEdit ? 0 : undefined}
      aria-label={props.canEdit ? `Edit ${label} at ${time12(b.start)}` : undefined}
      onClick={open}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          open();
        }
      }}
    >
      <div className="sch-block-row">
        <span className="sch-block-main">
          <span className="sch-time">{time12(b.start)}</span>
          <span className="sch-block-name">
            {t.number && <>{t.number} </>}
            {t.name}
          </span>
          {b.userIds.length > 0 && <span className="sch-block-extra">+{b.userIds.length} called</span>}
        </span>
        {props.canEdit && (
          <button
            type="button"
            className="sch-x"
            aria-label={`Remove ${label}`}
            onClick={(e) => {
              e.stopPropagation();
              props.actions.removeBlock(call, b.blockId);
            }}
          >
            <Icon name="x" size={14} strokeWidth={2.5} />
          </button>
        )}
      </div>
      {sortedWarnings(b.warnings).map((w) => (
        <span key={w.userId} className={`sch-warn sch-t-${toneOf(w)}`}>
          {warningText(w)}
        </span>
      ))}
    </div>
  );
}
