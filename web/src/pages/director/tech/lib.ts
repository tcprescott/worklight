// Attendance helpers: who's called when, who told us what, the grid, flags, export.
import { dayOfMonth, minutesOf, monthName, shortWeekday, time12 } from "../../../lib/dates";
import type { Attendance, AttendanceNight, AttendancePerson, CheckIn, CheckInStatus } from "../../../types";

export type Cell = CheckInStatus | null;

/** Clicking a square cycles: not yet, on time, late, absent, back to not yet. */
export const CYCLE: Cell[] = [null, "on_time", "late", "absent"];
export const nextCell = (c: Cell): Cell => CYCLE[(CYCLE.indexOf(c) + 1) % CYCLE.length]!;

export const CELL_LABEL: Record<CheckInStatus, string> = { on_time: "On time", late: "Late", absent: "Absent" };

export const key = (date: string, userId: string) => `${date}|${userId}`;

export function checkinMap(checkins: CheckIn[]): Map<string, CheckIn> {
  return new Map(checkins.map((c) => [key(c.date, c.userId), c]));
}

export const isHere = (c: CheckIn | undefined) => c?.status === "on_time" || c?.status === "late";

/** Someone's own call that day: when they're needed from and until, or undefined when they aren't called. */
export function calledOn(night: AttendanceNight, userId: string) {
  return night.called.find((c) => c.userId === userId);
}

/** Their call time that day, falling back to the first call's start. */
export function callTimeFor(person: AttendancePerson, night: AttendanceNight): string {
  return calledOn(night, person.userId)?.start ?? night.start;
}

/** The people called on a night, in the board's usual order (cast, then crew, then staff, by name). */
export function peopleOn(att: Attendance, night: AttendanceNight): AttendancePerson[] {
  const called = new Set(night.called.map((c) => c.userId));
  return att.people.filter((p) => called.has(p.userId));
}

const TYPE_NAME: Record<string, string> = { tech: "Tech", dress: "Dress", performance: "Performance" };

/** "Tech night 2", "Performance", or "Rehearsal": what kind of night it is. */
export function nightName(night: AttendanceNight): string {
  const first = night.calls[0];
  if (first?.title) return first.title;
  return TYPE_NAME[first?.type ?? ""] ?? "Rehearsal";
}

/** "Sun Nov 29" */
export const nightShort = (date: string) => `${shortWeekday(date)[0]}${shortWeekday(date).slice(1).toLowerCase()} ${monthName(date).slice(0, 3)} ${dayOfMonth(date)}`;
/** "Nov 29" */
export const monthDay = (date: string) => `${monthName(date).slice(0, 3)} ${dayOfMonth(date)}`;

/** The time now where the show is, as HH:MM, and its date. */
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

/** Checking someone in by hand: late once their call time has passed. */
export function arrivalStatus(person: AttendancePerson, night: AttendanceNight, timezone: string): CheckInStatus {
  const now = showNow(timezone);
  if (now.date !== night.date) return "on_time";
  return minutesOf(now.time) > minutesOf(callTimeFor(person, night)) ? "late" : "on_time";
}

/** An ISO timestamp as "5:58 PM" in the show's zone. */
export function clockTime(iso: string | null | undefined, timezone: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** A square per night: their mark, null when not marked yet, undefined when they weren't called. */
export function weekOf(att: Attendance, map: Map<string, CheckIn>, userId: string): (Cell | undefined)[] {
  return att.nights.map((n) => (calledOn(n, userId) ? (map.get(key(n.date, userId))?.status ?? null) : undefined));
}

/** "1 absent" wins over "Late 2x"; a single late night isn't worth a flag. */
export function flagOf(cells: (Cell | undefined)[]): string {
  const out = cells.filter((c) => c === "absent").length;
  const late = cells.filter((c) => c === "late").length;
  if (out) return `${out} absent`;
  if (late >= 2) return `Late ${late}x`;
  return "";
}

/** "Can't come", "Late, arriving 7:20 PM", "Leaving at 8:00 PM": what someone told us. */
export function reportText(c: Pick<CheckIn, "report" | "reportTime"> | undefined): string {
  if (!c?.report) return "";
  if (c.report === "absent") return "Can't come";
  if (c.report === "late") return c.reportTime ? `Late, arriving ${time12(c.reportTime)}` : "Late";
  return c.reportTime ? `Leaving at ${time12(c.reportTime)}` : "Leaving early";
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The whole week as a CSV file, for the board. */
export function exportCsv(att: Attendance, map: Map<string, CheckIn>, showName: string) {
  const head = ["Person", "Part", ...att.nights.map((n) => `${nightShort(n.date)}`), "Flags"];
  const rows = att.people.map((p) => {
    const cells = weekOf(att, map, p.userId);
    return [p.name ?? "", p.label ?? "", ...cells.map((c) => (c === undefined ? "–" : c ? CELL_LABEL[c] : "")), flagOf(cells)];
  });
  const text = [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${showName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "show"}-attendance.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
