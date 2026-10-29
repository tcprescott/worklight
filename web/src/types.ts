// API shapes, generated from the backend's OpenAPI schema (npm run gen:api). Don't edit api-types.ts by hand.
import type { components } from "./api-types";

type Schemas = components["schemas"];

export type Me = Schemas["Me"];
export type MyShow = Schemas["MyShow"];
export type User = Schemas["User"];
export type Member = Schemas["Member"];
export type Show = Schemas["Show"];
export type ShowView = Schemas["ShowView"];
export type Theater = Schemas["Theater"];
export type TheaterView = Schemas["TheaterView"];
export type ShowSummary = Schemas["ShowSummary"];
export type Admin = Schemas["Admin"];
export type InviteAccepted = Schemas["InviteAccepted"];
export type InvitePreview = Schemas["InvitePreview"];
export type InviteSent = Schemas["InviteSent"];
export type CreateShowBody = Schemas["CreateShowBody"];
export type UpdateShowBody = Schemas["UpdateShowBody"];
export type CreateInviteBody = Schemas["CreateInviteBody"];
export type UpdateMemberBody = Schemas["UpdateMemberBody"];
export type RehearsalSlot = Schemas["RehearsalSlot"];
export type ShowRole = Member["role"];

export type Breakdown = Schemas["Breakdown"];
export type Act = Schemas["Act"];
export type Scene = Schemas["Scene"];
export type Character = Schemas["Character"];
export type Appearance = Schemas["Appearance"];
export type CreateSceneBody = Schemas["CreateSceneBody"];
export type UpdateSceneBody = Schemas["UpdateSceneBody"];
export type CreateCharacterBody = Schemas["CreateCharacterBody"];
export type UpdateCharacterBody = Schemas["UpdateCharacterBody"];

export type MyConflicts = Schemas["MyConflicts"];
export type WeeklyConflict = Schemas["WeeklyConflict"];
export type DateConflict = Schemas["DateConflict"];
export type MemberConflicts = Schemas["MemberConflicts"];
export type SaveConflictsBody = Schemas["SaveConflictsBody"];
export type WeeklyBody = Schemas["WeeklyBody"];
export type DateBody = Schemas["DateBody"];
export type ShowDay = Schemas["ShowDayView"];
export type ConflictLevel = WeeklyConflict["level"];
export type DateAnswer = DateConflict["level"];
