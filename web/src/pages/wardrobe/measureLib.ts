import type { Measurements, SaveSheetBody } from "../../types";

export type NumberKey =
  | "head"
  | "neck"
  | "chest"
  | "underbust"
  | "waist"
  | "hip"
  | "belowKnee"
  | "inseam"
  | "outseam"
  | "napeToWaist"
  | "napeToFloor"
  | "napeToShoulder"
  | "toElbow"
  | "toWrist"
  | "acrossShoulders"
  | "waistToFloor";

export type SizeKey = "height" | "weight" | "shoe" | "suitDress" | "shirt" | "trouser" | "bra" | "hat";

export interface Numbered {
  n: number;
  key: NumberKey;
  label: string;
  /** How to take it, for someone measuring themselves with a helper. */
  how: string;
  group: "around" | "lengths" | "sleeve";
}

/** The 16 numbered measurements, in the order of the theater's measurement sheet. */
export const NUMBERED: Numbered[] = [
  { n: 1, key: "head", label: "Head circumference", group: "around", how: "Around your head, across the forehead and just above the ears." },
  { n: 2, key: "neck", label: "Base of neck", group: "around", how: "Around the base of your neck, where a shirt collar sits." },
  { n: 3, key: "chest", label: "Chest / bust", group: "around", how: "Around the fullest part of your chest, under the arms. Keep the tape level." },
  { n: 4, key: "underbust", label: "Ribcage / underbust", group: "around", how: "Around your ribcage, just under the chest." },
  { n: 5, key: "waist", label: "Waist", group: "around", how: "Around your natural waist, the narrowest point above the belly button. Snug, not tight." },
  { n: 6, key: "hip", label: "Hip", group: "around", how: "Around the fullest point of your hips and seat, feet together." },
  { n: 7, key: "belowKnee", label: "Below knee", group: "around", how: "Around one leg, just below the knee." },
  { n: 8, key: "inseam", label: "Inseam to floor", group: "lengths", how: "From the crotch straight down the inside of the leg to the floor, standing in socks." },
  { n: 9, key: "outseam", label: "Outseam to floor", group: "lengths", how: "From your waist down the outside of the leg to the floor." },
  { n: 10, key: "napeToWaist", label: "Nape to waist", group: "lengths", how: "From the bump at the back of your neck down your spine to the waist." },
  { n: 11, key: "napeToFloor", label: "Nape to floor", group: "lengths", how: "From the back of your neck straight down to the floor." },
  { n: 12, key: "napeToShoulder", label: "Centre back nape to shoulder", group: "sleeve", how: "Arm slightly bent. From the back of the neck out to the shoulder point." },
  { n: 13, key: "toElbow", label: "…to elbow", group: "sleeve", how: "Keep going from the neck, over the shoulder, down to the elbow." },
  { n: 14, key: "toWrist", label: "…to wrist", group: "sleeve", how: "Keep going past the elbow to the wrist bone." },
  { n: 15, key: "acrossShoulders", label: "Across shoulders", group: "lengths", how: "Across the back from one shoulder seam to the other." },
  { n: 16, key: "waistToFloor", label: "Waist to floor", group: "lengths", how: "From the front of your waist straight down to the floor." },
];

export const SIZES: { key: SizeKey; label: string; placeholder: string }[] = [
  { key: "height", label: "Height", placeholder: "5' 8\"" },
  { key: "weight", label: "Weight", placeholder: "150 lb" },
  { key: "shoe", label: "Shoe size", placeholder: "9" },
  { key: "suitDress", label: "Suit / dress", placeholder: "40R or 10" },
  { key: "shirt", label: "Shirt (neck, sleeve)", placeholder: "15.5 / 33" },
  { key: "trouser", label: "Trouser (waist, inseam)", placeholder: "32 / 30" },
  { key: "bra", label: "Bra", placeholder: "34B" },
  { key: "hat", label: "Hat", placeholder: "7 1/4" },
];

/** 28.5 shows as 28½. */
export function inches(value: number | null | undefined): string {
  if (value == null) return "";
  const whole = Math.floor(value);
  const frac = Math.round((value - whole) * 4);
  const mark = ["", "¼", "½", "¾"][frac] ?? "";
  return `${whole}${mark}`;
}

/** Reads what someone typed: "28", "28.5", "28 1/2", "28½". Returns undefined when it's not a number. */
export function parseInches(text: string): number | null | undefined {
  const t = text.trim().replace(/["”]|in(ches)?$/i, "").trim();
  if (!t) return null;
  const glyph: Record<string, number> = { "¼": 0.25, "½": 0.5, "¾": 0.75 };
  const m = /^(\d+(?:\.\d+)?)\s*(?:([¼½¾])|(\d)\s*\/\s*(\d))?$/.exec(t);
  if (!m) return undefined;
  let v = Number(m[1]);
  if (m[2]) v += glyph[m[2]] ?? 0;
  if (m[3] && m[4] && Number(m[4]) > 0) v += Number(m[3]) / Number(m[4]);
  if (!(v > 0 && v <= 150)) return undefined;
  return Math.round(v * 4) / 4;
}

export function measuredCount(m: Measurements | undefined): number {
  return m ? NUMBERED.filter((x) => m[x.key] != null).length : 0;
}

export type Draft = Partial<Record<NumberKey | SizeKey | "notes" | "needs", string>>;

export function toDraft(m: Measurements, needs: string | null | undefined): Draft {
  const d: Draft = {};
  for (const s of SIZES) d[s.key] = m[s.key] ?? "";
  for (const x of NUMBERED) d[x.key] = inches(m[x.key]);
  d.notes = m.notes ?? "";
  d.needs = needs ?? "";
  return d;
}

/** The changed fields as an API body, or an error naming the first number that doesn't read. */
export function changes(before: Draft, after: Draft): { body: SaveSheetBody } | { error: string } {
  const body: SaveSheetBody = {};
  for (const s of SIZES) {
    if ((after[s.key] ?? "") !== (before[s.key] ?? "")) body[s.key] = after[s.key]?.trim() || null;
  }
  for (const x of NUMBERED) {
    if ((after[x.key] ?? "") === (before[x.key] ?? "")) continue;
    const v = parseInches(after[x.key] ?? "");
    if (v === undefined) return { error: `${x.n}. ${x.label}: use inches, like 28 or 28.5 or 28 1/2.` };
    body[x.key] = v;
  }
  if ((after.notes ?? "") !== (before.notes ?? "")) body.notes = after.notes?.trim() || null;
  if ((after.needs ?? "") !== (before.needs ?? "")) body.needs = after.needs?.trim() || null;
  return { body };
}
