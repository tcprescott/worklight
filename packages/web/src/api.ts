import type { Me, Show, ShowRole, Theater } from "@call-time/shared";
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
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !retried) return request<T>(method, path, body, true);
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export interface Member {
  userId: string;
  name?: string;
  email?: string;
  role: ShowRole;
  title?: string;
}

export const api = {
  me: () => request<Me>("GET", "/me"),
  updateName: (name: string) => request("PATCH", "/me", { name }),
  createTheater: (name: string) => request<Theater>("POST", "/theaters", { name }),
  createShow: (
    theaterId: string,
    input: { name: string; venue?: string; timezone: string; startDate: string; endDate: string },
  ) => request<Show>("POST", `/theaters/${encodeURIComponent(theaterId)}/shows`, input),
  show: (showId: string) =>
    request<{ show: Show; role: ShowRole; title?: string }>("GET", `/shows/${encodeURIComponent(showId)}`),
  members: (showId: string) => request<Member[]>("GET", `/shows/${encodeURIComponent(showId)}/members`),
  invite: (showId: string, input: { email: string; role: ShowRole; title?: string }) =>
    request("POST", `/shows/${encodeURIComponent(showId)}/invites`, input),
  acceptInvite: (token: string) =>
    request<{ showId: string; role: ShowRole }>("POST", `/invites/${encodeURIComponent(token)}/accept`),
};
