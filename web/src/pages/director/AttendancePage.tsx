import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShowPageProps } from "../../App";
import { api } from "../../api";
import { useIsPhone } from "../../lib/useMedia";
import { useSession } from "../../session";
import { StaffShell } from "../../shell";
import type { Attendance, AttendanceNight, AttendancePerson, CheckIn, CheckInStatus } from "../../types";
import { ErrorView, Loading, useToast } from "../../ui";
import { DraftBanner, NoCalls, TechCallsForm } from "./tech/Setup";
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
  /** "Got it" on what someone told us. */
  markSeen: (date: string, userId: string) => void;
}

/** Attendance for every call: who told us they'd be out or late, who's not here yet, who's arrived. */
export function AttendancePage(props: ShowPageProps) {
  const show = props.view.show;
  const showId = show.showId;
  const phone = useIsPhone();
  const view = props.sub === "all" || props.sub === "week" ? "all" : "tonight";
  const readOnly = show.status === "archived";
  const { me } = useSession();
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

  // While tonight's board is open, pick up "I'm here" taps and new reports as they happen.
  const polling = phone || view === "tonight";
  useEffect(() => {
    if (!polling) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [polling, load]);

  const map = useMemo(() => checkinMap(att?.checkins ?? []), [att]);

  const swap = (list: CheckIn[], k: string, next: CheckIn | null) => [
    ...list.filter((c) => key(c.date, c.userId) !== k),
    ...(next ? [next] : []),
  ];

  const setMark = useCallback(
    (date: string, userId: string, status: CheckInStatus | null) => {
      if (!att) return;
      const k = key(date, userId);
      const prev = att.checkins.find((c) => key(c.date, c.userId) === k);
      const stamp = new Date().toISOString();
      const optimistic: CheckIn | null =
        status === null && !prev?.report
          ? null
          : {
              ...(prev ?? { showId, date, userId, bySelf: false }),
              status,
              bySelf: false,
              location: null,
              arrivedAt: status === "on_time" || status === "late" ? (prev?.arrivedAt ?? stamp) : null,
              updatedAt: stamp,
            };
      setAtt((a) => (a ? { ...a, checkins: swap(a.checkins, k, optimistic) } : a));
      pending.current += 1;
      api
        .mark(showId, date, userId, status)
        .then((saved) => setAtt((a) => (a ? { ...a, checkins: swap(a.checkins, k, saved ?? null) } : a)))
        .catch((err: Error) => {
          setAtt((a) => (a ? { ...a, checkins: swap(a.checkins, k, prev ?? null) } : a));
          showToast(`Couldn't save that: ${err.message}`);
        })
        .finally(() => {
          pending.current -= 1;
        });
    },
    [att, showId, showToast],
  );

  const markSeen = useCallback(
    (date: string, userId: string) => {
      if (!att) return;
      const k = key(date, userId);
      const prev = att.checkins.find((c) => key(c.date, c.userId) === k);
      if (!prev) return;
      setAtt((a) => (a ? { ...a, checkins: swap(a.checkins, k, { ...prev, seenBy: me.user.userId, seenAt: new Date().toISOString() }) } : a));
      pending.current += 1;
      api
        .markSeen(showId, date, userId)
        .then((saved) =>
          setAtt((a) =>
            a
              ? { ...a, checkins: swap(a.checkins, k, saved), seenNames: { ...a.seenNames, [me.user.userId]: "You" } }
              : a,
          ),
        )
        .catch((err: Error) => {
          setAtt((a) => (a ? { ...a, checkins: swap(a.checkins, k, prev) } : a));
          showToast(`Couldn't save that: ${err.message}`);
        })
        .finally(() => {
          pending.current -= 1;
        });
    },
    [att, showId, showToast, me.user.userId],
  );

  const checkIn = useCallback(
    (person: AttendancePerson, night: AttendanceNight) => setMark(night.date, person.userId, arrivalStatus(person, night, show.timezone)),
    [setMark, show.timezone],
  );

  let body;
  if (error && !att) body = <ErrorView message={error} onRetry={() => void load()} />;
  else if (!att) body = <Loading />;
  else if (!att.nights.length)
    body = (
      <NoCalls
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
      markSeen,
    };
    const noTech = !!show.techStart && !att.nights.some((n) => n.calls.some((c) => TECH_TYPES.has(c.type)));
    const banner = readOnly ? null : drafts > 0 ? (
      <DraftBanner
        view={props.view}
        count={drafts}
        onPublished={async (n) => {
          await Promise.all([load(), loadDrafts()]);
          showToast(`Published ${n} call${n === 1 ? "" : "s"}`);
        }}
      />
    ) : noTech && view === "all" ? (
      <TechCallsForm
        view={props.view}
        onMade={async (n) => {
          await Promise.all([load(), loadDrafts()]);
          showToast(`Called everyone for ${n} night${n === 1 ? "" : "s"}`);
        }}
      />
    ) : null;
    body = phone ? (
      <PhoneTech m={model} banner={banner} />
    ) : view === "all" ? (
      <WholeWeek m={model} banner={banner} />
    ) : (
      <Tonight m={model} banner={banner} />
    );
  }

  return (
    <StaffShell view={props.view} current="attendance">
      {body}
      {toast}
    </StaffShell>
  );
}
