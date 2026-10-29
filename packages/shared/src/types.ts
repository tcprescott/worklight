export type Plan = "free" | "paid";

export interface Theater {
  theaterId: string;
  name: string;
  plan: Plan;
  createdAt: string;
}

export interface Show {
  showId: string;
  theaterId: string;
  name: string;
  venue?: string;
  /** IANA timezone, e.g. "America/Chicago". Every call time is shown in this zone. */
  timezone: string;
  /** First rehearsal, YYYY-MM-DD. */
  startDate: string;
  /** Closing performance, YYYY-MM-DD. */
  endDate: string;
  createdAt: string;
}

export type ShowRole = "staff" | "cast" | "crew";
export type TheaterRole = "admin";

export interface Membership {
  showId: string;
  theaterId: string;
  userId: string;
  role: ShowRole;
  /** Free text such as "Director", "Stage manager", "Lights". */
  title?: string;
  joinedAt: string;
}

export interface User {
  userId: string;
  email: string;
  name?: string;
  createdAt: string;
}

export interface Invite {
  token: string;
  showId: string;
  theaterId: string;
  email: string;
  role: ShowRole;
  title?: string;
  invitedBy: string;
  createdAt: string;
  /** Epoch seconds; DynamoDB TTL removes the item after this. */
  expiresAt: number;
}

/** What the signed-in user sees on their home page. */
export interface MyShow {
  show: Show;
  role: ShowRole;
  title?: string;
}

export interface Me {
  user: User;
  theaters: Array<{ theater: Theater; role: TheaterRole }>;
  shows: MyShow[];
}
