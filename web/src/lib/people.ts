import type { Member } from "../types";

export function initials(name: string | null | undefined, email?: string | null): string {
  const source = (name ?? "").trim() || (email ?? "?").split("@")[0]!;
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase();
}

export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** "D. Okafor" */
export function shortName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts[0]![0]}. ${parts.slice(1).join(" ")}`;
}

export function displayName(m: Pick<Member, "name" | "email">): string {
  return m.name || m.email || "Invited";
}

export type ConflictStatus = "invited" | "waiting" | "in";

export function conflictStatus(m: Member): ConflictStatus {
  if (m.status === "invited") return "invited";
  return m.conflictsSubmittedAt ? "in" : "waiting";
}

export const STATUS_LABEL: Record<ConflictStatus, string> = {
  invited: "Invite sent",
  waiting: "No conflicts yet",
  in: "Conflicts in",
};

export const STATUS_TAG: Record<ConflictStatus, string> = {
  invited: "tag",
  waiting: "tag tag-soft",
  in: "tag tag-plum",
};
