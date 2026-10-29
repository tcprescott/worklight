import { minutesOf, time12 } from "../../../lib/dates";
import type { BlockBody, CallView, CallWarning, Scene, ScheduleDay, SceneSuggestion, TimedBlock } from "../../../types";

export type Tone = "hard" | "soft" | "part" | "free";

const WEIGHT: Record<CallWarning["kind"], number> = { hard: 10, elsewhere: 10, soft: 3, partial: 1 };

export const toneOf = (w: CallWarning): Tone => (w.kind === "hard" || w.kind === "elsewhere" ? "hard" : w.kind === "soft" ? "soft" : "part");

/** People are named by their part in the block when there is one. */
export const who = (w: CallWarning) => w.part || w.name || "Someone";

/** "Helena arrives 7:45 PM", "Titania called elsewhere" (never the other show's name). */
export function warningText(w: CallWarning): string {
  const name = who(w);
  switch (w.kind) {
    case "hard":
      return `${name} can't come`;
    case "elsewhere":
      return `${name} called elsewhere`;
    case "soft":
      return `${name} would rather not`;
    case "partial":
      if (w.arrive && w.leave) return `${name} there ${time12(w.arrive)} to ${time12(w.leave)}`;
      if (w.arrive) return `${name} arrives ${time12(w.arrive)}`;
      if (w.leave) return `${name} leaves ${time12(w.leave)}`;
      return `${name} there for part`;
  }
}

/** The worst tone among warnings, for the 3px left edge. */
export function worstTone(warnings: CallWarning[]): Tone {
  let best: CallWarning | undefined;
  for (const w of warnings) if (!best || WEIGHT[w.kind] > WEIGHT[best.kind]) best = w;
  return best ? toneOf(best) : "free";
}

/** Warnings sorted worst first. */
export function sortedWarnings(warnings: CallWarning[]): CallWarning[] {
  return [...warnings].sort((a, b) => WEIGHT[b.kind] - WEIGHT[a.kind]);
}

/** One line for a ranked scene: the worst kind of warning, or "Everyone's free". */
export function topWarning(warnings: CallWarning[]): { text: string; tone: Tone } {
  if (!warnings.length) return { text: "Everyone's free", tone: "free" };
  const sorted = sortedWarnings(warnings);
  const top = sorted[0]!;
  const same = sorted.filter((w) => w.kind === top.kind);
  if (same.length === 1) return { text: warningText(top), tone: toneOf(top) };
  const names = same.map(who).join(", ");
  const verb =
    top.kind === "hard" ? "can't come" : top.kind === "elsewhere" ? "called elsewhere" : top.kind === "soft" ? "would rather not" : "there for part";
  return { text: `${names} ${verb}`, tone: toneOf(top) };
}

export function nightsText(s: SceneSuggestion): string {
  const n = s.nightsInRange;
  return n ? `on ${n} night${n > 1 ? "s" : ""} this week` : "not this week";
}

export function blockTitle(b: Pick<TimedBlock, "label" | "sceneIds">, scenes: Map<string, Scene>): { number?: string; name: string } {
  if (b.label) return { name: b.label };
  const list = b.sceneIds.map((id) => scenes.get(id)).filter((s): s is Scene => !!s);
  if (!list.length) return { name: "Rehearsal" };
  if (list.length === 1) return { number: list[0]!.number, name: list[0]!.name };
  return { number: list.map((s) => s.number).join(", "), name: list.map((s) => s.name).join(" / ") };
}

/** The blocks as the API takes them back. A block keeps its own start only when it doesn't follow the one before. */
export function toBodies(call: CallView): BlockBody[] {
  let cursor = call.start;
  return call.blocks.map((b) => {
    const own = b.start !== cursor ? b.start : null;
    cursor = b.end;
    return { blockId: b.blockId, sceneIds: b.sceneIds, label: b.label ?? null, minutes: b.minutes, start: own, userIds: b.userIds };
  });
}

export interface Fill {
  used: number;
  length: number;
  free: number;
  over: number;
  pct: number;
}

export function fillOf(call: CallView | undefined, day: ScheduleDay): Fill | undefined {
  const start = call?.start ?? day.start;
  const end = call?.end ?? day.end;
  if (!start || !end) return undefined;
  const length = minutesOf(end) - minutesOf(start);
  const last = call?.blocks.length ? minutesOf(call.blocks[call.blocks.length - 1]!.end) : minutesOf(start);
  const used = Math.max(0, last - minutesOf(start));
  const over = Math.max(0, used - length);
  return { used, length, free: Math.max(0, length - used), over, pct: length > 0 ? Math.min(100, Math.round((100 * used) / length)) : 0 };
}

export const fillText = (f: Fill) => (f.over > 0 ? `Runs ${f.over} min over` : `${f.free} min free`);

/** The call scenes go into on a night: the earliest one still on. */
export function mainCall(day: ScheduleDay): CallView | undefined {
  return day.calls.find((c) => !c.cancelled) ?? day.calls[0];
}

export const isDark = (day: ScheduleDay) => day.kind === "tech" || day.kind === "performance";

export const sceneBlockCount = (day: ScheduleDay) =>
  day.calls.filter((c) => !c.cancelled).reduce((n, c) => n + c.blocks.filter((b) => b.sceneIds.length).length, 0);

export const needsPublish = (c: CallView) => c.unpublishedChanges;

/** "Not published" for a call cast hasn't seen; "Changed" for one that differs from what they see. */
export function publishTag(c: CallView): string | undefined {
  if (!c.unpublishedChanges) return undefined;
  if (c.status === "draft") return "Draft";
  return c.cancelled ? "Cancel not sent" : "Changed";
}

/** "7:00 PM to 9:30 PM", as the boards write a night's hours. */
export function hours(start: string | null | undefined, end: string | null | undefined): string {
  return start && end ? `${time12(start)} to ${time12(end)}` : "";
}
