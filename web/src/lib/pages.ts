// Scene lengths are stored in eighths of a page, the way stage managers count: 35 = "4 3/8".

export function formatPages(eighths: number): string {
  const whole = Math.floor(eighths / 8);
  const rest = eighths % 8;
  if (!rest) return String(whole);
  const frac = `${rest}/8`.replace("2/8", "1/4").replace("4/8", "1/2").replace("6/8", "3/4");
  return whole ? `${whole} ${frac}` : frac;
}

/** Parses "4 3/8", "4.5", "3/8" or "4". Returns undefined if it can't. */
export function parsePages(text: string): number | undefined {
  const t = text.trim();
  if (!t) return 0;
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (mixed) return Math.round((Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])) * 8);
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) return Math.round((Number(frac[1]) / Number(frac[2])) * 8);
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 8) : undefined;
}

export function pageLabel(eighths: number): string {
  const p = formatPages(eighths);
  return `${p} ${eighths === 8 ? "page" : "pages"}`;
}

/** Same rule as the API: override, or pages x pace rounded to 5 minutes, at least 20. */
export function sceneMinutes(scene: { eighths?: number; minutesOverride?: number | null }, minutesPerPage: number): number {
  if (scene.minutesOverride) return scene.minutesOverride;
  const raw = ((scene.eighths ?? 0) / 8) * minutesPerPage;
  return Math.max(20, 5 * Math.round(raw / 5));
}
