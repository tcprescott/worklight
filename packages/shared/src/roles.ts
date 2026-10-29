import type { ShowRole, TheaterRole } from "./types.js";

export type ShowAction =
  | "show:read"
  | "show:edit"
  | "members:read"
  | "members:invite"
  | "schedule:edit"
  | "conflicts:read-all"
  | "conflicts:edit-own";

export type TheaterAction = "theater:edit" | "shows:create" | "billing:manage";

const SHOW_PERMISSIONS: Record<ShowRole, ReadonlySet<ShowAction>> = {
  staff: new Set<ShowAction>([
    "show:read",
    "show:edit",
    "members:read",
    "members:invite",
    "schedule:edit",
    "conflicts:read-all",
    "conflicts:edit-own",
  ]),
  cast: new Set<ShowAction>(["show:read", "members:read", "conflicts:edit-own"]),
  crew: new Set<ShowAction>(["show:read", "members:read", "conflicts:edit-own"]),
};

const THEATER_PERMISSIONS: Record<TheaterRole, ReadonlySet<TheaterAction>> = {
  admin: new Set<TheaterAction>(["theater:edit", "shows:create", "billing:manage"]),
};

export function canOnShow(role: ShowRole | undefined, action: ShowAction): boolean {
  return role !== undefined && SHOW_PERMISSIONS[role].has(action);
}

export function canOnTheater(role: TheaterRole | undefined, action: TheaterAction): boolean {
  return role !== undefined && THEATER_PERMISSIONS[role].has(action);
}

export const SHOW_ROLES: readonly ShowRole[] = ["staff", "cast", "crew"];

export function isShowRole(value: unknown): value is ShowRole {
  return typeof value === "string" && (SHOW_ROLES as readonly string[]).includes(value);
}
