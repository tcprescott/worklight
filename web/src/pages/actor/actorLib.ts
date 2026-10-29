// Small helpers shared by the actor pages.
import { api } from "../../api";
import { daysBetween, hhmm, longWeekday, minutesOf, shortDate, todayIso } from "../../lib/dates";
import { firstName } from "../../lib/people";
import type { Member, MyCall } from "../../types";
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

function useMembers(showId: string | undefined): Member[] | undefined {
  const { data } = useAsync(() => (showId ? api.members(showId).catch(() => [] as Member[]) : Promise.resolve([] as Member[])), [showId]);
  return data;
}

/** The show's director, read from its staff. Never fails: falls back to "your director". */
export function useDirector(showId: string | undefined): Director {
  return pickDirector(useMembers(showId));
}

/** "Priya, your stage manager" for the running-late sheet, or just "your stage manager". */
export function pickStageManager(members: Member[] | undefined): string {
  const sm = members?.find((m) => m.role === "staff" && /stage manag/i.test(`${m.title ?? ""} ${m.department ?? ""}`) && !/assistant/i.test(m.title ?? ""));
  const first = firstName(sm?.name);
  return first ? `${first}, your stage manager,` : "your stage manager";
}

export function useStageManager(showId: string | undefined): { phrase: string; first?: string } {
  const members = useMembers(showId);
  const phrase = pickStageManager(members);
  const first = phrase.includes(",") ? phrase.split(",")[0] : undefined;
  return { phrase, first };
}

/** What a call is for: "Scene 2.2", "Scenes 1.2 and 3.1", "Read-through, Act 1", "Tech night 2". */
export function callWhat(call: Pick<MyCall, "labels" | "title" | "type">): string {
  const scenes: string[] = [];
  const other: string[] = [];
  for (const l of call.labels) {
    const m = /^(\d+\.\d+)\b/.exec(l);
    if (m) scenes.push(m[1]!);
    else other.push(l);
  }
  const parts = [...other];
  if (scenes.length === 1) parts.push(`Scene ${scenes[0]}`);
  else if (scenes.length > 1) parts.push(`Scenes ${scenes.slice(0, -1).join(", ")} and ${scenes[scenes.length - 1]}`);
  if (parts.length) return parts.join(" · ");
  return call.title ?? TYPE_LABEL[call.type];
}

export const TYPE_LABEL: Record<MyCall["type"], string> = {
  rehearsal: "Rehearsal",
  music: "Music rehearsal",
  choreography: "Choreography",
  run: "Run-through",
  tech: "Tech",
  dress: "Dress rehearsal",
  performance: "Performance",
};

/** "Script and a pencil" -> "script and a pencil" for "Bring ..." */
export const lowerFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

/** A Google Maps search for the address (or the place name when there's no address). */
export function directionsUrl(call: Pick<MyCall, "address" | "location">): string | undefined {
  const q = [call.location, call.address].filter(Boolean).join(", ");
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : undefined;
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
