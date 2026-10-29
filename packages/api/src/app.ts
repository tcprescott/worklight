import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import {
  canOnShow,
  isEmail,
  isShowRole,
  normalizeEmail,
  type Invite,
  type Me,
  type Membership,
  type Show,
  type ShowRole,
  type Theater,
  type User,
} from "@call-time/shared";
import {
  HttpError,
  badRequest,
  forbidden,
  json,
  notFound,
  optionalString,
  parseBody,
  requireDate,
  requireString,
  requireTimezone,
  unauthorized,
} from "./lib/http.js";
import { newId, newToken, nowEpoch, nowIso } from "./lib/ids.js";
import { inviteEmail, type Mailer } from "./lib/mailer.js";
import type { Store } from "./lib/store.js";

export interface AppDeps {
  store: Store;
  mailer: Mailer;
  /** Public site origin, e.g. https://calltime.example.org. Used in emailed links. */
  appUrl: string;
}

const INVITE_TTL_SECONDS = 30 * 24 * 60 * 60;

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;
type Handler = (ctx: RequestContext) => Promise<APIGatewayProxyResultV2>;

interface RequestContext {
  event: Event;
  params: Record<string, string>;
  user: User;
  body: () => Record<string, unknown>;
}

interface Route {
  method: string;
  pattern: RegExp;
  names: string[];
  handler: Handler;
}

function route(method: string, path: string, handler: Handler): Route {
  const names: string[] = [];
  const pattern = new RegExp(
    `^${path.replace(/\{(\w+)\}/g, (_, name: string) => {
      names.push(name);
      return "([^/]+)";
    })}$`,
  );
  return { method, pattern, names, handler };
}

export function createApp(deps: AppDeps) {
  const { store, mailer, appUrl } = deps;

  /** Maps the verified email in the ID token to a Call Time user, creating one on first sign-in. */
  async function resolveUser(event: Event): Promise<User> {
    const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
    const email = typeof claims.email === "string" ? normalizeEmail(claims.email) : undefined;
    const verified = claims.email_verified === true || claims.email_verified === "true";
    if (!email || !verified) throw unauthorized();

    const existingId = await store.getUserIdByEmail(email);
    if (existingId) {
      const user = await store.getUser(existingId);
      if (user) return user;
    }
    const user: User = { userId: newId(), email, createdAt: nowIso() };
    const userId = await store.createUser(user);
    return userId === user.userId ? user : ((await store.getUser(userId)) ?? user);
  }

  /** The caller's role on a show. Theater admins get staff rights on every show in their theater. */
  async function showAccess(showId: string, userId: string): Promise<{ show: Show; role?: ShowRole; membership?: Membership }> {
    const show = await store.getShow(showId);
    if (!show) throw notFound("Show not found");
    const membership = await store.getMembership(showId, userId);
    if (membership) return { show, role: membership.role, membership };
    if (await store.isTheaterAdmin(show.theaterId, userId)) return { show, role: "staff" };
    return { show };
  }

  const routes: Route[] = [
    route("GET", "/api/me", async ({ user }) => {
      const [theaterIds, memberships] = await Promise.all([
        store.listAdminTheaterIds(user.userId),
        store.listMemberships(user.userId),
      ]);
      const theaters = (await Promise.all(theaterIds.map((id) => store.getTheater(id)))).filter(
        (t): t is Theater => t !== undefined,
      );
      const shows = await store.getShows(memberships.map((m) => ({ theaterId: m.theaterId, showId: m.showId })));
      const byId = new Map(shows.map((s) => [s.showId, s]));
      const me: Me = {
        user,
        theaters: theaters.map((theater) => ({ theater, role: "admin" as const })),
        shows: memberships
          .filter((m) => byId.has(m.showId))
          .map((m) => ({ show: byId.get(m.showId)!, role: m.role, title: m.title }))
          .sort((a, b) => a.show.startDate.localeCompare(b.show.startDate)),
      };
      return json(200, me);
    }),

    route("PATCH", "/api/me", async ({ user, body }) => {
      const name = requireString(body(), "name", 100);
      await store.updateUserName(user.userId, name);
      return json(200, { ...user, name });
    }),

    route("POST", "/api/theaters", async ({ user, body }) => {
      const theater: Theater = {
        theaterId: newId(),
        name: requireString(body(), "name", 120),
        plan: "free",
        createdAt: nowIso(),
      };
      await store.createTheater(theater, user.userId);
      return json(201, theater);
    }),

    route("POST", "/api/theaters/{theaterId}/shows", async ({ user, params, body }) => {
      const theaterId = params.theaterId!;
      if (!(await store.getTheater(theaterId))) throw notFound("Theater not found");
      if (!(await store.isTheaterAdmin(theaterId, user.userId))) throw forbidden();
      const input = body();
      const show: Show = {
        showId: newId(),
        theaterId,
        name: requireString(input, "name", 120),
        venue: optionalString(input, "venue", 200),
        timezone: requireTimezone(input, "timezone"),
        startDate: requireDate(input, "startDate"),
        endDate: requireDate(input, "endDate"),
        createdAt: nowIso(),
      };
      if (show.endDate < show.startDate) throw badRequest("endDate must be on or after startDate");
      const creator: Membership = {
        showId: show.showId,
        theaterId,
        userId: user.userId,
        role: "staff",
        title: optionalString(input, "creatorTitle", 60) ?? "Director",
        joinedAt: nowIso(),
      };
      await store.createShow(show, creator);
      return json(201, show);
    }),

    route("GET", "/api/shows/{showId}", async ({ user, params }) => {
      const { show, role, membership } = await showAccess(params.showId!, user.userId);
      if (!canOnShow(role, "show:read")) throw forbidden();
      return json(200, { show, role, title: membership?.title });
    }),

    route("GET", "/api/shows/{showId}/members", async ({ user, params }) => {
      const { role } = await showAccess(params.showId!, user.userId);
      if (!canOnShow(role, "members:read")) throw forbidden();
      const members = await store.listMembers(params.showId!);
      const users = new Map((await store.getUsers(members.map((m) => m.userId))).map((u) => [u.userId, u]));
      return json(
        200,
        members.map((m) => {
          const u = users.get(m.userId);
          // Only staff see email addresses.
          return {
            userId: m.userId,
            name: u?.name,
            email: canOnShow(role, "members:invite") ? u?.email : undefined,
            role: m.role,
            title: m.title,
          };
        }),
      );
    }),

    route("POST", "/api/shows/{showId}/invites", async ({ user, params, body }) => {
      const { show, role } = await showAccess(params.showId!, user.userId);
      if (!canOnShow(role, "members:invite")) throw forbidden();
      const input = body();
      const email = input.email;
      if (!isEmail(email)) throw badRequest("email must be a valid email address");
      const inviteRole = input.role ?? "cast";
      if (!isShowRole(inviteRole)) throw badRequest("role must be staff, cast or crew");
      const invite: Invite = {
        token: newToken(),
        showId: show.showId,
        theaterId: show.theaterId,
        email: normalizeEmail(email),
        role: inviteRole,
        title: optionalString(input, "title", 60),
        invitedBy: user.userId,
        createdAt: nowIso(),
        expiresAt: nowEpoch() + INVITE_TTL_SECONDS,
      };
      await store.putInvite(invite);
      const url = `${appUrl}/invite/${invite.token}`;
      await mailer.send(inviteEmail(invite.email, show.name, user.name ?? user.email, url));
      return json(201, { email: invite.email, role: invite.role, title: invite.title, expiresAt: invite.expiresAt });
    }),

    route("POST", "/api/invites/{token}/accept", async ({ user, params }) => {
      const invite = await store.getInvite(params.token!);
      // DynamoDB TTL deletes lazily, so expired items can still be read for a while.
      if (!invite || invite.expiresAt < nowEpoch()) throw notFound("This invite has expired or was already used");
      if (invite.email !== user.email) {
        throw new HttpError(403, `This invite was sent to ${invite.email}. Sign in with that address to accept it.`);
      }
      const existing = await store.getMembership(invite.showId, user.userId);
      const membership: Membership = {
        showId: invite.showId,
        theaterId: invite.theaterId,
        userId: user.userId,
        // Accepting a second invite never downgrades staff.
        role: existing?.role === "staff" ? "staff" : invite.role,
        title: invite.title ?? existing?.title,
        joinedAt: existing?.joinedAt ?? nowIso(),
      };
      await store.acceptInvite(invite, membership);
      return json(200, { showId: invite.showId, role: membership.role });
    }),
  ];

  return async function handle(event: Event): Promise<APIGatewayProxyResultV2> {
    try {
      const method = event.requestContext.http.method;
      const path = event.rawPath.replace(/\/+$/, "") || "/";
      let pathMatched = false;
      for (const r of routes) {
        const match = r.pattern.exec(path);
        if (!match) continue;
        pathMatched = true;
        if (r.method !== method) continue;
        const params = Object.fromEntries(r.names.map((name, i) => [name, decodeURIComponent(match[i + 1]!)]));
        const user = await resolveUser(event);
        let parsed: Record<string, unknown> | undefined;
        const body = () => (parsed ??= parseBody(event.body, event.isBase64Encoded));
        return await r.handler({ event, params, user, body });
      }
      return pathMatched ? json(405, { error: "Method not allowed" }) : json(404, { error: "Not found" });
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      console.error(err);
      return json(500, { error: "Something went wrong" });
    }
  };
}
