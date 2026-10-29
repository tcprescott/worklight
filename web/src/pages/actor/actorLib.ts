// Small helpers shared by the actor pages.
import { api } from "../../api";
import { daysBetween, hhmm, longWeekday, minutesOf, shortDate, todayIso } from "../../lib/dates";
import { firstName } from "../../lib/people";
import type { Member } from "../../types";
import { useAsync } from "../../useAsync";

export interface Director {
  /** "Jordan", or "your director" when the show has no one titled Director. */
  name: string;
  /** Same, capitalized for the start of a sentence. */
  Name: string;
  known: boolean;
}

export function pickDirector(members: Member[] | undefined): Director {
  const d =
    members?.find((m) => m.role === "staff" && /^director$/i.test((m.title ?? "").trim())) ??
    members?.find((m) => m.role === "staff" && /director/i.test(m.title ?? "") && !/music|assistant|technical/i.test(m.title ?? ""));
  const first = firstName(d?.name);
  if (first) return { name: first, Name: first, known: true };
  return { name: "your director", Name: "Your director", known: false };
}

/** The show's director, read from its staff. Never fails: falls back to "your director". */
export function useDirector(showId: string | undefined): Director {
  const { data } = useAsync(() => (showId ? api.members(showId).catch(() => [] as Member[]) : Promise.resolve([] as Member[])), [showId]);
  return pickDirector(data);
}

/** "Friday" when the deadline is within the coming week, otherwise "Fri, Nov 6". */
export function deadlineLabel(iso: string): string {
  const d = daysBetween(todayIso(), iso);
  return d >= 0 && d <= 6 ? longWeekday(iso) : shortDate(iso);
}

/** Half an hour after a start time, as a sensible default for "I can get there by". */
export function lateDefault(start: string | null | undefined): string {
  return start ? hhmm(Math.min(minutesOf(start) + 30, 23 * 60 + 30)) : "19:30";
}

export const KIND_LABEL = { rehearsal: "Rehearsal", tech: "Tech", performance: "Performance" } as const;
