// Tech week helpers: who's where tonight, the week grid, flags, export.
import { dayOfMonth, minutesOf, monthName, shortWeekday } from "../../../lib/dates";
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

/** Cast are called at the call time; crew and staff at the crew time when there is one. */
export function callTimeFor(person: AttendancePerson, night: AttendanceNight): string {
  return person.role === "cast" ? night.start : (night.crewStart ?? night.start);
}

/** "Night 2" from the call title "Tech night 2", or the title itself ("Performance"). */
export function nightName(night: AttendanceNight, nights: AttendanceNight[]): string {
  const m = /tech night (\d+)/i.exec(night.title ?? "");
  if (m) return `Night ${m[1]}`;
  if (night.title) return night.title;
  return `Night ${nights.findIndex((n) => n.date === night.date) + 1}`;
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

export function weekOf(att: Attendance, map: Map<string, CheckIn>, userId: string): Cell[] {
  return att.nights.map((n) => map.get(key(n.date, userId))?.status ?? null);
}

/** "1 absent" wins over "Late 2x"; a single late night isn't worth a flag. */
export function flagOf(cells: Cell[]): string {
  const out = cells.filter((c) => c === "absent").length;
  const late = cells.filter((c) => c === "late").length;
  if (out) return `${out} absent`;
  if (late >= 2) return `Late ${late}x`;
  return "";
}

/** "said running 20 min late · parking" for people who told us they're on their way. */
export function lateNote(c: CheckIn | undefined): string {
  if (!c) return "";
  const bits = [];
  if (c.runningLateMinutes) bits.push(`said running ${c.runningLateMinutes} min late`);
  if (c.note) bits.push(c.note);
  return bits.join(" · ");
}

export function doorUrl(showId: string, code: string): string {
  return `${location.origin}/shows/${encodeURIComponent(showId)}/door?code=${encodeURIComponent(code)}`;
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The whole week as a CSV file, for the board. */
export function exportCsv(att: Attendance, map: Map<string, CheckIn>, showName: string) {
  const head = ["Person", "Part", ...att.nights.map((n) => `${nightShort(n.date)}`), "Flags"];
  const rows = att.people.map((p) => {
    const cells = weekOf(att, map, p.userId);
    return [p.name ?? "", p.label ?? "", ...cells.map((c) => (c ? CELL_LABEL[c] : "")), flagOf(cells)];
  });
  const text = [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${showName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "show"}-tech-attendance.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
