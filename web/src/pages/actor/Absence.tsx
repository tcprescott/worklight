// Telling stage management ahead of time ("Can't make it?"), and the "I'm here" button.
import { useState } from "react";
import { api } from "../../api";
import { hhmm, minutesOf, shortWeekday, dayOfMonth, monthName, time12 } from "../../lib/dates";
import type { AbsenceKind, MyCall, MyCheckIn } from "../../types";
import { FormError, Sheet } from "../../ui";

const KINDS: { kind: AbsenceKind; label: string }[] = [
  { kind: "absent", label: "Can't come" },
  { kind: "late", label: "Late" },
  { kind: "leave_early", label: "Leave early" },
];

/** "Tue Dec 8" */
export const dayShort = (iso: string) => `${shortWeekday(iso)[0]}${shortWeekday(iso).slice(1).toLowerCase()} ${monthName(iso).slice(0, 3)} ${dayOfMonth(iso)}`;

/** What the person told us, in their words: "You can't come", "You'll be there by 7:20 PM". */
export function toldText(c: Pick<MyCheckIn, "report" | "reportTime">): string {
  if (c.report === "absent") return "You can't come";
  if (c.report === "late") return c.reportTime ? `You'll be there by ${time12(c.reportTime)}` : "You'll be late";
  return c.reportTime ? `You're leaving at ${time12(c.reportTime)}` : "You're leaving early";
}

/** "Sent" until staff tap Got it, then "Seen by Sam". */
export function SeenPill(props: { c: MyCheckIn }) {
  const c = props.c;
  if (!c.report) return null;
  return c.seenByName ? (
    <span className="actor-pill seen">Seen by {c.seenByName.split(" ")[0]}</span>
  ) : (
    <span className="actor-pill sent">Sent</span>
  );
}

/** The time now where the show is, as a date and HH:MM. */
export function showNow(timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** Whether "I'm here" is open for this call: from `early` minutes before it until it ends. */
export function checkInOpen(call: MyCall, early: number): boolean {
  const now = showNow(call.timezone);
  if (now.date !== call.date) return false;
  const t = minutesOf(now.time);
  return t >= minutesOf(call.start) - early && t <= minutesOf(call.end);
}

/** Whether a call is still ahead or on now (it can still be reported). */
export function stillAhead(call: MyCall): boolean {
  const now = showNow(call.timezone);
  return call.date > now.date || (call.date === now.date && minutesOf(now.time) <= minutesOf(call.end));
}

function where(): Promise<{ lat?: number; lng?: number; accuracy?: number }> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      // Said no, or no fix: check in anyway, and staff see it wasn't confirmed.
      () => resolve({}),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

/** "I'm here": asks the phone where it is once (when the venue is saved), then checks in. */
export async function checkInHere(showId: string, venueSet: boolean) {
  return api.checkIn(showId, venueSet ? await where() : {});
}

/** The "Can't make it?" sheet for one call, which can also cover more of their calls. */
export function ReportSheet(props: {
  showId: string;
  call: MyCall;
  /** Their other calls that can still be reported, for "Missing more than one call?". */
  others: MyCall[];
  existing?: MyCheckIn;
  smName: string;
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const c = props.call;
  const had = props.existing?.report ? props.existing : undefined;
  const [kind, setKind] = useState<AbsenceKind>(had?.report ?? "absent");
  const [lateBy, setLateBy] = useState(had?.report === "late" && had.reportTime ? had.reportTime : hhmm(minutesOf(c.start) + 15));
  const [leaveAt, setLeaveAt] = useState(
    had?.report === "leave_early" && had.reportTime ? had.reportTime : hhmm(Math.max(minutesOf(c.start), minutesOf(c.end) - 30)),
  );
  const [note, setNote] = useState(had?.note ?? "");
  const [more, setMore] = useState(false);
  const [extra, setExtra] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // One report per day, so one checkbox per other day they're called.
  const otherDays = [...new Map(props.others.filter((o) => o.date !== c.date).map((o) => [o.date, o])).values()];

  async function send() {
    setError(undefined);
    const time = kind === "late" ? lateBy : kind === "leave_early" ? leaveAt : null;
    if (kind === "late" && minutesOf(lateBy) <= minutesOf(c.start)) return setError(`Your call is ${time12(c.start)}. Pick a later time.`);
    if (kind === "leave_early" && minutesOf(leaveAt) >= minutesOf(c.end)) return setError(`Your call ends ${time12(c.end)}. Pick an earlier time.`);
    setBusy(true);
    try {
      const dates = [c.date, ...extra];
      await api.reportAbsence(props.showId, { dates, kind, time, note: note.trim() || null });
      props.onSent(`${props.smName} will get a heads-up${dates.length > 1 ? ` about ${dates.length} calls` : ""}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function takeBack() {
    setBusy(true);
    setError(undefined);
    try {
      await api.takeBack(props.showId, c.date);
      props.onSent("Got it, you'll be there after all.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={`${dayShort(c.date)} · ${time12(c.start)}`} onClose={props.onClose}>
      <div className="actor-report-kinds" role="group" aria-label="What's happening">
        {KINDS.map((k) => (
          <button key={k.kind} type="button" className="actor-late-opt" aria-pressed={kind === k.kind} onClick={() => setKind(k.kind)}>
            {k.label}
          </button>
        ))}
      </div>
      {kind === "late" && (
        <label className="field">
          I'll be there by
          <input type="time" value={lateBy} onChange={(e) => setLateBy(e.target.value)} required />
        </label>
      )}
      {kind === "leave_early" && (
        <label className="field">
          I need to leave at
          <input type="time" value={leaveAt} onChange={(e) => setLeaveAt(e.target.value)} required />
        </label>
      )}
      <label className="field">
        Reason (only staff see it, optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={kind === "absent" ? "Work trip" : "Stuck at work"} />
      </label>
      {otherDays.length > 0 &&
        (more ? (
          <fieldset className="actor-report-more">
            <legend className="small muted">Also tell them about</legend>
            {otherDays.map((o) => (
              <label key={o.date} className="actor-report-day">
                <input
                  type="checkbox"
                  checked={extra.has(o.date)}
                  onChange={(e) => {
                    const next = new Set(extra);
                    if (e.target.checked) next.add(o.date);
                    else next.delete(o.date);
                    setExtra(next);
                  }}
                />
                <span>
                  {dayShort(o.date)} · {time12(o.start)}
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <button type="button" className="link-btn actor-report-more-btn" onClick={() => setMore(true)}>
            Missing more than one call?
          </button>
        ))}
      <FormError error={error} />
      <button type="button" className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={() => void send()}>
        {busy ? "Sending..." : had ? `Update what ${props.smName} knows` : `Tell ${props.smName}`}
      </button>
      {had && (
        <button type="button" className="btn btn-block" disabled={busy} onClick={() => void takeBack()}>
          I can make it after all
        </button>
      )}
    </Sheet>
  );
}
