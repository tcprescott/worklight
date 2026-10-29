import type {
  Act,
  Admin,
  Attendance,
  Breakdown,
  Call,
  CheckIn,
  CheckInResult,
  CheckInStatus,
  CreateCallBody,
  MyCall,
  PublishResult,
  ScheduleView,
  Suggestions,
  TechCallsBody,
  UpdateCallBody,
  Character,
  CreateCharacterBody,
  CreateInviteBody,
  CreateSceneBody,
  CreateShowBody,
  DateBody,
  DateConflict,
  InviteAccepted,
  InvitePreview,
  InviteSent,
  Me,
  Member,
  MemberConflicts,
  MyConflicts,
  SaveConflictsBody,
  Scene,
  Show,
  ShowDay,
  ShowView,
  Theater,
  TheaterView,
  UpdateCharacterBody,
  UpdateMemberBody,
  UpdateSceneBody,
  UpdateShowBody,
  User,
  WeeklyBody,
  WeeklyConflict,
} from "./types";
import { getIdToken } from "./auth";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  const token = await getIdToken(retried);
  if (!token) throw new ApiError(401, "Sign in required");
  const res = await fetch(`/api${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !retried) return request<T>(method, path, body, true);
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

async function publicGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api/public${path}`);
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

const e = encodeURIComponent;
const show = (id: string) => `/shows/${e(id)}`;

export const api = {
  // Account
  me: () => request<Me>("GET", "/me"),
  updateName: (name: string) => request<User>("PATCH", "/me", { name }),

  // Company
  createTheater: (name: string, title?: string) => request<Theater>("POST", "/theaters", { name, title }),
  theater: (theaterId: string) => request<TheaterView>("GET", `/theaters/${e(theaterId)}`),
  addAdmin: (theaterId: string, body: { email: string; name?: string; title?: string }) =>
    request<Admin[]>("POST", `/theaters/${e(theaterId)}/admins`, body),
  removeAdmin: (theaterId: string, userId: string) =>
    request<Admin[]>("DELETE", `/theaters/${e(theaterId)}/admins/${e(userId)}`),
  createShow: (theaterId: string, input: CreateShowBody) => request<Show>("POST", `/theaters/${e(theaterId)}/shows`, input),

  // Show
  show: (showId: string) => request<ShowView>("GET", show(showId)),
  updateShow: (showId: string, input: UpdateShowBody) => request<Show>("PATCH", show(showId), input),
  archiveShow: (showId: string) => request<Show>("POST", `${show(showId)}/archive`),
  restoreShow: (showId: string) => request<Show>("POST", `${show(showId)}/restore`),

  // People
  members: (showId: string) => request<Member[]>("GET", `${show(showId)}/members`),
  updateMember: (showId: string, userId: string, input: UpdateMemberBody) =>
    request<Member>("PATCH", `${show(showId)}/members/${e(userId)}`, input),
  removeMember: (showId: string, userId: string) => request<void>("DELETE", `${show(showId)}/members/${e(userId)}`),
  invite: (showId: string, input: CreateInviteBody) => request<InviteSent>("POST", `${show(showId)}/invites`, input),
  remind: (showId: string, userIds?: string[]) =>
    request<{ invitesResent: number; conflictReminders: number }>("POST", `${show(showId)}/remind`, { userIds }),
  join: (showId: string) => request<InviteAccepted>("POST", `${show(showId)}/join`),
  acceptInvite: (token: string) => request<InviteAccepted>("POST", `/invites/${e(token)}/accept`),
  previewInvite: (token: string) => publicGet<InvitePreview>(`/invites/${e(token)}`),

  // Breakdown
  breakdown: (showId: string) => request<Breakdown>("GET", `${show(showId)}/breakdown`),
  createAct: (showId: string, name: string) => request<Act>("POST", `${show(showId)}/acts`, { name }),
  updateAct: (showId: string, actId: string, name: string) => request<Act>("PATCH", `${show(showId)}/acts/${e(actId)}`, { name }),
  deleteAct: (showId: string, actId: string) => request<void>("DELETE", `${show(showId)}/acts/${e(actId)}`),
  createScene: (showId: string, input: CreateSceneBody) => request<Scene>("POST", `${show(showId)}/scenes`, input),
  updateScene: (showId: string, sceneId: string, input: UpdateSceneBody) =>
    request<Scene>("PATCH", `${show(showId)}/scenes/${e(sceneId)}`, input),
  deleteScene: (showId: string, sceneId: string) => request<void>("DELETE", `${show(showId)}/scenes/${e(sceneId)}`),
  setAppearance: (showId: string, sceneId: string, charId: string, on: boolean) =>
    request<void>(on ? "PUT" : "DELETE", `${show(showId)}/scenes/${e(sceneId)}/characters/${e(charId)}`),
  createCharacter: (showId: string, input: CreateCharacterBody) => request<Character>("POST", `${show(showId)}/characters`, input),
  updateCharacter: (showId: string, charId: string, input: UpdateCharacterBody) =>
    request<Character>("PATCH", `${show(showId)}/characters/${e(charId)}`, input),
  deleteCharacter: (showId: string, charId: string) => request<void>("DELETE", `${show(showId)}/characters/${e(charId)}`),
  reorder: (showId: string, kind: "acts" | "scenes" | "characters", ids: string[]) =>
    request<Breakdown>("POST", `${show(showId)}/reorder/${kind}`, { ids }),

  // Conflicts
  myConflicts: () => request<MyConflicts>("GET", "/me/conflicts"),
  saveConflicts: (input: Partial<SaveConflictsBody>) => request<MyConflicts>("POST", "/me/conflicts", input),
  putWeekly: (weekday: number, input: WeeklyBody) => request<WeeklyConflict>("PUT", `/me/conflicts/weekly/${weekday}`, input),
  deleteWeekly: (weekday: number) => request<void>("DELETE", `/me/conflicts/weekly/${weekday}`),
  putDate: (date: string, input: DateBody) => request<DateConflict>("PUT", `/me/conflicts/dates/${e(date)}`, input),
  deleteDate: (date: string) => request<void>("DELETE", `/me/conflicts/dates/${e(date)}`),
  myDays: () => request<ShowDay[]>("GET", "/me/days"),
  showConflicts: (showId: string) => request<MemberConflicts[]>("GET", `${show(showId)}/conflicts`),

  // Schedule. Staff get working copies with warnings; everyone else gets the published schedule.
  /** Leave out from and to for the week holding today (the server's today). */
  schedule: (showId: string, from?: string, to?: string) =>
    request<ScheduleView>("GET", `${show(showId)}/schedule${from && to ? `?from=${e(from)}&to=${e(to)}` : ""}`),
  suggestions: (showId: string, date: string, from?: string, to?: string) =>
    request<Suggestions>(
      "GET",
      `${show(showId)}/schedule/suggestions?date=${e(date)}${from && to ? `&from=${e(from)}&to=${e(to)}` : ""}`,
    ),
  addSceneToNight: (showId: string, date: string, sceneId: string, callId?: string) =>
    request<Call>("POST", `${show(showId)}/schedule/${e(date)}/scenes`, { sceneId, callId }),
  publish: (showId: string, from: string, to: string) =>
    request<PublishResult>("POST", `${show(showId)}/schedule/publish`, { from, to }),
  createCall: (showId: string, input: CreateCallBody) => request<Call>("POST", `${show(showId)}/calls`, input),
  updateCall: (showId: string, callId: string, input: UpdateCallBody) =>
    request<Call>("PATCH", `${show(showId)}/calls/${e(callId)}`, input),
  deleteCall: (showId: string, callId: string) => request<void>("DELETE", `${show(showId)}/calls/${e(callId)}`),
  createTechCalls: (showId: string, input: TechCallsBody) => request<Call[]>("POST", `${show(showId)}/tech-calls`, input),
  myCalls: (showId?: string) => request<MyCall[]>("GET", `/me/calls${showId ? `?showId=${e(showId)}` : ""}`),

  // Tech week
  attendance: (showId: string) => request<Attendance>("GET", `${show(showId)}/attendance`),
  mark: (showId: string, date: string, userId: string, status: CheckInStatus | null) =>
    request<CheckIn | null>("PUT", `${show(showId)}/attendance/${e(date)}/${e(userId)}`, { status }),
  rotateDoorCode: (showId: string) => request<{ doorCode: string }>("POST", `${show(showId)}/door-code`),
  checkIn: (showId: string, code: string) => request<CheckInResult>("POST", `${show(showId)}/check-in`, { code }),
  runningLate: (showId: string, minutes: number, note?: string) =>
    request<CheckIn>("POST", `${show(showId)}/running-late`, { minutes, note }),
};
