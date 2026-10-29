import type { ShowRole } from "./types";

// Mirrors backend/src/worklight/roles.py so the UI only offers what the API will allow.
export type ShowAction = "show:read" | "members:read" | "members:invite";

const SHOW_PERMISSIONS: Record<ShowRole, ReadonlySet<ShowAction>> = {
  staff: new Set<ShowAction>(["show:read", "members:read", "members:invite"]),
  cast: new Set<ShowAction>(["show:read", "members:read"]),
  crew: new Set<ShowAction>(["show:read", "members:read"]),
};

export function canOnShow(role: ShowRole | undefined, action: ShowAction): boolean {
  return role !== undefined && SHOW_PERMISSIONS[role].has(action);
}

export const SHOW_ROLES: readonly ShowRole[] = ["staff", "cast", "crew"];
