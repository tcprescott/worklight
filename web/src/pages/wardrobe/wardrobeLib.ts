import type { ItemSource, ItemStatus, ItemView, SceneRef } from "../../types";

export const STATUS: { id: ItemStatus; label: string }[] = [
  { id: "needed", label: "Needed" },
  { id: "pulled", label: "Pulled" },
  { id: "building", label: "Building" },
  { id: "ready", label: "Ready" },
];
export const STATUS_LABEL: Record<ItemStatus, string> = Object.fromEntries(STATUS.map((s) => [s.id, s.label])) as Record<
  ItemStatus,
  string
>;

export const SOURCES: { id: ItemSource; label: string }[] = [
  { id: "bought", label: "Bought" },
  { id: "built", label: "Built" },
  { id: "rented", label: "Rented" },
  { id: "borrowed", label: "Borrowed" },
  { id: "actor", label: "Actor's own" },
  { id: "stock", label: "Company stock" },
];
export const SOURCE_LABEL: Record<ItemSource, string> = Object.fromEntries(SOURCES.map((s) => [s.id, s.label])) as Record<
  ItemSource,
  string
>;

export const isLoan = (source: ItemSource | null | undefined) => source === "rented" || source === "borrowed";

/** "$85" or "$12.50". */
export function money(cents: number | null | undefined): string {
  if (cents == null) return "";
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

/** What someone typed in a money box, in cents. undefined when it doesn't read as an amount. */
export function parseMoney(text: string): number | null | undefined {
  const t = text.replace(/[$,\s]/g, "");
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
  return Math.round(Number(t) * 100);
}

export function centsText(cents: number | null | undefined): string {
  return cents == null ? "" : (cents / 100).toFixed(cents % 100 ? 2 : 0);
}

/** "1.1, 2.1, 3.1" or "1.1 to 2.2" style list of scene numbers. */
export function sceneList(ids: string[], scenes: SceneRef[]): string {
  const byId = new Map(scenes.map((s) => [s.sceneId, s.number]));
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .join(" · ");
}

/** A short source line: "Rented · Costume Barn", "Company stock". */
export function sourceLine(item: ItemView): string | undefined {
  if (!item.source) return undefined;
  if (isLoan(item.source) && item.lender) return `${SOURCE_LABEL[item.source]} · ${item.lender}`;
  return SOURCE_LABEL[item.source];
}
