import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShowPageProps } from "../../App";
import { api } from "../../api";
import { useIsPhone } from "../../lib/useMedia";
import { StaffShell } from "../../shell";
import type { Attendance, AttendanceNight, AttendancePerson, CheckIn, CheckInStatus } from "../../types";
import { ErrorView, Loading, useToast } from "../../ui";
import { DraftBanner, NoTechCalls } from "./tech/Setup";
import { PrintSheet } from "./tech/DoorSign";
import { arrivalStatus, checkinMap, key } from "./tech/lib";
import { PhoneTech } from "./tech/Phone";
import { Tonight } from "./tech/Tonight";
import { WholeWeek } from "./tech/Week";
import "./tech.css";

const POLL_MS = 15_000;
const TECH_TYPES = new Set(["tech", "dress", "performance"]);

export interface TechModel {
  att: Attendance;
  map: Map<string, CheckIn>;
  showId: string;
  showName: string;
  timezone: string;
  readOnly: boolean;
  tonight?: AttendanceNight;
  setMark: (date: string, userId: string, status: CheckInStatus | null) => void;
  checkIn: (person: AttendancePerson, night: AttendanceNight) => void;
  rotate: () => Promise<void>;
}

export function TechWeek(props: ShowPageProps) {
  const show = props.view.show;
  const showId = show.showId;
  const phone = useIsPhone();
  const view = props.sub === "week" ? "week" : "tonight";
  const readOnly = show.status === "archived";
  const [toast, showToast] = useToast();
  const [att, setAtt] = useState<Attendance>();
  const [error, setError] = useState<string>();
  const [drafts, setDrafts] = useState(0);
  const pending = useRef(0);

  const loadDrafts = useCallback(async () => {
    if (!show.techStart) return setDrafts(0);
    try {
      const s = await api.schedule(showId, show.techStart, show.endDate);
      setDrafts(s.days.flatMap((d) => d.calls).filter((c) => TECH_TYPES.has(c.type) && c.status === "draft").length);
    } catch {
      setDrafts(0);
    }
  }, [showId, show.techStart, show.endDate]);

  const load = useCallback(async () => {
    try {
      const a = await api.attendance(showId);
      // Don't let a poll undo a square someone is changing right now.
      if (pending.current === 0) setAtt(a);
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [showId]);

  useEffect(() => {
    void load();
    void loadDrafts();
  }, [load, loadDrafts]);

  // While tonight's sign-in is open, pick up stage-door scans as they happen.
  const polling = phone || view === "tonight";
  useEffect(() => {
    if (!polling) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [polling, load]);

  const map = useMemo(() => checkinMap(att?.checkins ?? []), [att]);

  const setMark = useCallback(
    (date: string, userId: string, status: CheckInStatus | null) => {
      if (!att) return;
      const k = key(date, userId);
      const prev = att.checkins.find((c) => key(c.date, c.userId) === k);
      const stamp = new Date().toISOString();
      const optimistic: CheckIn | null =
        status === null && !prev?.runningLateMinutes
          ? null
          : {
              ...(prev ?? { showId, date, userId, bySelf: false }),
              status,
              bySelf: false,
              arrivedAt: status === "on_time" || status === "late" ? (prev?.arrivedAt ?? stamp) : null,
              updatedAt: stamp,
            };
      const swap = (list: CheckIn[], next: CheckIn | null) => [...list.filter((c) => key(c.date, c.userId) !== k), ...(next ? [next] : [])];
      setAtt((a) => (a ? { ...a, checkins: swap(a.checkins, optimistic) } : a));
      pending.current += 1;
      api
        .mark(showId, date, userId, status)
        .then((saved) => setAtt((a) => (a ? { ...a, checkins: swap(a.checkins, saved ?? null) } : a)))
        .catch((err: Error) => {
          setAtt((a) => (a ? { ...a, checkins: swap(a.checkins, prev ?? null) } : a));
          showToast(`Couldn't save that: ${err.message}`);
        })
        .finally(() => {
          pending.current -= 1;
        });
    },
    [att, showId, showToast],
  );

  const checkIn = useCallback(
    (person: AttendancePerson, night: AttendanceNight) => setMark(night.date, person.userId, arrivalStatus(person, night, show.timezone)),
    [setMark, show.timezone],
  );

  const rotate = useCallback(async () => {
    const { doorCode } = await api.rotateDoorCode(showId);
    setAtt((a) => (a ? { ...a, doorCode } : a));
    showToast("New code made. Print the new sign for the stage door.");
  }, [showId, showToast]);

  let body;
  if (error && !att) body = <ErrorView message={error} onRetry={() => void load()} />;
  else if (!att) body = <Loading />;
  else if (!att.nights.length)
    body = (
      <NoTechCalls
        view={props.view}
        readOnly={readOnly}
        onMade={async (n) => {
          await Promise.all([load(), loadDrafts()]);
          showToast(`Called everyone for ${n} night${n === 1 ? "" : "s"}`);
        }}
      />
    );
  else {
    const model: TechModel = {
      att,
      map,
      showId,
      showName: show.name,
      timezone: show.timezone,
      readOnly,
      tonight: att.nights.find((n) => n.date === att.tonight),
      setMark,
      checkIn,
      rotate,
    };
    const banner =
      drafts > 0 && !readOnly ? (
        <DraftBanner
          view={props.view}
          count={drafts}
          onPublished={async (n) => {
            await loadDrafts();
            showToast(`Published ${n} call${n === 1 ? "" : "s"}`);
          }}
        />
      ) : null;
    body = (
      <>
        <div className="tech-screen">
          {phone ? (
            <PhoneTech m={model} banner={banner} />
          ) : view === "week" ? (
            <WholeWeek m={model} banner={banner} />
          ) : (
            <Tonight m={model} banner={banner} />
          )}
        </div>
        <PrintSheet m={model} />
      </>
    );
  }

  return (
    <StaffShell view={props.view} current="tech">
      {body}
      {toast}
    </StaffShell>
  );
}
