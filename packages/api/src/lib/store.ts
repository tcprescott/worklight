import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  type BatchGetCommandOutput,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  keys,
  normalizeEmail,
  prefixes,
  type Invite,
  type Membership,
  type Show,
  type Theater,
  type User,
} from "@call-time/shared";

export interface MagicLinkRecord {
  email: string;
  codeHash: string;
  createdAt: number;
  expiresAt: number;
}

/** Everything the API reads and writes. The Lambda uses DynamoStore; tests use an in-memory fake. */
export interface Store {
  getUser(userId: string): Promise<User | undefined>;
  getUserIdByEmail(email: string): Promise<string | undefined>;
  /** Creates the user and its email mapping. Returns the existing userId if the email is already mapped. */
  createUser(user: User): Promise<string>;
  updateUserName(userId: string, name: string): Promise<void>;
  getUsers(userIds: string[]): Promise<User[]>;

  createTheater(theater: Theater, adminUserId: string): Promise<void>;
  getTheater(theaterId: string): Promise<Theater | undefined>;
  listAdminTheaterIds(userId: string): Promise<string[]>;
  isTheaterAdmin(theaterId: string, userId: string): Promise<boolean>;

  createShow(show: Show, creator: Membership): Promise<void>;
  getShow(showId: string): Promise<Show | undefined>;
  getShows(refs: Array<{ theaterId: string; showId: string }>): Promise<Show[]>;
  listMemberships(userId: string): Promise<Membership[]>;
  getMembership(showId: string, userId: string): Promise<Membership | undefined>;
  listMembers(showId: string): Promise<Membership[]>;

  putInvite(invite: Invite): Promise<void>;
  getInvite(token: string): Promise<Invite | undefined>;
  /** Adds the membership and deletes the invite in one transaction. */
  acceptInvite(invite: Invite, membership: Membership): Promise<void>;

  getMagicLink(email: string): Promise<MagicLinkRecord | undefined>;
  putMagicLink(record: MagicLinkRecord): Promise<void>;
  /** Deletes the record only if it still holds this hash, so a code can be redeemed once. */
  consumeMagicLink(email: string, codeHash: string): Promise<boolean>;
}

const strip = <T>(item: Record<string, unknown> | undefined): T | undefined => {
  if (!item) return undefined;
  const { PK: _pk, SK: _sk, GSI1PK: _g1, GSI1SK: _g2, type: _type, ...rest } = item;
  return rest as T;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class DynamoStore implements Store {
  private readonly db: DynamoDBDocumentClient;

  constructor(
    private readonly table: string,
    client = new DynamoDBClient({}),
  ) {
    this.db = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  private async get<T>(key: { PK: string; SK: string }): Promise<T | undefined> {
    const res = await this.db.send(new GetCommand({ TableName: this.table, Key: { PK: key.PK, SK: key.SK } }));
    return strip<T>(res.Item);
  }

  private async batchGet<T>(keyList: Array<{ PK: string; SK: string }>): Promise<T[]> {
    const out: T[] = [];
    for (const group of chunk(keyList, 100)) {
      let pending: Array<Record<string, unknown>> | undefined = group.map((k) => ({ PK: k.PK, SK: k.SK }));
      while (pending && pending.length > 0) {
        const res: BatchGetCommandOutput = await this.db.send(
          new BatchGetCommand({ RequestItems: { [this.table]: { Keys: pending } } }),
        );
        for (const item of res.Responses?.[this.table] ?? []) out.push(strip<T>(item) as T);
        pending = res.UnprocessedKeys?.[this.table]?.Keys;
      }
    }
    return out;
  }

  private async queryAll(params: {
    pk: string;
    skPrefix: string;
    index?: "GSI1";
  }): Promise<Array<Record<string, unknown>>> {
    const pkName = params.index ? "GSI1PK" : "PK";
    const skName = params.index ? "GSI1SK" : "SK";
    const items: Array<Record<string, unknown>> = [];
    let start: Record<string, unknown> | undefined;
    do {
      const res = await this.db.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: params.index,
          KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :sk)",
          ExpressionAttributeNames: { "#pk": pkName, "#sk": skName },
          ExpressionAttributeValues: { ":pk": params.pk, ":sk": params.skPrefix },
          ExclusiveStartKey: start,
        }),
      );
      items.push(...(res.Items ?? []));
      start = res.LastEvaluatedKey;
    } while (start);
    return items;
  }

  getUser(userId: string) {
    return this.get<User>(keys.user(userId));
  }

  async getUserIdByEmail(email: string) {
    const item = await this.get<{ userId: string }>(keys.email(email));
    return item?.userId;
  }

  async createUser(user: User): Promise<string> {
    try {
      await this.db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.table,
                Item: { ...keys.email(user.email), type: "email", userId: user.userId },
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            {
              Put: {
                TableName: this.table,
                Item: { ...keys.user(user.userId), type: "user", ...user, email: normalizeEmail(user.email) },
              },
            },
          ],
        }),
      );
      return user.userId;
    } catch (err) {
      // Two first requests raced; the other one won, so use its user.
      if ((err as { name?: string }).name === "TransactionCanceledException") {
        const existing = await this.getUserIdByEmail(user.email);
        if (existing) return existing;
      }
      throw err;
    }
  }

  async updateUserName(userId: string, name: string) {
    await this.db.send(
      new UpdateCommand({
        TableName: this.table,
        Key: keys.user(userId),
        UpdateExpression: "SET #name = :name",
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeNames: { "#name": "name" },
        ExpressionAttributeValues: { ":name": name },
      }),
    );
  }

  getUsers(userIds: string[]) {
    return this.batchGet<User>([...new Set(userIds)].map(keys.user));
  }

  async createTheater(theater: Theater, adminUserId: string) {
    await this.db.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.table,
              Item: { ...keys.theater(theater.theaterId), type: "theater", ...theater },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
          {
            Put: {
              TableName: this.table,
              Item: {
                ...keys.theaterAdmin(theater.theaterId, adminUserId),
                type: "theaterAdmin",
                theaterId: theater.theaterId,
                userId: adminUserId,
              },
            },
          },
        ],
      }),
    );
  }

  getTheater(theaterId: string) {
    return this.get<Theater>(keys.theater(theaterId));
  }

  async listAdminTheaterIds(userId: string) {
    const items = await this.queryAll({ pk: prefixes.userGsi(userId), skPrefix: "THEATER#", index: "GSI1" });
    return items.map((item) => item.theaterId as string);
  }

  async isTheaterAdmin(theaterId: string, userId: string) {
    return (await this.get(keys.theaterAdmin(theaterId, userId))) !== undefined;
  }

  async createShow(show: Show, creator: Membership) {
    await this.db.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.table,
              Item: { ...keys.show(show.theaterId, show.showId), type: "show", ...show },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
          {
            Put: {
              TableName: this.table,
              Item: { ...keys.showPointer(show.showId), type: "showPointer", showId: show.showId, theaterId: show.theaterId },
            },
          },
          {
            Put: {
              TableName: this.table,
              Item: { ...keys.member(creator.showId, creator.userId), type: "member", ...creator },
            },
          },
        ],
      }),
    );
  }

  async getShow(showId: string) {
    const pointer = await this.get<{ theaterId: string }>(keys.showPointer(showId));
    return pointer ? this.get<Show>(keys.show(pointer.theaterId, showId)) : undefined;
  }

  getShows(refs: Array<{ theaterId: string; showId: string }>) {
    return this.batchGet<Show>(refs.map((r) => keys.show(r.theaterId, r.showId)));
  }

  async listMemberships(userId: string) {
    const items = await this.queryAll({ pk: prefixes.userGsi(userId), skPrefix: prefixes.show, index: "GSI1" });
    return items.map((item) => strip<Membership>(item) as Membership);
  }

  getMembership(showId: string, userId: string) {
    return this.get<Membership>(keys.member(showId, userId));
  }

  async listMembers(showId: string) {
    const items = await this.queryAll({ pk: `SHOW#${showId}`, skPrefix: prefixes.member });
    return items.map((item) => strip<Membership>(item) as Membership);
  }

  async putInvite(invite: Invite) {
    await this.db.send(new PutCommand({ TableName: this.table, Item: { ...keys.invite(invite.token), type: "invite", ...invite } }));
  }

  getInvite(token: string) {
    return this.get<Invite>(keys.invite(token));
  }

  async acceptInvite(invite: Invite, membership: Membership) {
    await this.db.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: this.table,
              Key: keys.invite(invite.token),
              ConditionExpression: "attribute_exists(PK)",
            },
          },
          {
            Put: {
              TableName: this.table,
              Item: { ...keys.member(membership.showId, membership.userId), type: "member", ...membership },
            },
          },
        ],
      }),
    );
  }

  getMagicLink(email: string) {
    return this.get<MagicLinkRecord>(keys.magicLink(email));
  }

  async putMagicLink(record: MagicLinkRecord) {
    await this.db.send(
      new PutCommand({
        TableName: this.table,
        Item: { ...keys.magicLink(record.email), type: "magicLink", ...record, email: normalizeEmail(record.email) },
      }),
    );
  }

  async consumeMagicLink(email: string, codeHash: string) {
    try {
      await this.db.send(
        new DeleteCommand({
          TableName: this.table,
          Key: keys.magicLink(email),
          ConditionExpression: "codeHash = :hash",
          ExpressionAttributeValues: { ":hash": codeHash },
        }),
      );
      return true;
    } catch (err) {
      if ((err as { name?: string }).name === "ConditionalCheckFailedException") return false;
      throw err;
    }
  }
}
