"""Domain records and API shapes. Fields are camelCase on the wire and in DynamoDB."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

Plan = Literal["free", "paid"]
ShowRole = Literal["staff", "cast", "crew"]
TheaterRole = Literal["admin"]
ShowStatus = Literal["active", "archived"]
MemberStatus = Literal["invited", "joined"]
# hard = can't come, soft = would rather not, partial = arrives late or leaves early.
ConflictLevel = Literal["hard", "soft", "partial"]
# A date answer can also say "free", which overrides a weekly rule for that one date.
DateAnswer = Literal["free", "hard", "soft", "partial"]


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")

    def to_item(self) -> dict[str, object]:
        """The record as stored in DynamoDB (and sent to the browser): camelCase, no empty fields."""
        return self.model_dump(by_alias=True, exclude_none=True)


class Theater(Model):
    theater_id: str
    name: str
    plan: Plan
    created_at: str


class RehearsalSlot(Model):
    """A usual rehearsal night: weekday 0 = Monday ... 6 = Sunday, times as HH:MM in the show's timezone."""

    weekday: int = Field(ge=0, le=6)
    start: str
    end: str


class Show(Model):
    show_id: str
    theater_id: str
    name: str
    venue: str | None = None
    address: str | None = None
    # IANA timezone, e.g. "America/Chicago". Every call time is shown in this zone.
    timezone: str
    # First rehearsal and closing performance, YYYY-MM-DD.
    start_date: str
    end_date: str
    # Usual rehearsal nights. Dates are generated from these between startDate and the day before tech.
    slots: list[RehearsalSlot] = []
    # Generated rehearsal dates the director skipped (holidays and the like).
    skipped_dates: list[str] = []
    off_book_date: str | None = None
    # First day of tech week, and opening night. Tech through closing is "no conflicts allowed".
    tech_start: str | None = None
    opening_date: str | None = None
    # Minutes of rehearsal per script page; scene times come from this unless a scene overrides it.
    minutes_per_page: float = 8
    conflict_deadline: str | None = None
    status: ShowStatus = "active"
    archived_at: str | None = None
    created_at: str


class Membership(Model):
    show_id: str
    theater_id: str
    user_id: str
    role: ShowRole
    # Free text such as "Director", "Stage manager", "Lights".
    title: str | None = None
    # Crew and staff are grouped by department, e.g. "Stage management", "Costumes".
    department: str | None = None
    # Invited people are members from the moment they're invited, so they can be cast before they join.
    status: MemberStatus = "joined"
    invite_token: str | None = None
    invited_at: str | None = None
    joined_at: str | None = None
    # When the person last pressed Send on their conflicts for this show.
    conflicts_submitted_at: str | None = None


class User(Model):
    user_id: str
    email: str
    name: str | None = None
    created_at: str


class Invite(Model):
    token: str
    show_id: str
    theater_id: str
    user_id: str
    email: str
    invited_by: str
    created_at: str
    # Epoch seconds; DynamoDB TTL removes the item after this.
    expires_at: int


class MagicLinkRecord(Model):
    email: str
    code_hash: str
    created_at: int
    expires_at: int


# ---- Script breakdown ----------------------------------------------------------------------------


class Act(Model):
    act_id: str
    show_id: str
    name: str
    order: int


class Scene(Model):
    scene_id: str
    show_id: str
    act_id: str
    # Short label shown on cards, e.g. "1.2" or "Opening number".
    number: str
    name: str
    order: int
    # Length in eighths of a page, the way stage managers count ("4 3/8" = 35).
    eighths: int = 0
    # Rehearsal minutes for big dance or fight numbers; otherwise it comes from the page count.
    minutes_override: int | None = None


class Character(Model):
    char_id: str
    show_id: str
    name: str
    order: int
    # The people playing this part. Several for double casting, none until cast.
    cast_user_ids: list[str] = []
    # A group like "Fairies": called as one, the cast list holds everyone in it.
    ensemble: bool = False


class Appearance(Model):
    show_id: str
    scene_id: str
    char_id: str


class Breakdown(Model):
    acts: list[Act]
    scenes: list[Scene]
    characters: list[Character]
    appearances: list[Appearance]


# ---- Conflicts ---------------------------------------------------------------------------------


class WeeklyConflict(Model):
    """A usual-week rule, e.g. "never Tuesdays" or "late on Wednesdays". One per weekday."""

    user_id: str
    weekday: int = Field(ge=0, le=6)
    level: ConflictLevel
    # For partial: arrival and/or leaving time, HH:MM.
    arrive: str | None = None
    leave: str | None = None
    note: str | None = None
    updated_at: str


class DateConflict(Model):
    """An answer for one date. It wins over a weekly rule for that date."""

    user_id: str
    date: str
    level: DateAnswer
    arrive: str | None = None
    leave: str | None = None
    note: str | None = None
    updated_at: str


class MyConflicts(Model):
    weekly: list[WeeklyConflict]
    dates: list[DateConflict]


# ---- API shapes --------------------------------------------------------------------------------


class MyShow(Model):
    show: Show
    theater_name: str
    role: ShowRole
    title: str | None = None
    status: MemberStatus = "joined"
    conflicts_submitted_at: str | None = None


class MyTheater(Model):
    theater: Theater
    role: TheaterRole


class Me(Model):
    """What the signed-in user sees on their home page."""

    user: User
    theaters: list[MyTheater]
    shows: list[MyShow]


class ShowView(Model):
    show: Show
    theater_name: str
    role: ShowRole
    title: str | None = None
    # True for company admins who aren't in the show themselves.
    via_admin: bool = False


class Member(Model):
    user_id: str
    name: str | None = None
    # Only staff see email addresses.
    email: str | None = None
    role: ShowRole
    title: str | None = None
    department: str | None = None
    status: MemberStatus
    conflicts_submitted_at: str | None = None


class InviteSent(Model):
    user_id: str
    email: str
    role: ShowRole
    title: str | None = None
    expires_at: int


class InviteAccepted(Model):
    show_id: str
    role: ShowRole


class InvitePreview(Model):
    """What the sign-in page shows for an invite link, before anyone signs in."""

    email: str
    show_name: str
    theater_name: str
    inviter_name: str
    role: ShowRole
    # e.g. "Hermia", or the person's title for staff and crew.
    part: str | None = None


class MemberConflicts(Model):
    user_id: str
    weekly: list[WeeklyConflict]
    dates: list[DateConflict]


class Admin(Model):
    user_id: str
    name: str | None = None
    email: str
    title: str | None = None


class ShowSummary(Model):
    show: Show
    staff: list[Member]
    cast_count: int
    crew_count: int
    # Members who haven't sent their conflicts yet (invited or joined).
    waiting_count: int


class TheaterView(Model):
    theater: Theater
    admins: list[Admin]
    shows: list[ShowSummary]
