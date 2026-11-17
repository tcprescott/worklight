import { useCallback, useState } from "react";
import type { ShowPageProps } from "../../App";
import { api } from "../../api";
import { addDays, dayOfMonth, monthName } from "../../lib/dates";
import { useIsPhone } from "../../lib/useMedia";
import { StaffShell } from "../../shell";
import type { CallView } from "../../types";
import { ErrorView, Loading, useToast } from "../../ui";
import { CallDialog } from "./schedule/CallDialog";
import { toBodies } from "./schedule/model";
import { NewCallDialog } from "./schedule/NewCallDialog";
import { useSchedule, weekBounds } from "./schedule/useSchedule";
import { WeekPhone } from "./schedule/WeekPhone";
import { WeekWeb } from "./schedule/WeekWeb";
import "./schedule.css";

type Open = { kind: "call"; call: CallView; blockId?: string } | { kind: "new"; date: string };

export interface WeekActions {
  readOnly: boolean;
  selected?: string;
  select: (sceneId: string | undefined) => void;
  place: (date: string, sceneId: string) => Promise<boolean>;
  removeBlock: (call: CallView, blockId: string) => void;
  moveBlock: (call: CallView, index: number, by: -1 | 1) => void;
  openCall: (call: CallView, blockId?: string) => void;
  addCall: (date: string) => void;
  restore: (call: CallView) => void;
  prevWeek?: () => void;
  nextWeek?: () => void;
  publish: () => void;
  unpublished: number;
  /** Any calls at all this week, published or not. */
  hasCalls: boolean;
  /** Only when the show has a tech week page. */
  techPath?: string;
  breakdownPath: string;
}

export function Schedule(props: ShowPageProps) {
  const { show } = props.view;
  const showId = show.showId;
  const phone = useIsPhone();
  const readOnly = show.status === "archived";
  const [toast, showToast] = useToast();
  const data = useSchedule(show, showToast);
  const [selected, setSelected] = useState<string>();
  const [open, setOpen] = useState<Open>();
  const close = useCallback(() => setOpen(undefined), []);

  const body = () => {
    if (data.error && !data.view) return <ErrorView message={data.error} onRetry={() => void data.reload()} />;
    if (!data.view || !data.scenes || !data.week) return <Loading />;
    const view = data.view;
    const [first, last] = weekBounds(show);
    const unpublished = view.days.reduce((n, d) => n + d.calls.filter((c) => c.unpublishedChanges).length, 0);
    const scene = (id: string) => data.sceneMap.get(id)?.number ?? "Scene";

    const actions: WeekActions = {
      readOnly,
      selected,
      select: setSelected,
      place: (date, sceneId) => data.mutate(() => api.addSceneToNight(showId, date, sceneId)),
      removeBlock: (call, blockId) =>
        void data.mutate(() => api.updateCall(showId, call.callId, { blocks: toBodies(call).filter((b) => b.blockId !== blockId) })),
      moveBlock: (call, index, by) => {
        const blocks = toBodies(call);
        const j = index + by;
        if (j < 0 || j >= blocks.length) return;
        [blocks[index], blocks[j]] = [blocks[j]!, blocks[index]!];
        // Moved blocks follow on from the one before them.
        blocks[index]!.start = null;
        blocks[j]!.start = null;
        void data.mutate(() => api.updateCall(showId, call.callId, { blocks }));
      },
      openCall: (call, blockId) => setOpen({ kind: "call", call, blockId }),
      addCall: (date) => setOpen({ kind: "new", date }),
      restore: (call) => void data.mutate(() => api.updateCall(showId, call.callId, { cancelled: false }), "The night is back on"),
      prevWeek: data.week > first ? () => data.setWeek(addDays(data.week!, -7)) : undefined,
      nextWeek: data.week < last ? () => data.setWeek(addDays(data.week!, 7)) : undefined,
      publish: () =>
        void data.mutate(async () => {
          const r = await api.publish(showId, view.start, view.end);
          const parts = [];
          if (r.published) parts.push(`${r.published} ${r.published === 1 ? "call" : "calls"} published`);
          if (r.cancelled) parts.push(`${r.cancelled} ${r.cancelled === 1 ? "cancellation" : "cancellations"} sent`);
          showToast(parts.length ? `${parts.join(", ")}. Cast and crew can see them now.` : "Nothing new to publish.");
        }),
      unpublished,
      hasCalls: view.days.some((d) => d.calls.length > 0),
      techPath: show.techStart ? `/shows/${showId}/tech` : undefined,
      breakdownPath: `/shows/${showId}/breakdown`,
    };
    const taken = new Set(view.days.map((d) => d.date));
    const extraDays: string[] = [];
    for (let d = view.start; d <= view.end; d = addDays(d, 1)) {
      if (!taken.has(d) && d >= show.startDate && d <= show.endDate) extraDays.push(d);
    }
    const week = data.week;
    const stale = view.start !== week;
    const shared = { data, actions, scene, extraDays, stale, weekTitle: `${monthName(week)} ${dayOfMonth(week)}` };
    return (
      <div className={stale ? "sch-stale" : undefined} aria-busy={stale}>
        {stale && data.error && (
          <div className="sch-load-error" role="alert">
            {data.error}{" "}
            <button className="link-btn" onClick={() => void data.reload()}>
              Try again
            </button>
          </div>
        )}
        {phone ? <WeekPhone {...shared} /> : <WeekWeb {...shared} />}
      </div>
    );
  };

  return (
    <StaffShell view={props.view} current="schedule">
      {body()}
      {open?.kind === "call" && (
        <CallDialog
          key={open.call.callId + (open.blockId ?? "")}
          call={open.call}
          blockId={open.blockId}
          sceneMap={data.sceneMap}
          members={data.members}
          phone={phone}
          onClose={close}
          save={async (body, message) => {
            const ok = await data.mutate(() => api.updateCall(showId, open.call.callId, body), message);
            if (ok) close();
            return ok;
          }}
          cancelNight={async () => {
            const ok = await data.mutate(
              () => api.deleteCall(showId, open.call.callId),
              open.call.publishedAt ? "Night cancelled. Publish the week to tell everyone." : "Night removed",
            );
            if (ok) close();
          }}
        />
      )}
      {open?.kind === "new" && (
        <NewCallDialog
          date={open.date}
          onClose={close}
          create={async (body) => {
            const ok = await data.mutate(() => api.createCall(showId, body), "Call added");
            if (ok) close();
            return ok;
          }}
        />
      )}
      {toast}
    </StaffShell>
  );
}

export interface WeekProps {
  data: import("./schedule/useSchedule").ScheduleData;
  actions: WeekActions;
  scene: (id: string) => string;
  weekTitle: string;
  /** The week asked for is still loading; what's shown is the previous one. */
  stale: boolean;
  /** Days this week that aren't usual nights and have no call, where a call can be added. */
  extraDays: string[];
}
