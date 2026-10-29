import { normalizeEmail, type Invite, type Membership, type Show, type Theater, type User } from "@call-time/shared";
import type { MagicLinkRecord, Store } from "../src/lib/store.js";

/** In-memory Store with the same semantics as DynamoStore, for tests. */
export class MemoryStore implements Store {
  users = new Map<string, User>();
  emails = new Map<string, string>();
  theaters = new Map<string, Theater>();
  admins = new Set<string>();
  shows = new Map<string, Show>();
  members = new Map<string, Membership>();
  invites = new Map<string, Invite>();
  magicLinks = new Map<string, MagicLinkRecord>();

  async getUser(userId: string) {
    return this.users.get(userId);
  }
  async getUserIdByEmail(email: string) {
    return this.emails.get(normalizeEmail(email));
  }
  async createUser(user: User) {
    const email = normalizeEmail(user.email);
    const existing = this.emails.get(email);
    if (existing) return existing;
    this.emails.set(email, user.userId);
    this.users.set(user.userId, { ...user, email });
    return user.userId;
  }
  async updateUserName(userId: string, name: string) {
    const user = this.users.get(userId);
    if (!user) throw new Error("no user");
    this.users.set(userId, { ...user, name });
  }
  async getUsers(userIds: string[]) {
    return userIds.map((id) => this.users.get(id)).filter((u): u is User => u !== undefined);
  }
  async createTheater(theater: Theater, adminUserId: string) {
    this.theaters.set(theater.theaterId, theater);
    this.admins.add(`${theater.theaterId}|${adminUserId}`);
  }
  async getTheater(theaterId: string) {
    return this.theaters.get(theaterId);
  }
  async listAdminTheaterIds(userId: string) {
    return [...this.admins].filter((k) => k.endsWith(`|${userId}`)).map((k) => k.split("|")[0]!);
  }
  async isTheaterAdmin(theaterId: string, userId: string) {
    return this.admins.has(`${theaterId}|${userId}`);
  }
  async createShow(show: Show, creator: Membership) {
    this.shows.set(show.showId, show);
    this.members.set(`${creator.showId}|${creator.userId}`, creator);
  }
  async getShow(showId: string) {
    return this.shows.get(showId);
  }
  async getShows(refs: Array<{ theaterId: string; showId: string }>) {
    return refs.map((r) => this.shows.get(r.showId)).filter((s): s is Show => s !== undefined);
  }
  async listMemberships(userId: string) {
    return [...this.members.values()].filter((m) => m.userId === userId);
  }
  async getMembership(showId: string, userId: string) {
    return this.members.get(`${showId}|${userId}`);
  }
  async listMembers(showId: string) {
    return [...this.members.values()].filter((m) => m.showId === showId);
  }
  async putInvite(invite: Invite) {
    this.invites.set(invite.token, invite);
  }
  async getInvite(token: string) {
    return this.invites.get(token);
  }
  async acceptInvite(invite: Invite, membership: Membership) {
    if (!this.invites.delete(invite.token)) throw new Error("TransactionCanceledException");
    this.members.set(`${membership.showId}|${membership.userId}`, membership);
  }
  async getMagicLink(email: string) {
    return this.magicLinks.get(normalizeEmail(email));
  }
  async putMagicLink(record: MagicLinkRecord) {
    this.magicLinks.set(normalizeEmail(record.email), { ...record, email: normalizeEmail(record.email) });
  }
  async consumeMagicLink(email: string, codeHash: string) {
    const key = normalizeEmail(email);
    if (this.magicLinks.get(key)?.codeHash !== codeHash) return false;
    this.magicLinks.delete(key);
    return true;
  }
}
