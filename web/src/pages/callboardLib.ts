// Shared by the staff Callboard and the actor Show page.
import type { NoticeAudience, NoticeView } from "../types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const AUDIENCE_LABEL: Record<NoticeAudience, string> = { everyone: "Everyone", cast: "Cast", crew: "Crew" };

/** "Just now", "Today", "Yesterday", "Tuesday" within the week, then "Oct 27". */
export function postedWhen(stamp: string, now = new Date()): string {
  const at = new Date(stamp);
  if (Number.isNaN(at.getTime())) return "";
  const mins = (now.getTime() - at.getTime()) / 60_000;
  if (mins < 2) return "Just now";
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return WEEKDAYS[at.getDay()]!;
  const year = at.getFullYear() !== now.getFullYear() ? `, ${at.getFullYear()}` : "";
  return `${MONTHS[at.getMonth()]} ${at.getDate()}${year}`;
}

/** "Read by 13 of 16", or "Nobody else to read it yet" when it reaches no one. */
export function readLine(n: NoticeView): string | null {
  if (n.readCount == null || n.audienceCount == null) return null;
  if (n.audienceCount === 0) return "Nobody else to read it yet";
  if (n.readCount === n.audienceCount) return `Read by all ${n.audienceCount}`;
  return `Read by ${n.readCount} of ${n.audienceCount}`;
}

/** The first ~86 characters, cut at a word. */
export function excerpt(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 4).replace(/\s+\S*$/, "") + "…";
}
