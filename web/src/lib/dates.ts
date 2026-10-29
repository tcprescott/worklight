// Dates are YYYY-MM-DD strings in the show's timezone; times are HH:MM. Nothing here converts zones.

const WD = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000);
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** 0 = Monday ... 6 = Sunday, matching the API. */
export function weekdayIndex(iso: string): number {
  return (parseDate(iso).getUTCDay() + 6) % 7;
}

/** "MON" */
export const shortWeekday = (iso: string) => WD[parseDate(iso).getUTCDay()]!;
/** "Monday" */
export const longWeekday = (iso: string) => WEEKDAYS[parseDate(iso).getUTCDay()]!;
export const dayOfMonth = (iso: string) => parseDate(iso).getUTCDate();
export const monthName = (iso: string) => MONTHS[parseDate(iso).getUTCMonth()]!;

/** API weekday (0 = Monday) to a name. */
export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Monday, November 2" */
export function longDate(iso: string): string {
  return `${longWeekday(iso)}, ${monthName(iso)} ${dayOfMonth(iso)}`;
}

/** "Fri, Nov 6" */
export function shortDate(iso: string): string {
  return `${longWeekday(iso).slice(0, 3)}, ${monthName(iso).slice(0, 3)} ${dayOfMonth(iso)}`;
}

/** "Nov 6" or "Dec 18–20, 2026" style range. */
export function dateRange(a: string, b: string, withYear = true): string {
  const ma = monthName(a).slice(0, 3);
  const mb = monthName(b).slice(0, 3);
  const year = withYear ? `, ${b.slice(0, 4)}` : "";
  if (a === b) return `${ma} ${dayOfMonth(a)}${year}`;
  if (a.slice(0, 7) === b.slice(0, 7)) return `${ma} ${dayOfMonth(a)}–${dayOfMonth(b)}${year}`;
  return `${ma} ${dayOfMonth(a)}–${mb} ${dayOfMonth(b)}${year}`;
}

/** "19:30" -> "7:30 PM" */
export function time12(hhmm: string | null | undefined): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${h! % 12 || 12}:${String(m).padStart(2, "0")} ${h! >= 12 ? "PM" : "AM"}`;
}

/** "19:00", "21:30" -> "7:00 to 9:30 PM" (drops the first AM/PM when both match). */
export function timeRange(start: string | null | undefined, end: string | null | undefined, sep = " to "): string {
  if (!start || !end) return "";
  const a = time12(start);
  const b = time12(end);
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}${sep}${b}` : `${a}${sep}${b}`;
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The Monday of the week holding iso. */
export function weekStart(iso: string): string {
  return addDays(iso, -weekdayIndex(iso));
}
