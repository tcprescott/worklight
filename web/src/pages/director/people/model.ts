import { daysBetween, longWeekday, shortDate, time12, timeRange, todayIso, WEEKDAY_NAMES } from "../../../lib/dates";
import { conflictStatus, displayName } from "../../../lib/people";
import type { Breakdown, Character, Member, MemberConflicts } from "../../../types";

export interface Person {
  member: Member;
  name: string;
  parts: Character[];
  /** "Hermia", "Stage manager" */
  part: string;
  /** "Cast", "Set and tech" */
  team: string;
}

export const ROLE_LABEL = { cast: "Cast", crew: "Crew", staff: "Staff" } as const;

export function teamOf(m: Member): string {
  if (m.role === "cast") return "Cast";
  return m.department?.trim() || (m.role === "staff" ? "Production" : "Crew");
}

export function people(members: Member[], bd: Breakdown | undefined): Person[] {
  const chars = [...(bd?.characters ?? [])].sort((a, b) => a.order - b.order);
  return members.map((m) => {
    const parts = chars.filter((c) => c.castUserIds.includes(m.userId));
    const partNames = parts.map((c) => (c.ensemble ? singular(c.name) : c.name)).join(", ");
    const part =
      m.role === "cast" ? partNames || "No part yet" : [m.title, partNames].filter(Boolean).join(" · ") || ROLE_LABEL[m.role];
    return { member: m, name: displayName(m), parts, part, team: teamOf(m) };
  });
}

/** "Fairies" -> "Fairy" for a person in an ensemble; leaves other names alone. */
function singular(name: string): string {
  if (/ies$/i.test(name)) return name.replace(/ies$/i, "y");
  if (/[^su]s$/i.test(name) && name.length > 3) return name.slice(0, -1);
  return name;
}

export interface Group {
  title: string;
  people: Person[];
}

/** Cast first (in character order), then each department: staff departments before crew ones. */
export function groups(list: Person[]): Group[] {
  const firstOrder = (p: Person) => p.parts[0]?.order ?? 10_000;
  const cast = list.filter((p) => p.member.role === "cast").sort((a, b) => firstOrder(a) - firstOrder(b) || a.name.localeCompare(b.name));
  const rest = list
    .filter((p) => p.member.role !== "cast")
    .sort((a, b) => (a.member.role === b.member.role ? 0 : a.member.role === "staff" ? -1 : 1) || a.name.localeCompare(b.name));
  const out: Group[] = cast.length ? [{ title: "Cast", people: cast }] : [];
  for (const p of rest) {
    let g = out.find((x) => x.title === p.team && x.title !== "Cast");
    if (!g) out.push((g = { title: p.team, people: [] }));
    g.people.push(p);
  }
  return out;
}

export interface Readiness {
  total: number;
  ready: number;
  joined: number;
  invited: number;
}

export function readiness(list: Member[]): Readiness {
  const s = list.map(conflictStatus);
  return {
    total: list.length,
    ready: s.filter((x) => x === "in").length,
    joined: s.filter((x) => x === "waiting").length,
    invited: s.filter((x) => x === "invited").length,
  };
}

/** "due Friday", "due Nov 20", "were due Oct 30". */
export function dueText(deadline: string | null | undefined): string {
  if (!deadline) return "";
  const days = daysBetween(todayIso(), deadline);
  if (days < 0) return `were due ${shortDate(deadline).slice(5)}`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days < 7) return `due ${longWeekday(deadline)}`;
  return `due ${shortDate(deadline).slice(5)}`;
}

export interface ConflictLine {
  key: string;
  when: string;
  label: string;
  tag: string;
  note?: string | null;
}

function levelText(c: { level: string; arrive?: string | null; leave?: string | null }): { label: string; tag: string } {
  if (c.level === "hard") return { label: "Can't come", tag: "tag tag-hard" };
  if (c.level === "soft") return { label: "Rather not", tag: "tag tag-soft" };
  if (c.arrive && c.leave) return { label: `Only ${timeRange(c.arrive, c.leave)}`, tag: "tag tag-part" };
  if (c.arrive) return { label: `Late, ${time12(c.arrive)}`, tag: "tag tag-part" };
  return { label: `Leaves ${time12(c.leave)}`, tag: "tag tag-part" };
}

export function conflictLines(c: MemberConflicts | undefined): ConflictLine[] {
  if (!c) return [];
  const weekly = [...c.weekly]
    .sort((a, b) => a.weekday - b.weekday)
    .map((w) => ({ key: `w${w.weekday}`, when: `Every ${WEEKDAY_NAMES[w.weekday]}`, note: w.note, ...levelText(w) }));
  const dates = c.dates
    .filter((d) => d.level !== "free")
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ key: d.date, when: shortDate(d.date), note: d.note, ...levelText(d) }));
  return [...weekly, ...dates];
}

/** "Free for every rehearsal", or what's missing. */
export function noConflictsText(m: Member): string {
  const s = conflictStatus(m);
  if (s === "in") return "No conflicts. Free for every rehearsal.";
  if (s === "waiting") return "Hasn't sent conflicts yet.";
  return "Hasn't opened the invite yet.";
}

/** Parses "Name, email" or "Name <email>" (or a bare email) per line. */
export function parseList(text: string): { name?: string; email?: string; line: string }[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const angle = /^(.*?)\s*<\s*([^>\s]+@[^>\s]+)\s*>\s*$/.exec(line);
      if (angle) return { line, name: angle[1]!.replace(/[",]+$/g, "").trim() || undefined, email: angle[2] };
      const parts = line.split(/[,;\t]/).map((p) => p.trim()).filter(Boolean);
      const email = parts.find((p) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p));
      const name = parts.filter((p) => p !== email).join(" ") || undefined;
      return { line, name, email };
    });
}
