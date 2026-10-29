// API shapes, generated from the backend's OpenAPI schema (npm run gen:api). Don't edit api-types.ts by hand.
import type { components } from "./api-types";

type Schemas = components["schemas"];

export type Me = Schemas["Me"];
export type Member = Schemas["Member"];
export type Show = Schemas["Show"];
export type ShowView = Schemas["ShowView"];
export type Theater = Schemas["Theater"];
export type InviteAccepted = Schemas["InviteAccepted"];
export type CreateShowBody = Schemas["CreateShowBody"];
export type CreateInviteBody = Schemas["CreateInviteBody"];
export type ShowRole = Member["role"];
