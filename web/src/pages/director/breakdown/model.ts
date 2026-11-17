import type { Act, Breakdown, Character, Member, Scene } from "../../../types";
import { displayName, shortName } from "../../../lib/people";

export const NUMBER_WORDS = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

/** "Act Three" for the third act; "Act 11" past ten. */
export function actName(n: number): string {
  return `Act ${NUMBER_WORDS[n - 1] ?? n}`;
}

export const key = (sceneId: string, charId: string) => `${sceneId}|${charId}`;

export interface ActGroup {
  act: Act;
  index: number; // 1-based
  scenes: Scene[];
}

/** Acts in order with their scenes in order. */
export function groupActs(bd: Breakdown): ActGroup[] {
  const acts = [...bd.acts].sort((a, b) => a.order - b.order);
  return acts.map((act, i) => ({
    act,
    index: i + 1,
    scenes: bd.scenes.filter((s) => s.actId === act.actId).sort((a, b) => a.order - b.order),
  }));
}

/** Every scene in running order (act order first, then scene order). */
export function orderedScenes(bd: Breakdown): Scene[] {
  return groupActs(bd).flatMap((g) => g.scenes);
}

export function orderedCharacters(bd: Breakdown): Character[] {
  return [...bd.characters].sort((a, b) => a.order - b.order);
}

export function appearanceSet(bd: Breakdown): Set<string> {
  return new Set(bd.appearances.map((a) => key(a.sceneId, a.charId)));
}

/** "D. Okafor", "6 people", "D. Okafor, J. Smith" or "" when nobody plays it. */
export function playerShort(c: Character, members: Map<string, Member>): string {
  const ids = c.castUserIds.filter((id) => members.has(id));
  if (!ids.length) return "";
  if (c.ensemble) return `${ids.length} ${ids.length === 1 ? "person" : "people"}`;
  return ids.map((id) => shortName(displayName(members.get(id)!))).join(", ");
}

export function playerFull(c: Character, members: Map<string, Member>): string {
  const names = c.castUserIds.filter((id) => members.has(id)).map((id) => displayName(members.get(id)!));
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export interface TrackStats {
  scenes: Scene[];
  eighths: number;
  /** Longest run of scenes they're off, between their first and last scene. */
  longestBreak: Scene[];
  partners: { character: Character; shared: number }[];
}

export function trackStats(charId: string, scenes: Scene[], characters: Character[], on: Set<string>): TrackStats {
  const mine = scenes.filter((s) => on.has(key(s.sceneId, charId)));
  const idx = scenes.map((s, i) => (on.has(key(s.sceneId, charId)) ? i : -1)).filter((i) => i >= 0);
  let best: Scene[] = [];
  for (let i = 1; i < idx.length; i++) {
    const gap = scenes.slice(idx[i - 1]! + 1, idx[i]!);
    if (gap.length > best.length) best = gap;
  }
  const partners = characters
    .filter((c) => c.charId !== charId)
    .map((c) => ({ character: c, shared: mine.filter((s) => on.has(key(s.sceneId, c.charId))).length }))
    .filter((p) => p.shared > 0)
    .sort((a, b) => b.shared - a.shared || a.character.order - b.character.order)
    .slice(0, 3);
  return { scenes: mine, eighths: mine.reduce((t, s) => t + s.eighths, 0), longestBreak: best, partners };
}

export function breakText(stats: TrackStats): string {
  if (!stats.scenes.length) return "Not in any scene yet";
  const b = stats.longestBreak;
  if (!b.length) return stats.scenes.length === 1 ? "In one scene only" : "No breaks between their first and last scene";
  if (b.length === 1) return `Off for ${b[0]!.number} only`;
  return `Off from ${b[0]!.number} through ${b[b.length - 1]!.number}`;
}

export function partnersText(stats: TrackStats): string {
  return stats.partners.length ? stats.partners.map((p) => `${p.character.name} (${p.shared})`).join(", ") : "Nobody yet";
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
