import type { ShowRole } from "./types";

// Mirrors backend/src/worklight/roles.py so the UI hides what the API won't allow.
export type ShowAction =
  | "show:read"
  | "show:edit"
  | "show:archive"
  | "breakdown:edit"
  | "members:read"
  | "members:invite"
  | "schedule:edit"
  | "conflicts:read-all"
  | "conflicts:edit-own";

const ALL: ShowAction[] = [
  "show:read",
  "show:edit",
  "show:archive",
  "breakdown:edit",
  "members:read",
  "members:invite",
  "schedule:edit",
  "conflicts:read-all",
  "conflicts:edit-own",
];
const MEMBER: ShowAction[] = ["show:read", "members:read", "conflicts:edit-own"];

const SHOW_PERMISSIONS: Record<ShowRole, ReadonlySet<ShowAction>> = {
  staff: new Set(ALL),
  cast: new Set(MEMBER),
  crew: new Set(MEMBER),
};

export function canOnShow(role: ShowRole | undefined, action: ShowAction): boolean {
  return role !== undefined && SHOW_PERMISSIONS[role].has(action);
}
